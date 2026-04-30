'use strict'

const BN = require('../../../bn')
const bolt11 = require('@lamassu/bolt11')

const NAME = 'spark'
const SUPPORTED_COINS = ['LN', 'USDB']
const DEFAULT_NETWORK = 'MAINNET'
const DEFAULT_USDB_TOKEN_IDENTIFIER =
  'btkn1xgrvjwey5ngcagvap2dzzvsy4uk8ua9x69k82dwvt5e7ef9drm9qztux87'
const MAX_FEE_SATS = 500
const INVOICE_EXPIRY_SECONDS = 300
const BACKGROUND_SYNC_COOLDOWN_MS = 60000
const ADDRESS_UTXO_SCAN_CONCURRENCY = 16
const SPARK_INVOICE_FINALIZED = 2
const SPARK_INVOICE_PENDING = 1

const walletCache = {}
const depositSyncState = {}

function normalizeMnemonic (mnemonic) {
  return mnemonic.replace(/\s+/g, ' ').trim()
}

function networkForAccount (account) {
  account = account || {}
  const raw = account.sparkNetwork || account.environment || DEFAULT_NETWORK
  return raw.toLowerCase() === 'test' || raw.toLowerCase() === 'testnet'
    ? 'TESTNET'
    : 'MAINNET'
}

function tokenIdentifierForAccount (account) {
  account = account || {}
  return (
    account.usdbTokenIdentifier ||
    process.env.SPARK_USDB_TOKEN_IDENTIFIER ||
    DEFAULT_USDB_TOKEN_IDENTIFIER
  )
}

function sdkPathForAccount (account) {
  account = account || {}
  return (
    account.sparkSdkPath ||
    process.env.SPARK_SDK_PATH ||
    '@buildonspark/spark-sdk'
  )
}

function getWalletCacheKey (account) {
  return `${networkForAccount(account)}:${normalizeMnemonic(account.mnemonic).slice(0, 16)}`
}

function getWalletInstance (account) {
  const cacheKey = getWalletCacheKey(account)
  if (walletCache[cacheKey]) return walletCache[cacheKey]

  walletCache[cacheKey] = import(sdkPathForAccount(account))
    .then(mod =>
      mod.SparkWallet.initialize({
        mnemonicOrSeed: normalizeMnemonic(account.mnemonic),
        options: { network: networkForAccount(account) },
      }),
    )
    .then(result => result.wallet)

  return walletCache[cacheKey]
}

function checkCryptoCode (cryptoCode) {
  if (!SUPPORTED_COINS.includes(cryptoCode)) {
    return Promise.reject(new Error(`Unsupported crypto: ${cryptoCode}`))
  }

  return Promise.resolve()
}

function getTokenBalanceRec (wallet, tokenIdentifier) {
  return wallet.getBalance().then(balance => {
    const tokenBalances = balance.tokenBalances || new Map()
    return tokenBalances.get(tokenIdentifier)
  })
}

function getAvailableTokenBalance (wallet, tokenIdentifier) {
  return getTokenBalanceRec(wallet, tokenIdentifier).then(tokenBalance => {
    if (!tokenBalance) return BN(0)

    const raw = firstDefined([
      tokenBalance.availableToSendBalance,
      tokenBalance.ownedBalance,
      tokenBalance.balance,
      0,
    ])

    return BN(raw.toString())
  })
}

function getAvailableSatsBalance (wallet) {
  return wallet.getBalance().then(balance => {
    const satsBalance = balance.satsBalance || {}
    const raw = firstDefined([satsBalance.available, satsBalance.balance, 0])
    return BN(raw.toString())
  })
}

function getSatsFundingBalances (wallet) {
  return wallet.getBalance().then(balance => {
    const satsBalance = balance.satsBalance || {}
    const available = firstDefined([satsBalance.available, satsBalance.balance, 0])
    const incoming = firstDefined([satsBalance.incoming, 0])
    return {
      available: BN(available.toString()),
      incoming: BN(incoming.toString()),
    }
  })
}

function getOwnedTokenBalance (wallet, tokenIdentifier) {
  return getTokenBalanceRec(wallet, tokenIdentifier).then(tokenBalance => {
    if (!tokenBalance) return BN(0)

    const raw = firstDefined([
      tokenBalance.ownedBalance,
      tokenBalance.availableToSendBalance,
      tokenBalance.balance,
      0,
    ])

    return BN(raw.toString())
  })
}

function firstDefined (values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value
  }
}

function assertSparkAddress (address) {
  if (typeof address !== 'string' || !address.toLowerCase().startsWith('spark1')) {
    throw new Error('Invalid Spark address')
  }
}

function isSparkInvoiceFinalized (invoiceStatus) {
  return invoiceStatus && invoiceStatus.status === SPARK_INVOICE_FINALIZED
}

function isSparkInvoicePending (invoiceStatus) {
  return invoiceStatus && invoiceStatus.status === SPARK_INVOICE_PENDING
}

function getDepositSyncState (account) {
  const cacheKey = getWalletCacheKey(account)
  if (!depositSyncState[cacheKey]) {
    depositSyncState[cacheKey] = {
      inFlight: null,
      lastCompletedAt: 0,
      initialSyncCompleted: false,
    }
  }

  return depositSyncState[cacheKey]
}

async function collectDepositTxids (wallet, depositAddresses) {
  const txids = new Set()

  for (let i = 0; i < depositAddresses.length; i += ADDRESS_UTXO_SCAN_CONCURRENCY) {
    const batch = depositAddresses.slice(i, i + ADDRESS_UTXO_SCAN_CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map(address =>
        wallet
          .getUtxosForDepositAddress(address)
          .then(utxos => utxos.map(utxo => utxo.txid))
          .catch(() => []),
      ),
    )

    for (const batchTxids of batchResults) {
      for (const txid of batchTxids) txids.add(txid)
    }
  }

  return txids
}

async function claimConfirmedDepositsForAddresses (wallet, depositAddresses) {
  const txids = await collectDepositTxids(wallet, depositAddresses)

  for (const txid of txids) {
    try {
      await wallet.claimDeposit(txid)
    } catch (e) {
      // Ignore claim races/already-claimed cases and rely on wallet balance.
    }
  }
}

async function syncConfirmedDeposits (wallet) {
  const unusedAddresses = await wallet.getUnusedDepositAddresses()
  await claimConfirmedDepositsForAddresses(wallet, unusedAddresses)
}

function runDepositSync (syncState, wallet) {
  syncState.inFlight = syncConfirmedDeposits(wallet)
    .then(() => {
      syncState.lastCompletedAt = Date.now()
      syncState.initialSyncCompleted = true
    })
    .finally(() => {
      syncState.inFlight = null
    })

  return syncState.inFlight
}

function ensureInitialDepositSync (account, wallet) {
  const syncState = getDepositSyncState(account)
  if (syncState.initialSyncCompleted) return Promise.resolve()
  if (syncState.inFlight) return syncState.inFlight
  return runDepositSync(syncState, wallet)
}

function triggerBackgroundDepositSync (account, wallet) {
  const syncState = getDepositSyncState(account)
  const now = Date.now()
  if (!syncState.initialSyncCompleted) return
  if (syncState.inFlight) return
  if (now - syncState.lastCompletedAt < BACKGROUND_SYNC_COOLDOWN_MS) return

  runDepositSync(syncState, wallet).catch(() => {})
}

function ensureOwnedFundingAddress (unusedAddresses, fundingAddress) {
  if (!unusedAddresses.includes(fundingAddress)) {
    throw new Error(
      'Spark generated a funding address that is not owned by the current wallet identity',
    )
  }

  return fundingAddress
}

function balance (account, cryptoCode) {
  return checkCryptoCode(cryptoCode)
    .then(() => getWalletInstance(account))
    .then(async wallet => {
      if (cryptoCode === 'LN') {
        await ensureInitialDepositSync(account, wallet)
        triggerBackgroundDepositSync(account, wallet)
        return getAvailableSatsBalance(wallet)
      }

      return getAvailableTokenBalance(wallet, tokenIdentifierForAccount(account))
    })
}

function parseAddressAndId (compositeAddress) {
  const idx = compositeAddress.lastIndexOf('#')
  if (idx === -1) return { invoice: compositeAddress, requestId: null }
  return {
    invoice: compositeAddress.slice(0, idx),
    requestId: compositeAddress.slice(idx + 1),
  }
}

function stripLightningPrefix (address) {
  if (typeof address !== 'string') return address
  return address.toLowerCase().startsWith('lightning:')
    ? address.slice('lightning:'.length)
    : address
}

function isZeroAmountLightningInvoice (invoice) {
  try {
    const decoded = bolt11.decode(invoice)
    if (decoded.millisatoshis === null || decoded.millisatoshis === undefined) return true
    const amount = Number(decoded.millisatoshis)
    return Number.isFinite(amount) && amount === 0
  } catch (err) {
    return false
  }
}

function shouldRetryWithoutSparkPreference (err) {
  const message = err && err.message ? err.message : String(err)
  return message.includes('timelock interval is less than or equal to 0')
}

function payLightningInvoiceWithFallback (wallet, payParams) {
  return wallet.payLightningInvoice(payParams).catch(err => {
    if (!payParams.preferSpark || !shouldRetryWithoutSparkPreference(err)) throw err

    const fallbackParams = Object.assign({}, payParams)
    delete fallbackParams.preferSpark
    return wallet.payLightningInvoice(fallbackParams)
  })
}

function sendCoins (account, tx) {
  const { toAddress, cryptoAtoms, cryptoCode } = tx
  return checkCryptoCode(cryptoCode).then(() => {
    if (cryptoCode === 'LN') {
      const { invoice } = parseAddressAndId(toAddress)
      const normalizedInvoice = stripLightningPrefix(invoice).toLowerCase()
      const payParams = {
        invoice: normalizedInvoice,
        maxFeeSats: MAX_FEE_SATS,
        preferSpark: true,
      }

      if (isZeroAmountLightningInvoice(normalizedInvoice)) {
        payParams.amountSatsToSend = cryptoAtoms.toNumber()
      }

      return getWalletInstance(account)
        .then(wallet => payLightningInvoiceWithFallback(wallet, payParams))
        .then(result => {
          if (!result) throw new Error('Spark: empty result from payLightningInvoice')
          return '<spark lightning transaction>'
        })
    }

    return Promise.resolve()
      .then(() => {
        assertSparkAddress(toAddress)
        return getWalletInstance(account)
      })
      .then(wallet =>
        wallet.transferTokens({
          tokenIdentifier: tokenIdentifierForAccount(account),
          tokenAmount: BigInt(cryptoAtoms.toFixed(0)),
          receiverSparkAddress: toAddress,
        }),
      )
      .then(result => {
        if (typeof result === 'string') return result
        return (
          (result && (result.transactionId || result.txId)) ||
          '<spark token transfer>'
        )
      })
  })
}

function newFunding (account, cryptoCode) {
  return checkCryptoCode(cryptoCode)
    .then(() => getWalletInstance(account))
    .then(async wallet => {
      if (cryptoCode === 'LN') {
        const fundingAddress = await wallet.getSingleUseDepositAddress()
        const unusedAddresses = await wallet.getUnusedDepositAddresses()
        ensureOwnedFundingAddress(unusedAddresses, fundingAddress)
        await claimConfirmedDepositsForAddresses(wallet, unusedAddresses)
        const balances = await getSatsFundingBalances(wallet)

        return {
          fundingPendingBalance: balances.incoming,
          fundingConfirmedBalance: balances.available,
          fundingAddress,
        }
      }

      return Promise.all([
        wallet.getSparkAddress(),
        getOwnedTokenBalance(wallet, tokenIdentifierForAccount(account)),
        getAvailableTokenBalance(wallet, tokenIdentifierForAccount(account)),
      ])
    })
    .then(result => {
      if (!Array.isArray(result)) return result

      const [fundingAddress, ownedBalance, availableBalance] = result
      return {
        fundingPendingBalance: ownedBalance.minus(availableBalance),
        fundingConfirmedBalance: availableBalance,
        fundingAddress,
      }
    })
}

function newAddress (account, info) {
  return checkCryptoCode(info.cryptoCode)
    .then(() => getWalletInstance(account))
    .then(wallet => {
      if (info.cryptoCode === 'LN') {
        return wallet
          .createLightningInvoice({
            amountSats: info.cryptoAtoms.toNumber(),
            memo: 'Lamassu ATM',
            expirySeconds: INVOICE_EXPIRY_SECONDS,
          })
          .then(request => ({
            toAddress: request.invoice.encodedInvoice,
            layer2Address: request.id,
            address: request.invoice.encodedInvoice,
            walletId: request.id,
          }))
      }

      return wallet
        .createTokensInvoice({
          tokenIdentifier: tokenIdentifierForAccount(account),
          amount: BigInt(info.cryptoAtoms.toFixed(0)),
        })
        .then(invoice => ({
          toAddress: invoice,
          layer2Address: invoice,
          address: invoice,
          walletId: invoice,
        }))
    })
}

function getStatus (account, tx, requested) {
  return checkCryptoCode(tx.cryptoCode)
    .then(() => getWalletInstance(account))
    .then(wallet => {
      if (tx.cryptoCode === 'LN') {
        const normalizedAddress = stripLightningPrefix(tx.toAddress || '')
        const { requestId: legacyRequestId } = parseAddressAndId(normalizedAddress)
        const requestId = tx.walletId || tx.layer2Address || legacyRequestId

        if (!requestId) {
          return { receivedCryptoAtoms: BN(0), status: 'notSeen' }
        }

        return wallet.getLightningReceiveRequest(requestId).then(receiveRequest => {
          if (!receiveRequest) {
            return { receivedCryptoAtoms: BN(0), status: 'notSeen' }
          }

          const status = receiveRequest.status || ''
          if (status === 'COMPLETED' || status === 'SUCCEEDED' || status.endsWith('COMPLETED')) {
            return { receivedCryptoAtoms: tx.cryptoAtoms, status: 'confirmed' }
          }

          if (status === 'PENDING' || status.endsWith('PENDING')) {
            return { receivedCryptoAtoms: BN(0), status: 'authorized' }
          }

          return { receivedCryptoAtoms: BN(0), status: 'notSeen' }
        })
      }

      const sparkInvoice = tx.walletId || tx.layer2Address || tx.toAddress
      return wallet.querySparkInvoices([sparkInvoice]).then(result => {
        const invoiceStatus = (result.invoiceStatuses || []).find(
          it => it.invoice === sparkInvoice,
        )

        if (isSparkInvoiceFinalized(invoiceStatus)) {
          return { receivedCryptoAtoms: requested, status: 'confirmed' }
        }

        if (isSparkInvoicePending(invoiceStatus)) {
          return { receivedCryptoAtoms: BN(0), status: 'authorized' }
        }

        return { receivedCryptoAtoms: BN(0), status: 'notSeen' }
      })
    })
    .then(currentBalance => {
      if (currentBalance && currentBalance.status) return currentBalance

      return { receivedCryptoAtoms: BN(0), status: 'notSeen' }
    })
}

function cryptoNetwork (account, cryptoCode) {
  return checkCryptoCode(cryptoCode).then(() =>
    networkForAccount(account) === 'TESTNET' ? 'test' : 'main',
  )
}

function checkBlockchainStatus (cryptoCode) {
  return checkCryptoCode(cryptoCode).then(() => 'ready')
}

function probeLN (account, cryptoCode, invoice) {
  const probeHardLimits = [200000, 1000000, 2000000]

  return checkCryptoCode(cryptoCode)
    .then(() => {
      if (cryptoCode !== 'LN') return null
      return getWalletInstance(account)
    })
    .then(wallet => {
      if (!wallet) return null
      return Promise.all(
        probeHardLimits.map(limit =>
          wallet
            .getLightningSendFeeEstimate({
              encodedInvoice: invoice,
              amountSats: limit,
            })
            .then(() => [limit, true])
            .catch(() => [limit, false]),
        ),
      )
    })
    .then(results => {
      if (!results) return null
      return results.reduce((acc, [limit, ok]) => {
        acc[limit] = ok
        return acc
      }, {})
    })
}

module.exports = {
  NAME,
  balance,
  checkBlockchainStatus,
  cryptoNetwork,
  getStatus,
  newAddress,
  newFunding,
  probeLN,
  sendCoins,
  supportsHd: true,
}
