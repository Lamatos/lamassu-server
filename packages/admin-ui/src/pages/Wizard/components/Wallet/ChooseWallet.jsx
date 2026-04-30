import { useQuery, useMutation, gql } from '@apollo/client'
import * as R from 'ramda'
import React, { useState } from 'react'
import { H4, Info3 } from '../../../../components/typography'
import FormRenderer from '../../../Services/FormRenderer'
import WarningIcon from '../../../../styling/icons/warning-icon/comet.svg?react'

import { Button, SupportLinkButton } from '../../../../components/buttons'
import { RadioGroup } from '../../../../components/inputs'
import _schema from '../../../Services/schemas'
import bitgo from '../../../Services/schemas/singlebitgo'

import classes from './Shared.module.css'
import { getItems } from './getItems'

const GET_CONFIG = gql`
  {
    accounts
    accountsConfig {
      code
      display
      class
      cryptos
    }
    cryptoCurrencies {
      code
      display
    }
  }
`

const SAVE_ACCOUNTS = gql`
  mutation Save($accounts: JSONObject) {
    saveAccounts(accounts: $accounts)
  }
`

const isConfigurable = it =>
  R.includes(it)(['infura', 'bitgo', 'trongrid', 'galoy', 'spark'])

const isLocalHosted = it =>
  R.includes(it)([
    'bitcoind',
    'geth',
    'litecoind',
    'dashd',
    'zcashd',
    'bitcoincashd',
  ])

const ChooseWallet = ({ data: currentData, addData }) => {
  // no need to fetch exchange config here
  const schema = _schema()
  const { data } = useQuery(GET_CONFIG)
  const [saveAccounts] = useMutation(SAVE_ACCOUNTS, {
    onCompleted: () => submit(),
  })

  const [selected, setSelected] = useState(null)
  const [error, setError] = useState(false)

  const accounts = data?.accounts ?? []
  const accountsConfig = data?.accountsConfig ?? []

  const coin = currentData.coin
  const wallets = getItems(accountsConfig, accounts, 'wallet', coin)

  const saveWallet = name => wallet => {
    const accounts = { [name]: wallet }
    return saveAccounts({ variables: { accounts } })
  }

  const submit = () => {
    if (!selected) return setError(true)
    addData({ wallet: selected })
  }

  const onSelect = e => {
    setSelected(e.target.value)
    setError(false)
  }

  return (
    <div className={classes.mdForm}>
      <H4 className={error && classes.error}>Choose your wallet</H4>
      <RadioGroup
        labelClassName={classes.radioLabel}
        className={classes.radioGroup}
        options={R.union(wallets.filled, wallets.unfilled)}
        value={selected}
        onChange={onSelect}
      />
      {isLocalHosted(selected) && (
        <>
          <div className={classes.infoMessage}>
            <WarningIcon />
            <Info3>
              To set up {selected} please read the node wallet instructions from
              our support portal.
            </Info3>
          </div>
          <SupportLinkButton
            link="https://support.lamassu.is/hc/en-us/articles/115001209552-Setting-up-your-node-wallets"
            label="Support article"
          />
        </>
      )}
      {!isConfigurable(selected) && (
        <Button size="lg" onClick={submit} className={classes.button}>
          Continue
        </Button>
      )}
      {selected === 'bitgo' && (
        <>
          <div className={classes.infoMessage}>
            <WarningIcon />
            <Info3>
              Make sure you set up a BitGo wallet to enter the necessary
              information below. Please follow the instructions on our support
              page if you haven’t.
            </Info3>
          </div>
          <SupportLinkButton
            link="https://support.lamassu.is/hc/en-us/articles/360024455592-Setting-up-BitGo"
            label="Support article"
          />
          <H4 noMargin>Enter wallet information</H4>
          <FormRenderer
            value={accounts.bitgo}
            save={saveWallet(selected)}
            elements={bitgo(coin).elements}
            validationSchema={bitgo(coin).validationSchema}
            buttonLabel={'Continue'}
            buttonClass={classes.formButton}
          />
        </>
      )}
      {selected === 'infura' && (
        <>
          <H4 noMargin>Enter wallet information</H4>
          <FormRenderer
            value={accounts.infura}
            save={saveWallet(selected)}
            elements={schema.infura.elements}
            validationSchema={schema.infura.getValidationSchema(
              accounts.infura,
            )}
            buttonLabel={'Continue'}
            buttonClass={classes.formButton}
          />
        </>
      )}
      {selected === 'trongrid' && (
        <>
          <H4 noMargin>Enter wallet information</H4>
          <FormRenderer
            value={accounts.trongrid}
            save={saveWallet(selected)}
            elements={schema.trongrid.elements}
            validationSchema={schema.trongrid.getValidationSchema(
              accounts.trongrid,
            )}
            buttonLabel={'Continue'}
            buttonClass={classes.formButton}
          />
        </>
      )}
      {selected === 'galoy' && (
        <>
          <H4 noMargin>Enter wallet information</H4>
          <FormRenderer
            value={accounts.galoy}
            save={saveWallet(selected)}
            elements={schema.galoy.elements}
            validationSchema={schema.galoy.getValidationSchema(accounts.galoy)}
            buttonLabel={'Continue'}
            buttonClass={classes.formButton}
          />
        </>
      )}
      {selected === 'spark' && (
        <>
          <H4 noMargin>Enter wallet information</H4>
          <FormRenderer
            value={accounts.spark}
            save={saveWallet(selected)}
            elements={schema.spark.elements}
            validationSchema={schema.spark.getValidationSchema(accounts.spark)}
            buttonLabel={'Continue'}
            buttonClass={classes.formButton}
          />
        </>
      )}
    </div>
  )
}

export default ChooseWallet
