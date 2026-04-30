import _binance from './binance'
import _binanceus from './binanceus'
import _bitfinex from './bitfinex'
import bitgo from './bitgo'
import _bitstamp from './bitstamp'
import blockcypher from './blockcypher'
import _cex from './cex'
import elliptic from './elliptic'
import galoy from './galoy'
import inforu from './inforu'
import infura from './infura'
import _itbit from './itbit'
import _kraken from './kraken'
import mailgun from './mailgun'
import scorechain from './scorechain'
import spark from './spark'
import sumsub from './sumsub'
import telnyx from './telnyx'
import trongrid from './trongrid'
import twilio from './twilio'
import vonage from './vonage'

const schemas = (markets = {}) => {
  const binance = _binance(markets?.binance)
  const bitfinex = _bitfinex(markets?.bitfinex)
  const binanceus = _binanceus(markets?.binanceus)
  const bitstamp = _bitstamp(markets?.bitstamp)
  const cex = _cex(markets?.cex)
  const itbit = _itbit(markets?.itbit)
  const kraken = _kraken(markets?.kraken)

  return {
    [bitgo.code]: bitgo,
    [galoy.code]: galoy,
    [bitstamp.code]: bitstamp,
    [blockcypher.code]: blockcypher,
    [elliptic.code]: elliptic,
    [inforu.code]: inforu,
    [infura.code]: infura,
    [itbit.code]: itbit,
    [kraken.code]: kraken,
    [mailgun.code]: mailgun,
    [telnyx.code]: telnyx,
    [vonage.code]: vonage,
    [twilio.code]: twilio,
    [binanceus.code]: binanceus,
    [cex.code]: cex,
    [scorechain.code]: scorechain,
    [spark.code]: spark,
    [trongrid.code]: trongrid,
    [binance.code]: binance,
    [bitfinex.code]: bitfinex,
    [sumsub.code]: sumsub,
  }
}

export default schemas
