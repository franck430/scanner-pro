import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const POLL_MS = 30000
const BINANCE_LIMIT = 100
const TWELVE_DATA_LIMIT = 100
const SCORE_HISTORY_LEN = 24
const TWELVE_DATA_KEY = import.meta.env.VITE_TWELVE_DATA_KEY
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'

const TELEGRAM_COOLDOWN_MS = 30 * 60 * 1000
const LS_TELEGRAM_ALERTS = 'scanner-pro-telegram-alerts'
const LS_TELEGRAM_LAST = 'scanner-pro-telegram-last-alert'

const FILTERS = ['Tous', 'Crypto', 'Forex', 'Indices', 'Matières', '🔥 Signaux forts']
const STRONG_SIGNAL_FILTER = '🔥 Signaux forts'

const MTF_TIMEFRAMES = [
  { key: '1D', binanceInterval: '1d', twelveInterval: '1day' },
  { key: '4H', binanceInterval: '4h', twelveInterval: '4h' },
  { key: '15m', binanceInterval: '15m', twelveInterval: '15min' },
]

const TIMEFRAMES = [
  {
    id: '15m',
    label: '15m',
    binanceInterval: '15m',
    twelveInterval: '15min',
    tradingViewInterval: '15',
    context: 'Scalping / Day trading',
  },
  {
    id: '1H',
    label: '1H',
    binanceInterval: '1h',
    twelveInterval: '1h',
    tradingViewInterval: '60',
    context: 'Day trading',
  },
  {
    id: '4H',
    label: '4H',
    binanceInterval: '4h',
    twelveInterval: '4h',
    tradingViewInterval: '240',
    context: 'Swing trading',
  },
  {
    id: '1D',
    label: '1D',
    binanceInterval: '1d',
    twelveInterval: '1day',
    tradingViewInterval: 'D',
    context: 'Position trading',
  },
  {
    id: '1W',
    label: '1W',
    binanceInterval: '1w',
    twelveInterval: '1week',
    tradingViewInterval: 'W',
    context: 'Trading long terme',
  },
]

const WATCHLIST = [
  // Crypto
  { label: 'BTC/USDT', category: 'Crypto', tvSymbol: 'BINANCE:BTCUSDT', binanceSymbol: 'BTCUSDT', decimals: 2, simBasePrice: 65000 },
  { label: 'ETH/USDT', category: 'Crypto', tvSymbol: 'BINANCE:ETHUSDT', binanceSymbol: 'ETHUSDT', decimals: 2, simBasePrice: 3200 },
  { label: 'SOL/USDT', category: 'Crypto', tvSymbol: 'BINANCE:SOLUSDT', binanceSymbol: 'SOLUSDT', decimals: 2, simBasePrice: 170 },
  { label: 'XRP/USDT', category: 'Crypto', tvSymbol: 'BINANCE:XRPUSDT', binanceSymbol: 'XRPUSDT', decimals: 4, simBasePrice: 0.52 },
  { label: 'BNB/USDT', category: 'Crypto', tvSymbol: 'BINANCE:BNBUSDT', binanceSymbol: 'BNBUSDT', decimals: 2, simBasePrice: 600 },

  // Forex
  { label: 'EUR/USD', category: 'Forex', tvSymbol: 'FX:EURUSD', twelveSymbol: 'EUR/USD', decimals: 5, simBasePrice: 1.08 },
  { label: 'GBP/USD', category: 'Forex', tvSymbol: 'FX:GBPUSD', twelveSymbol: 'GBP/USD', decimals: 5, simBasePrice: 1.28 },
  { label: 'USD/JPY', category: 'Forex', tvSymbol: 'FX:USDJPY', twelveSymbol: 'USD/JPY', decimals: 3, simBasePrice: 148 },
  { label: 'AUD/USD', category: 'Forex', tvSymbol: 'FX:AUDUSD', twelveSymbol: 'AUD/USD', decimals: 5, simBasePrice: 0.66 },
  { label: 'USD/CHF', category: 'Forex', tvSymbol: 'FX:USDCHF', twelveSymbol: 'USD/CHF', decimals: 5, simBasePrice: 0.91 },
  { label: 'NZD/USD', category: 'Forex', tvSymbol: 'FX:NZDUSD', twelveSymbol: 'NZD/USD', decimals: 5, simBasePrice: 0.61 },
  { label: 'USD/CAD', category: 'Forex', tvSymbol: 'FX:USDCAD', twelveSymbol: 'USD/CAD', decimals: 5, simBasePrice: 1.35 },
  { label: 'EUR/GBP', category: 'Forex', tvSymbol: 'FX:EURGBP', twelveSymbol: 'EUR/GBP', decimals: 5, simBasePrice: 0.86 },
  { label: 'EUR/JPY', category: 'Forex', tvSymbol: 'FX:EURJPY', twelveSymbol: 'EUR/JPY', decimals: 3, simBasePrice: 165 },
  { label: 'GBP/JPY', category: 'Forex', tvSymbol: 'FX:GBPJPY', twelveSymbol: 'GBP/JPY', decimals: 3, simBasePrice: 192 },

  // Indices
  { label: 'NAS100', category: 'Indices', tvSymbol: 'TVC:NDX', twelveSymbol: 'NDX', decimals: 2, simBasePrice: 18000 },
  { label: 'SP500', category: 'Indices', tvSymbol: 'TVC:SPX', twelveSymbol: 'SPX', decimals: 2, simBasePrice: 5200 },

  // Matières
  { label: 'XAU/USD', category: 'Matières', tvSymbol: 'OANDA:XAUUSD', twelveSymbol: 'XAU/USD', decimals: 2, simBasePrice: 2200 },
  { label: 'XAG/USD', category: 'Matières', tvSymbol: 'OANDA:XAGUSD', twelveSymbol: 'XAG/USD', decimals: 2, simBasePrice: 26 },
  { label: 'WTI/USD', category: 'Matières', tvSymbol: 'TVC:USOIL', decimals: 2, simBasePrice: 75 },
]

const SIM_PROFILE_BY_CATEGORY = {
  Crypto: { entryVolPct: 0.004, atrPct: 0.012, emaDiffPct: 0.010 },
  Forex: { entryVolPct: 0.0006, atrPct: 0.0012, emaDiffPct: 0.0025 },
  Indices: { entryVolPct: 0.0035, atrPct: 0.008, emaDiffPct: 0.010 },
  'Matières': { entryVolPct: 0.0025, atrPct: 0.006, emaDiffPct: 0.009 },
}

function countMtfScoresAbove75(mtfScores) {
  if (!mtfScores) return 0
  return ['1D', '4H', '15m'].filter((k) => {
    const s = mtfScores[k]
    return typeof s === 'number' && s > 75
  }).length
}

function buildTelegramAlertMessage(item, conf) {
  const trade = conf.trade
  const fmt = (n) => {
    const v = Number(n)
    if (!Number.isFinite(v)) return '—'
    return v.toLocaleString(undefined, { maximumFractionDigits: item.decimals })
  }
  const dir =
    conf.recommendation === 'LONG' || conf.recommendation === 'SHORT'
      ? conf.recommendation
      : trade?.direction ?? '—'
  const rr = Number.isFinite(trade?.rr) ? trade.rr.toFixed(2) : '—'
  const time = new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })
  return [
    `🚨 SIGNAL FORT - ${item.label}`,
    `📊 Score : ${conf.score}/100`,
    `📈 Direction : ${dir}`,
    `⏱ Confluence : ${conf.checksPassed}/${conf.checksTotal} critères`,
    `💰 Entrée : ${fmt(trade?.entry)}`,
    `🛑 Stop Loss : ${fmt(trade?.stopLoss)}`,
    `🎯 Take Profit : ${fmt(trade?.takeProfit)}`,
    `⚖️ R/R : ${rr}`,
    `⏰ ${time}`,
  ].join('\n')
}

async function sendTelegramAlert(text) {
  const url = '/api/telegram'
  console.log('[sendTelegramAlert] POST', url, 'text length:', text?.length ?? 0)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  const data = await res.json().catch((e) => {
    console.error('[sendTelegramAlert] JSON parse error:', e)
    return {}
  })
  console.log('[sendTelegramAlert] response', res.status, data)
  if (!res.ok) {
    const parts = [data.error, data.detail].filter(Boolean)
    throw new Error(parts.length > 0 ? parts.join('\n\n') : `Telegram HTTP ${res.status}`)
  }
}

function scoreToTrend(score) {
  if (score > 65) return { arrow: '↑', className: 'trend-up' }
  if (score >= 40) return { arrow: '→', className: 'trend-mid' }
  return { arrow: '↓', className: 'trend-down' }
}

function Sparkline({ values, tone }) {
  const w = 64
  const h = 18
  if (!Array.isArray(values) || values.length < 2) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1

  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - min) / span) * h
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  const stroke =
    tone === 'good' ? 'rgba(0,229,160,0.95)' : tone === 'bad' ? 'rgba(255,61,90,0.95)' : 'rgba(255,176,32,0.95)'

  return (
    <svg className="sparkline" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function WatchlistPanel({
  visibleItems,
  selectedTvSymbol,
  scanResults,
  filter,
  setFilter,
  onPickSymbol,
  scoreHistory,
  scorePulse,
}) {
  return (
    <>
      <div className="panel-title">Watchlist</div>

      <div className="filter-bar" role="tablist" aria-label="Filter watchlist">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`filter-btn ${filter === f ? 'is-active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="watchlist">
        {visibleItems.map((item) => {
          const isActive = item.tvSymbol === selectedTvSymbol
          const result = scanResults[item.tvSymbol]
          const score =
            result && typeof result.confluence?.score === 'number'
              ? result.confluence.score
              : null
          const mtfScores = result?.confluence?.mtfScores

          const badgeClass = score == null ? 'badge--neutral' : scoreToBadgeClass(score)
          const trend = typeof score === 'number' ? scoreToTrend(score) : { arrow: '→', className: 'trend-mid' }
          const values = (scoreHistory[item.tvSymbol] && scoreHistory[item.tvSymbol].length >= 2)
            ? scoreHistory[item.tvSymbol]
            : typeof score === 'number'
              ? [score, score]
              : [50, 50]

          const tone = score == null ? 'mid' : score > 65 ? 'good' : score < 40 ? 'bad' : 'mid'

          return (
            <button
              key={item.tvSymbol}
              type="button"
              className={`watchlist-item ${isActive ? 'is-active' : ''}`}
              onClick={() => onPickSymbol(item.tvSymbol)}
            >
              <span className="watchlist-left">
                <span className="watchlist-label">{item.label}</span>
                <span className="mtf-line">
                  {mtfScores
                    ? `1D:${mtfScores['1D']} | 4H:${mtfScores['4H']} | 15m:${mtfScores['15m']}`
                    : '1D:— | 4H:— | 15m:—'}
                </span>
              </span>

              <span className="watchlist-right">
                <span className={`trend-arrow ${trend.className}`}>{trend.arrow}</span>
                <Sparkline values={values} tone={tone} />
                <span className={`score-badge ${badgeClass} ${scorePulse[item.tvSymbol] ? 'score-badge--pulse' : ''}`}>
                  {score == null ? '—' : score}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="panel-help">Scores recalcules toutes les {Math.round(POLL_MS / 1000)}s.</div>
    </>
  )
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function formatClock(d) {
  const pad = (x) => String(x).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

async function fetchBinanceKlines(binanceSymbol, interval, limit) {
  // Binance REST: https://api.binance.com/api/v3/klines
  // Returns: [ [ openTime, open, high, low, close, volume, closeTime, ... ], ... ]
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(
    binanceSymbol,
  )}&interval=${encodeURIComponent(interval)}&limit=${limit}`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`)

  const data = await res.json()
  if (!Array.isArray(data) || data.length === 0) return []

  return data.map((k) => {
    const openTime = typeof k[0] === 'number' ? k[0] : Number(k[0])
    const open = parseFloat(k[1])
    const high = parseFloat(k[2])
    const low = parseFloat(k[3])
    const close = parseFloat(k[4])

    return {
      date: new Date(openTime),
      open,
      high,
      low,
      close,
      volume: k[5] != null ? parseFloat(k[5]) : null,
    }
  })
  .sort((a, b) => a.date.getTime() - b.date.getTime())
}

async function fetchTwelveDataCandles(twelveSymbol, interval, outputsize, apiKey) {
  if (!apiKey) throw new Error('Missing Twelve Data API key')

  const url =
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(twelveSymbol)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&outputsize=${outputsize}` +
    '&format=JSON' +
    `&apikey=${encodeURIComponent(apiKey)}`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`)

  const data = await res.json()
  if (data.status === 'error') {
    throw new Error(data.message || 'Twelve Data error')
  }

  if (!Array.isArray(data.values) || data.values.length === 0) return []

  return data.values
    .map((v) => ({
      date: new Date(v.datetime),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: v.volume != null ? parseFloat(v.volume) : null,
    }))
    .filter(
      (c) =>
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close) &&
        c.date instanceof Date &&
        !Number.isNaN(c.date.getTime()),
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime())
}

function ema(values, period) {
  if (values.length < period) return Array(values.length).fill(null)

  const k = 2 / (period + 1)
  const out = Array(values.length).fill(null)

  let prev = values.slice(0, period).reduce((acc, v) => acc + v, 0) / period
  out[period - 1] = prev

  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }

  return out
}

function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return null
  let gainSum = 0
  let lossSum = 0

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gainSum += diff
    else lossSum += Math.abs(diff)
  }

  let avgGain = gainSum / period
  let avgLoss = lossSum / period

  let rsi = null
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? Math.abs(diff) : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period

    if (avgLoss === 0) rsi = 100
    else {
      const rs = avgGain / avgLoss
      rsi = 100 - 100 / (1 + rs)
    }
  }

  return rsi
}

function computeMACD(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(closes, fast)
  const emaSlow = ema(closes, slow)

  const macdSeries = []
  for (let i = 0; i < closes.length; i++) {
    if (emaFast[i] == null || emaSlow[i] == null) continue
    macdSeries.push(emaFast[i] - emaSlow[i])
  }
  if (macdSeries.length < signalPeriod + 1) return null

  const macdLast = macdSeries[macdSeries.length - 1]
  const signalSeries = ema(macdSeries, signalPeriod)
  const signalLast = signalSeries[signalSeries.length - 1]
  const hist = macdLast - signalLast
  const macdPrev = macdSeries.length > 1 ? macdSeries[macdSeries.length - 2] : null
  const signalPrev =
    signalSeries.length > 1 ? signalSeries[signalSeries.length - 2] : null
  const prevHist =
    macdPrev != null && signalPrev != null ? macdPrev - signalPrev : null

  return { macd: macdLast, signal: signalLast, hist, prevHist }
}

function computeBollinger(closes, period = 20, mult = 2) {
  if (closes.length < period) return null
  const slice = closes.slice(-period)
  const middle = slice.reduce((acc, v) => acc + v, 0) / period
  const variance = slice.reduce((acc, v) => acc + (v - middle) ** 2, 0) / period
  const dev = Math.sqrt(variance)
  const upper = middle + mult * dev
  const lower = middle - mult * dev
  const width = middle !== 0 ? (upper - lower) / middle : 0
  return { upper, lower, middle, width }
}

function computeATR(candles, period = 14) {
  if (candles.length < period + 1) return null

  const trs = []
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i]
    const prev = candles[i - 1]
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close),
    )
    trs.push(tr)
  }

  if (trs.length < period) return null

  // Wilder smoothing.
  let atr =
    trs.slice(0, period).reduce((acc, v) => acc + v, 0) / period
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period
  }

  return atr
}

function findLastSwingHigh(candles, pivot = 5) {
  const n = candles.length
  if (n < pivot * 2 + 3) return null

  let last = null
  for (let i = pivot; i <= n - pivot - 2; i++) {
    const left = candles.slice(i - pivot, i + 1)
    const right = candles.slice(i, i + pivot + 1)
    const window = left.length === pivot + 1 ? left.concat(right.slice(1)) : null
    if (!window || window.length !== pivot * 2 + 1) continue

    const maxHigh = window.reduce((acc, c) => Math.max(acc, c.high), -Infinity)
    const high = candles[i].high

    if (high >= maxHigh) last = high
  }

  return last
}

function findLastSwingLow(candles, pivot = 5) {
  const n = candles.length
  if (n < pivot * 2 + 3) return null

  let last = null
  for (let i = pivot; i <= n - pivot - 2; i++) {
    const left = candles.slice(i - pivot, i + 1)
    const right = candles.slice(i, i + pivot + 1)
    const window = left.length === pivot + 1 ? left.concat(right.slice(1)) : null
    if (!window || window.length !== pivot * 2 + 1) continue

    const minLow = window.reduce((acc, c) => Math.min(acc, c.low), Infinity)
    const low = candles[i].low

    if (low <= minLow) last = low
  }

  return last
}

function scoreToBadgeClass(score) {
  if (score > 65) return 'badge--good'
  if (score >= 40) return 'badge--mid'
  return 'badge--bad'
}

function scoreLabel(score) {
  if (score > 75) return 'CONFLUENCE FORTE'
  if (score >= 50) return 'CONFLUENCE MOYENNE'
  return 'PAS DE SIGNAL'
}

function buildConfluenceResult(mtfMap) {
  const d1 = mtfMap['1D']
  const h4 = mtfMap['4H']
  const m15 = mtfMap['15m']
  if (!d1 || !h4 || !m15) return null

  const scores = {
    '1D': d1.score,
    '4H': h4.score,
    '15m': m15.score,
  }

  const dirs = [d1.trade.direction, h4.trade.direction, m15.trade.direction]
  const longAligned = dirs.filter((d) => d === 'LONG').length
  const shortAligned = dirs.filter((d) => d === 'SHORT').length
  const alignedCount = Math.max(longAligned, shortAligned)
  const dominantDirection = longAligned >= shortAligned ? 'LONG' : 'SHORT'

  let confluence = 0
  if (alignedCount === 3) confluence += 40
  else if (alignedCount === 2) confluence += 20

  const rsi = m15.indicators.rsi
  const rsiLong = rsi >= 50 && rsi <= 65
  const rsiShort = rsi >= 35 && rsi <= 50
  if (rsiLong) confluence += 20

  const macdHist = m15.indicators.macd.hist
  const macdPrev = m15.indicators.macd.prevHist
  const macdPositiveGrowing =
    Number.isFinite(macdHist) && Number.isFinite(macdPrev) && macdHist > 0 && macdHist > macdPrev
  if (macdPositiveGrowing) confluence += 20

  const price = m15.indicators.entry
  const emaLong = price > m15.indicators.ema20 && price > m15.indicators.ema50
  if (emaLong) confluence += 20

  confluence = clamp(Math.round(confluence), 0, 100)

  // 7-criteria checklist for signal panel.
  const score1dOkLong = scores['1D'] > 65
  const score4hOkLong = scores['4H'] > 65
  const score15mOkLong = scores['15m'] > 65

  const score1dOkShort = scores['1D'] < 40
  const score4hOkShort = scores['4H'] < 40
  const score15mOkShort = scores['15m'] < 40

  const macdLong = Number.isFinite(macdHist) ? macdHist > 0 : false
  const macdShort = Number.isFinite(macdHist) ? macdHist < 0 : false
  const emaShort = price < m15.indicators.ema20 && price < m15.indicators.ema50
  const rrOk = m15.trade.rr > 2

  const longChecks = [
    score1dOkLong,
    score4hOkLong,
    score15mOkLong,
    rsiLong,
    macdLong,
    emaLong,
    rrOk,
  ]

  const shortChecks = [
    score1dOkShort,
    score4hOkShort,
    score15mOkShort,
    rsiShort,
    macdShort,
    emaShort,
    rrOk,
  ]

  const longCount = longChecks.filter(Boolean).length
  const shortCount = shortChecks.filter(Boolean).length

  let recommendation = 'ATTENDRE'
  let signalBadge = 'EN ATTENTE'
  let signalTone = 'mid'
  let checks = longChecks
  let checksPassed = longCount
  let checksDirection = 'LONG'

  if (longCount >= 5 && longCount >= shortCount) {
    recommendation = 'LONG'
    signalBadge = 'LONG IDÉAL'
    signalTone = 'good'
    checks = longChecks
    checksPassed = longCount
    checksDirection = 'LONG'
  } else if (shortCount >= 5 && shortCount > longCount) {
    recommendation = 'SHORT'
    signalBadge = 'SHORT IDÉAL'
    signalTone = 'bad'
    checks = shortChecks
    checksPassed = shortCount
    checksDirection = 'SHORT'
  }

  const checkLabels =
    checksDirection === 'LONG'
      ? [
          'Score 1D > 65',
          'Score 4H > 65',
          'Score 15m > 65',
          'RSI entre 50-65',
          'MACD positif',
          'Prix > EMA20 et EMA50',
          'R/R > 2.0',
        ]
      : [
          'Score 1D < 40',
          'Score 4H < 40',
          'Score 15m < 40',
          'RSI entre 35-50',
          'MACD négatif',
          'Prix < EMA20 et EMA50',
          'R/R > 2.0',
        ]

  return {
    score: confluence,
    label: scoreLabel(confluence),
    alignedCount,
    dominantDirection,
    mtfScores: scores,
    recommendation,
    signalBadge,
    signalTone,
    checklist: checkLabels.map((label, i) => ({ label, ok: checks[i] })),
    checksPassed,
    checksTotal: 7,
    trade: m15.trade,
    indicators: m15.indicators,
  }
}

function simulateComputedForItem(item, prevSim) {
  const profile =
    SIM_PROFILE_BY_CATEGORY[item.category] ?? SIM_PROFILE_BY_CATEGORY.Forex

  const prevScore = typeof prevSim?.score === 'number' ? prevSim.score : 55
  const prevEntry =
    typeof prevSim?.entry === 'number' && prevSim.entry > 0
      ? prevSim.entry
      : item.simBasePrice ?? 100

  // "Marché" simulé: légère variation + moyenne de retour vers ~55.
  const drift = (55 - prevScore) * 0.05
  const noise = (Math.random() - 0.5) * 18 // +/-9
  const score = Math.round(clamp(prevScore + drift + noise, 0, 100))

  const direction = score >= 50 ? 'LONG' : 'SHORT'
  const isLong = direction === 'LONG'

  const entryVol = profile.entryVolPct
  const entryNoise = (Math.random() - 0.5) * 2 * entryVol // +/- entryVol
  const entry = Math.max(1e-9, prevEntry * (1 + entryNoise))

  const atr = entry * profile.atrPct * (0.75 + Math.random() * 0.6)

  const scoreCentered = (score - 50) / 50 // -1..1
  const emaDiffRatio = profile.emaDiffPct * Math.abs(scoreCentered)

  let ema20
  let ema50
  if (isLong) {
    ema20 = entry * (1 + emaDiffRatio)
    ema50 = entry * (1 - emaDiffRatio / 2)
  } else {
    ema20 = entry * (1 - emaDiffRatio / 2)
    ema50 = entry * (1 + emaDiffRatio)
  }

  // RSI: map score -> 20..80 (puis jitter)
  const rsi = clamp(20 + score * 0.6 + (Math.random() - 0.5) * 6, 0, 100)

  // MACD hist: signe selon direction, amplitude selon distance au 50.
  const histAbsNorm = Math.abs(scoreCentered)
  const histAbs = entry * 0.002 * (0.25 + 0.75 * histAbsNorm)
  const macdHist = isLong ? histAbs : -histAbs

  const bbWidth = clamp(
    0.008 + (score / 100) * 0.04 + (Math.random() - 0.5) * 0.005,
    0.008,
    0.05,
  )
  const bbMiddle = isLong ? entry * (1 - 0.002) : entry * (1 + 0.002)
  const bb = {
    upper: bbMiddle + bbWidth * entry,
    lower: bbMiddle - bbWidth * entry,
    middle: bbMiddle,
    width: bbWidth,
  }

  // RR dynamique (entre 1.50 et 5.00) pour éviter le RR fixe 2.67.
  const rr = clamp(
    1.5 + Math.abs(scoreCentered) * 3.5 + (Math.random() - 0.5) * 0.9,
    1.5,
    5.0,
  )

  const riskDist = atr * (0.9 + Math.random() * 0.9) // "proche" de la volatilité
  const stopLoss = isLong ? entry - riskDist : entry + riskDist
  const takeProfit = isLong ? entry + riskDist * rr : entry - riskDist * rr

  const emaBull = ema20 > ema50
  const rsiActive = isLong ? rsi >= 55 : rsi <= 45
  const macdBull = macdHist >= 0
  const macdActive = isLong ? macdBull : !macdBull
  const emaActive = isLong ? emaBull : !emaBull
  const bbActive = isLong ? entry >= bb.middle : entry <= bb.middle

  return {
    computed: {
      score,
      indicators: {
        entry,
        ema20,
        ema50,
        rsi,
        macd: { hist: macdHist },
        bb,
        atr,
      },
      trade: {
        direction,
        entry,
        stopLoss,
        takeProfit,
        rr,
      },
      signals: {
        RSI: rsiActive,
        MACD: macdActive,
        EMA: emaActive,
        BB: bbActive,
      },
    },
    nextSim: { score, entry },
  }
}

function computeIndicatorsAndTrade(candles) {
  const closes = candles.map((c) => c.close)
  const entry = closes[closes.length - 1]

  const ema20Series = ema(closes, 20)
  const ema50Series = ema(closes, 50)
  const ema20 = ema20Series[ema20Series.length - 1]
  const ema50 = ema50Series[ema50Series.length - 1]
  if (ema20 == null || ema50 == null) return null

  const rsi = computeRSI(closes, 14)
  const macd = computeMACD(closes, 12, 26, 9)
  const bb = computeBollinger(closes, 20, 2)
  const atr = computeATR(candles, 14)
  if (rsi == null || macd == null || bb == null || atr == null) return null

  const trendDiff = (ema20 - ema50) / entry
  const trendScore = clamp((trendDiff + 0.01) / 0.02, 0, 1) * 30

  const rsiScore = clamp((rsi - 30) / 30, 0, 1) * 25

  const histAbsNorm = Math.abs(macd.hist) / (entry * 0.002) // 0.2% move scale
  const histStrength = clamp(histAbsNorm, 0, 1)
  const macdScore = macd.hist >= 0 ? histStrength * 25 : histStrength * 2.5

  const volStrength = clamp((bb.width - 0.01) / 0.04, 0, 1) // 1%..5%
  const directionFactor = entry >= bb.middle ? 1 : 0.5
  const bbScore = volStrength * directionFactor * 20

  const score = Math.round(clamp(trendScore + rsiScore + macdScore + bbScore, 0, 100))

  // Direction LONG/SHORT based on majority of bullish signals.
  const emaBull = ema20 > ema50
  const rsiBull = rsi >= 50
  const macdBull = macd.hist >= 0
  const bullishCount = (emaBull ? 1 : 0) + (rsiBull ? 1 : 0) + (macdBull ? 1 : 0)
  const direction = bullishCount >= 2 ? 'LONG' : 'SHORT'

  const isLong = direction === 'LONG'

  // --- Dynamic Risk/Reward ---
  // 1) SL via support/résistance récents (min low / max high)
  // 2) TP via dernier swing high/low
  // 3) RR contraint entre 1.50 et 5.00 (et TP recalculé si besoin)
  const lookbackSR = 20
  const pivot = 5
  const n = candles.length
  const fromSR = Math.max(0, n - lookbackSR)
  const toSR = Math.max(0, n - 1) // exclude last candle
  const sliceSR = candles.slice(fromSR, toSR)

  const supportLow =
    sliceSR.length > 0 ? sliceSR.reduce((acc, c) => Math.min(acc, c.low), Infinity) : entry
  const resistanceHigh =
    sliceSR.length > 0 ? sliceSR.reduce((acc, c) => Math.max(acc, c.high), -Infinity) : entry

  const lastSwingHigh = findLastSwingHigh(candles, pivot)
  const lastSwingLow = findLastSwingLow(candles, pivot)

  // Small buffer so SL is "just beyond" the level.
  const levelBuf = atr * 0.05

  let stopLoss = isLong ? supportLow + levelBuf : resistanceHigh - levelBuf
  if (isLong && stopLoss >= entry) stopLoss = entry - atr * 1.0
  if (!isLong && stopLoss <= entry) stopLoss = entry + atr * 1.0

  const rrDesired = clamp(1.5 + ((score ?? 50) / 100) ** 1.2 * 3.5, 1.5, 5.0)

  let takeProfit = isLong ? (lastSwingHigh ?? entry + atr * 2) : (lastSwingLow ?? entry - atr * 2)

  // If TP doesn't make sense directionally, fallback to RR desired.
  const riskDist = Math.abs(entry - stopLoss)
  const tpMakesSense = isLong ? takeProfit > entry : takeProfit < entry

  if (!tpMakesSense || !Number.isFinite(takeProfit)) {
    takeProfit = isLong ? entry + riskDist * rrDesired : entry - riskDist * rrDesired
  }

  let rr = riskDist > 0 ? Math.abs(takeProfit - entry) / riskDist : rrDesired
  rr = clamp(rr, 1.5, 5.0)

  // Ensure TP matches clamped RR.
  takeProfit = isLong ? entry + riskDist * rr : entry - riskDist * rr

  // Active signals based on direction.
  const emaActive = isLong ? emaBull : !emaBull
  const rsiActive = isLong ? rsi >= 55 : rsi <= 45
  const macdActive = isLong ? macdBull : !macdBull
  const bbActive = isLong ? entry >= bb.middle : entry <= bb.middle

  return {
    score,
    indicators: {
      entry,
      ema20,
      ema50,
      rsi,
      macd,
      bb,
      atr,
    },
    trade: {
      direction,
      entry,
      stopLoss,
      takeProfit,
      rr,
    },
    signals: {
      RSI: rsiActive,
      MACD: macdActive,
      EMA: emaActive,
      BB: bbActive,
    },
  }
}

function TradingViewAdvancedChart({ symbol, tvInterval }) {
  const containerRef = useRef(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    // Avoid "setState synchronously within effect" lint warnings.
    const t0 = window.setTimeout(() => setLoading(true), 0)

    // Re-initialize the widget when the symbol changes.
    el.innerHTML = ''

    const widgetHost = document.createElement('div')
    widgetHost.className = 'tradingview-widget-container__widget'
    el.appendChild(widgetHost)

    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.async = true
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'

    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: tvInterval,
      timezone: 'exchange',
      theme: 'dark',
      style: '1',
      locale: 'en',
      hide_top_toolbar: true,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      support_host: 'https://www.tradingview.com',
    })

    el.appendChild(script)

    const t = window.setTimeout(() => setLoading(false), 900)
    return () => {
      window.clearTimeout(t0)
      window.clearTimeout(t)
    }
  }, [symbol, tvInterval])

  return (
    <div
      ref={containerRef}
      className={`tradingview-widget-container tradingview-widget-container--app ${loading ? 'is-loading' : ''}`}
      aria-label="TradingView chart"
    />
  )
}

function SignalIdealPanel({ item, result }) {
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiText, setAiText] = useState('')

  if (!result) {
    return (
      <div className="trade-empty">
        Donnees en attente...
      </div>
    )
  }

  const conf = result.confluence
  if (!conf || !conf.trade || !conf.indicators) {
    return (
      <div className="trade-empty">
        Donnees en attente...
      </div>
    )
  }

  const { trade, indicators } = conf
  const signalClass =
    conf.signalTone === 'good'
      ? 'direction-pill--long'
      : conf.signalTone === 'bad'
        ? 'direction-pill--short'
        : 'direction-pill--wait'

  const fmt = (n) => {
    const v = Number(n)
    if (!Number.isFinite(v)) return '—'
    return v.toLocaleString(undefined, { maximumFractionDigits: item.decimals })
  }

  const pctFromEntry = (price) => {
    const entry = Number(trade.entry)
    const p = Number(price)
    if (!Number.isFinite(entry) || !Number.isFinite(p) || entry === 0) return null
    return ((p - entry) / entry) * 100
  }

  const slPct = pctFromEntry(trade.stopLoss)
  const tpPct = pctFromEntry(trade.takeProfit)

  const rrRaw = Number(trade.rr)
  const rrClamped = clamp(rrRaw, 1.5, 5.0)
  const rrPct = clamp(((rrClamped - 1.5) / (5.0 - 1.5)) * 100, 0, 100)
  const rrText = Number.isFinite(rrClamped) ? rrClamped.toFixed(2) : '—'

  const callClaudeAnalysis = async () => {
    setAiError('')

    const prompt = `Tu es un expert en trading. Analyse ces données techniques et donne un avis concis en français :
actif=${item.label}
scores timeframes: 1D=${conf.mtfScores['1D']} | 4H=${conf.mtfScores['4H']} | 15m=${conf.mtfScores['15m']}
indicateurs: RSI=${Number.isFinite(indicators.rsi) ? indicators.rsi.toFixed(2) : 'NA'}, MACD.hist=${Number.isFinite(indicators?.macd?.hist) ? indicators.macd.hist.toFixed(5) : 'NA'}, EMA20=${Number.isFinite(indicators.ema20) ? indicators.ema20.toFixed(4) : 'NA'}, EMA50=${Number.isFinite(indicators.ema50) ? indicators.ema50.toFixed(4) : 'NA'}, BB.width=${Number.isFinite(indicators.bb?.width) ? indicators.bb.width.toFixed(5) : 'NA'}
direction recommandee=${conf.recommendation}
checklist validee=${conf.checksPassed}/${conf.checksTotal}
Dis si c'est un bon setup ou pas et pourquoi.
Maximum 5 lignes.`

    setAiLoading(true)
    try {
      const res = await fetch('/api/claude', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ prompt, model: CLAUDE_MODEL }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        const parts = [
          data?.error,
          data?.detail,
          data?.anthropicStatus != null ? `Anthropic HTTP ${data.anthropicStatus}` : null,
          data?.phase ? `Phase: ${data.phase}` : null,
        ].filter(Boolean)
        throw new Error(
          parts.length > 0 ? parts.join('\n\n') : `Proxy HTTP ${res.status}`,
        )
      }

      setAiText(typeof data?.text === 'string' ? data.text : 'Aucune reponse IA.')
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Erreur IA')
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div className="trade-panel">
      <div className="trade-top">
        <div className={`direction-pill direction-pill--big ${signalClass}`}>
          {conf.signalBadge}
        </div>
        <div className={`score-badge score-badge--big ${scoreToBadgeClass(conf.score)}`}>{conf.score}</div>
      </div>

      <div className="panel-help">{conf.label}</div>

      <div className="trade-row">
        <div className="trade-k">Direction recommandee</div>
        <div className="trade-v mono">{conf.recommendation}</div>
      </div>

      <div className="trade-row">
        <div className="trade-k">Confluence</div>
        <div className="trade-v mono">
          {conf.checksPassed}/{conf.checksTotal} criteres valides
        </div>
      </div>

      <div className="signals">
        <div className="signals-title">Checklist</div>
        <div className="signals-row">
          {conf.checklist.map((c) => (
            <div key={c.label} className={`signal-chip ${c.ok ? 'is-green' : 'is-red'}`}>
              {c.ok ? '✅' : '❌'} {c.label}
            </div>
          ))}
        </div>
      </div>

      <div className="ai-actions">
        <button
          type="button"
          className="ai-btn"
          onClick={callClaudeAnalysis}
          disabled={aiLoading}
        >
          {aiLoading ? 'Analyse IA en cours...' : '🤖 Analyse IA'}
        </button>
      </div>

      {(aiText || aiError) && (
        <div className="ai-panel">
          <div className="ai-title">💬 Avis IA</div>
          {aiError ? (
            <div className="ai-error">{aiError}</div>
          ) : (
            <div className="ai-text">{aiText}</div>
          )}
        </div>
      )}

      <div className="trade-grid">
        <div className="trade-row">
          <div className="trade-k">Prix d&apos;entrée</div>
          <div className="trade-v mono">{fmt(trade.entry)}</div>
        </div>
        <div className="trade-row">
          <div className="trade-k">
            Stop Loss (support récent)
          </div>
          <div className="trade-v mono stop">
            {fmt(trade.stopLoss)}
            {slPct == null ? '' : ` (${slPct >= 0 ? '+' : ''}${slPct.toFixed(2)}%)`}
          </div>
        </div>
        <div className="trade-row">
          <div className="trade-k">
            Take Profit (dernier swing)
          </div>
          <div className="trade-v mono take">
            {fmt(trade.takeProfit)}
            {tpPct == null ? '' : ` (${tpPct >= 0 ? '+' : ''}${tpPct.toFixed(2)}%)`}
          </div>
        </div>
      </div>

      <div className="rr">
        <div className="rr-top">
          <div className="rr-k">Risk / Reward</div>
          <div className="rr-v mono">{rrText}</div>
        </div>
        <div className="rr-bar" aria-label="Risk reward bar">
          <div
            className="rr-fill"
            style={{
              width: `${rrPct}%`,
              background: conf.recommendation === 'SHORT'
                ? 'linear-gradient(90deg, rgba(255, 61, 90, 0.9), rgba(255, 61, 90, 0.2))'
                : conf.recommendation === 'LONG'
                ? 'linear-gradient(90deg, rgba(0, 229, 160, 0.9), rgba(0, 229, 160, 0.2))'
                : 'linear-gradient(90deg, rgba(255, 176, 32, 0.9), rgba(255, 176, 32, 0.2))',
            }}
          />
        </div>
      </div>

      <div className="signals">
        <div className="signals-title">Contexte 15m</div>
        <div className="signals-row">
          <div className={`signal-chip ${indicators.rsi >= 50 ? 'is-green' : 'is-red'}`}>
            RSI {Number.isFinite(indicators.rsi) ? indicators.rsi.toFixed(1) : '—'}
          </div>
          <div className={`signal-chip ${indicators?.macd?.hist >= 0 ? 'is-green' : 'is-red'}`}>
            MACD {Number.isFinite(indicators?.macd?.hist) ? indicators.macd.hist.toFixed(4) : '—'}
          </div>
          <div
            className={`signal-chip ${
              indicators.entry > indicators.ema20 && indicators.entry > indicators.ema50
                ? 'is-green'
                : 'is-red'
            }`}
          >
            EMA {Number.isFinite(indicators.ema20) ? indicators.ema20.toFixed(2) : '—'} /{' '}
            {Number.isFinite(indicators.ema50) ? indicators.ema50.toFixed(2) : '—'}
          </div>
          <div className="signal-chip is-green">
            BB w {Number.isFinite(indicators.bb?.width) ? indicators.bb.width.toFixed(3) : '—'}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [filter, setFilter] = useState('Tous')
  const categoryItems = useMemo(
    () =>
      filter === 'Tous' || filter === STRONG_SIGNAL_FILTER
        ? WATCHLIST
        : WATCHLIST.filter((x) => x.category === filter),
    [filter],
  )

  const [selectedTvSymbol, setSelectedTvSymbol] = useState(WATCHLIST[0].tvSymbol)
  const [selectedTimeframeId, setSelectedTimeframeId] = useState(TIMEFRAMES[0].id)
  const selectedTimeframe = useMemo(
    () => TIMEFRAMES.find((t) => t.id === selectedTimeframeId) ?? TIMEFRAMES[0],
    [selectedTimeframeId],
  )

  const selectedItem = useMemo(
    () => WATCHLIST.find((x) => x.tvSymbol === selectedTvSymbol) ?? WATCHLIST[0],
    [selectedTvSymbol],
  )

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const [scanResults, setScanResults] = useState(() => {
    const initial = {}
    for (const item of WATCHLIST) {
      const mtfMap = {}
      for (const tf of MTF_TIMEFRAMES) {
        const { computed } = simulateComputedForItem(item, null)
        mtfMap[tf.key] = computed
      }
      initial[item.tvSymbol] = { confluence: buildConfluenceResult(mtfMap) }
    }
    return initial
  })
  const [scoreHistory, setScoreHistory] = useState({})
  const [scorePulse, setScorePulse] = useState({})
  const [mobileWatchlistOpen, setMobileWatchlistOpen] = useState(false)
  const [testAlertLoading, setTestAlertLoading] = useState(false)
  const [testAlertStatus, setTestAlertStatus] = useState(null)
  const [telegramAlertsEnabled, setTelegramAlertsEnabled] = useState(() => {
    try {
      return localStorage.getItem(LS_TELEGRAM_ALERTS) === '1'
    } catch {
      return false
    }
  })
  const telegramAlertsEnabledRef = useRef(false)
  const telegramLastSentRef = useRef({})
  const lastScoreRef = useRef({})
  const scanningRef = useRef(false)
  const simStateRef = useRef({})

  useEffect(() => {
    telegramAlertsEnabledRef.current = telegramAlertsEnabled
  }, [telegramAlertsEnabled])

  useEffect(() => {
    try {
      localStorage.setItem(LS_TELEGRAM_ALERTS, telegramAlertsEnabled ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [telegramAlertsEnabled])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_TELEGRAM_LAST)
      if (raw) telegramLastSentRef.current = JSON.parse(raw)
    } catch {
      /* ignore */
    }
  }, [])

  const evaluateTelegramAlerts = useCallback(async (scanResultsMap) => {
    if (!telegramAlertsEnabledRef.current) return
    for (const item of WATCHLIST) {
      const conf = scanResultsMap[item.tvSymbol]?.confluence
      if (!conf) continue
      if (typeof conf.score !== 'number' || conf.score <= 75) continue
      if (countMtfScoresAbove75(conf.mtfScores) < 2) continue
      const last = telegramLastSentRef.current[item.tvSymbol] ?? 0
      if (Date.now() - last < TELEGRAM_COOLDOWN_MS) continue
      try {
        const text = buildTelegramAlertMessage(item, conf)
        await sendTelegramAlert(text)
        const ts = Date.now()
        telegramLastSentRef.current = {
          ...telegramLastSentRef.current,
          [item.tvSymbol]: ts,
        }
        try {
          localStorage.setItem(LS_TELEGRAM_LAST, JSON.stringify(telegramLastSentRef.current))
        } catch {
          /* ignore */
        }
      } catch (e) {
        console.error('[Telegram]', item.tvSymbol, e)
      }
    }
  }, [])

  const visibleItems = useMemo(() => {
    if (filter !== STRONG_SIGNAL_FILTER) return categoryItems
    return WATCHLIST.filter((item) => {
      const conf = scanResults[item.tvSymbol]?.confluence
      if (!conf) return false
      return conf.score > 75 && conf.trade.rr > 2 && conf.alignedCount >= 2
    })
  }, [filter, categoryItems, scanResults])

  // Keep selected symbol valid when switching filters.
  useEffect(() => {
    if (!visibleItems.some((x) => x.tvSymbol === selectedTvSymbol)) {
      setSelectedTvSymbol(visibleItems[0]?.tvSymbol ?? WATCHLIST[0].tvSymbol)
    }
  }, [visibleItems, selectedTvSymbol])

  const onPickSymbol = useCallback(
    (tvSymbol) => {
      setSelectedTvSymbol(tvSymbol)
      setMobileWatchlistOpen(false)
    },
    [setSelectedTvSymbol],
  )

  const scanNow = useCallback(async () => {
    if (scanningRef.current) return
    scanningRef.current = true

    try {
      // 1) Mettre tout de suite des scores (simulation) pour éviter les "..."
      // 2) Recalculer ensuite les cryptos à partir de Binance et remplacer les scores simulés.
      const simHistoryScores = {}
      const simPulseSyms = []

      const simUpdates = {}
      for (const item of WATCHLIST) {
        const prevGroup = simStateRef.current[item.tvSymbol] ?? {}
        const mtfMap = {}
        const nextGroup = {}

        for (const tf of MTF_TIMEFRAMES) {
          const { computed, nextSim } = simulateComputedForItem(item, prevGroup[tf.key])
          mtfMap[tf.key] = computed
          nextGroup[tf.key] = nextSim
        }

        const confluence = buildConfluenceResult(mtfMap)
        simStateRef.current[item.tvSymbol] = nextGroup
        simUpdates[item.tvSymbol] = { confluence }

        const nextScore = confluence?.score
        if (typeof nextScore === 'number') {
          simHistoryScores[item.tvSymbol] = nextScore
          const prevScore = lastScoreRef.current[item.tvSymbol]
          if (prevScore !== nextScore) simPulseSyms.push(item.tvSymbol)
          lastScoreRef.current[item.tvSymbol] = nextScore
        }
      }

      // Historique pour sparkline + animation sur changements.
      if (Object.keys(simHistoryScores).length > 0) {
        setScoreHistory((prev) => {
          const next = { ...prev }
          for (const [sym, score] of Object.entries(simHistoryScores)) {
            const arr = next[sym] ?? []
            next[sym] = [...arr, score].slice(-SCORE_HISTORY_LEN)
          }
          return next
        })

        if (simPulseSyms.length > 0) {
          setScorePulse((prev) => {
            const next = { ...prev }
            for (const sym of simPulseSyms) next[sym] = true
            return next
          })

          simPulseSyms.forEach((sym) => {
            window.setTimeout(() => {
              setScorePulse((prev) => ({ ...prev, [sym]: false }))
            }, 520)
          })
        }
      }

      setScanResults((prev) => ({ ...prev, ...simUpdates }))

      const realDataItems = WATCHLIST.filter(
        (x) => x.binanceSymbol || x.twelveSymbol,
      )
      if (realDataItems.length === 0) return

      const tasks = realDataItems.map(async (item) => {
        const mtfMap = {}
        for (const tf of MTF_TIMEFRAMES) {
          let candles = []
          if (item.binanceSymbol) {
            candles = await fetchBinanceKlines(
              item.binanceSymbol,
              tf.binanceInterval,
              BINANCE_LIMIT,
            )
          } else if (item.twelveSymbol) {
            candles = await fetchTwelveDataCandles(
              item.twelveSymbol,
              tf.twelveInterval,
              TWELVE_DATA_LIMIT,
              TWELVE_DATA_KEY,
            )
          }

          if (candles.length < 80) throw new Error('Not enough candles')
          const computed = computeIndicatorsAndTrade(candles)
          if (!computed) throw new Error('Indicators unavailable')
          mtfMap[tf.key] = computed
        }

        const confluence = buildConfluenceResult(mtfMap)
        if (!confluence) throw new Error('Confluence unavailable')
        return { tvSymbol: item.tvSymbol, confluence }
      })

      const settled = await Promise.allSettled(tasks)
      const finalUpdates = {}
      const finalHistoryScores = {}
      const finalPulseSyms = []

      for (const s of settled) {
        if (s.status !== 'fulfilled') continue
        const { tvSymbol, confluence } = s.value
        finalUpdates[tvSymbol] = { confluence }

        const nextScore = confluence?.score
        if (typeof nextScore === 'number') {
          finalHistoryScores[tvSymbol] = nextScore
          const prevScore = lastScoreRef.current[tvSymbol]
          if (prevScore !== nextScore) finalPulseSyms.push(tvSymbol)
          lastScoreRef.current[tvSymbol] = nextScore
        }
      }

      if (Object.keys(finalHistoryScores).length > 0) {
        setScoreHistory((prev) => {
          const next = { ...prev }
          for (const [sym, score] of Object.entries(finalHistoryScores)) {
            const arr = next[sym] ?? []
            next[sym] = [...arr, score].slice(-SCORE_HISTORY_LEN)
          }
          return next
        })

        if (finalPulseSyms.length > 0) {
          setScorePulse((prev) => {
            const next = { ...prev }
            for (const sym of finalPulseSyms) next[sym] = true
            return next
          })

          finalPulseSyms.forEach((sym) => {
            window.setTimeout(() => {
              setScorePulse((prev) => ({ ...prev, [sym]: false }))
            }, 520)
          })
        }
      }

      setScanResults((prev) => {
        const next = { ...prev, ...finalUpdates }
        if (
          telegramAlertsEnabledRef.current &&
          Object.keys(finalUpdates).length > 0
        ) {
          void evaluateTelegramAlerts(next)
        }
        return next
      })
    } catch (err) {
      console.error(err)
    } finally {
      scanningRef.current = false
    }
  }, [evaluateTelegramAlerts])

  const handleTestAlert = useCallback(async () => {
    setTestAlertStatus(null)
    setTestAlertLoading(true)
    const time = new Date().toLocaleString('fr-FR', {
      dateStyle: 'short',
      timeStyle: 'medium',
    })
    const text = [
      '🧪 TEST ALERTE - Scanner Pro',
      `📊 Score : 85/100`,
      `📈 Direction : LONG`,
      `⏱ Confluence : 6/7 critères`,
      `💰 Entrée : 65 000`,
      `🛑 Stop Loss : 63 200`,
      `🎯 Take Profit : 72 000`,
      `⚖️ R/R : 2.85`,
      `⏰ ${time}`,
    ].join('\n')
    try {
      console.log('[handleTestAlert] Envoi alerte test...')
      await sendTelegramAlert(text)
      console.log('[handleTestAlert] OK')
      setTestAlertStatus('ok')
      setTimeout(() => setTestAlertStatus(null), 3000)
    } catch (err) {
      console.error('[handleTestAlert] Erreur:', err)
      setTestAlertStatus(err instanceof Error ? err.message : 'Erreur')
      setTimeout(() => setTestAlertStatus(null), 4000)
    } finally {
      setTestAlertLoading(false)
    }
  }, [])

  useEffect(() => {
    scanNow()
    const id = window.setInterval(scanNow, POLL_MS)
    return () => window.clearInterval(id)
  }, [scanNow])

  useEffect(() => {
    // Reset history + simulation when switching timeframe.
    setScoreHistory({})
    setScorePulse({})
    lastScoreRef.current = {}
    simStateRef.current = {}
  }, [selectedTimeframeId])

  const selectedResult = scanResults[selectedTvSymbol]
  const selectedComputed = selectedResult && selectedResult.confluence ? selectedResult : null

  return (
    <div className="scanner-app">
      <header className="scanner-header">
        <div className="brand">
          <div className="brand-title">
            Scanner Pro
            <span className="brand-accent">™</span>
          </div>
          <div className="brand-subtitle">
            TradingView chart + EMA/RSI/MACD/BB (scores 0-100) selon timeframe
          </div>
        </div>

        <div className="header-right">
          <button
            type="button"
            className={`telegram-toggle ${telegramAlertsEnabled ? 'is-on' : ''}`}
            onClick={() => setTelegramAlertsEnabled((v) => !v)}
            title={
              telegramAlertsEnabled
                ? 'Alertes Telegram activées (clic pour désactiver)'
                : 'Alertes Telegram désactivées (clic pour activer)'
            }
            aria-pressed={telegramAlertsEnabled}
            aria-label="Activer ou désactiver les alertes Telegram"
          >
            {telegramAlertsEnabled ? '🔔' : '🔕'}
          </button>
          <button
            type="button"
            className="telegram-test-btn"
            onClick={handleTestAlert}
            disabled={testAlertLoading}
            title={
              testAlertStatus && testAlertStatus !== 'ok'
                ? testAlertStatus
                : 'Envoyer une alerte de test sur Telegram'
            }
            aria-label="Tester l’envoi d’une alerte Telegram"
          >
            {testAlertLoading
              ? 'Envoi…'
              : testAlertStatus === 'ok'
                ? '✅ Envoyé'
                : testAlertStatus
                  ? '❌'
                  : '🧪 Test Alerte'}
          </button>
          <button
            type="button"
            className="hamburger-btn mobile-only"
            onClick={() => setMobileWatchlistOpen(true)}
            aria-label="Open watchlist menu"
          >
            ☰
          </button>
          <div className="clock mono">{formatClock(now)}</div>
          <div className="live-pill">
            <span className="live-dot" />
            LIVE
          </div>
        </div>
      </header>

      <main className="scanner-grid">
        <aside className="panel panel-left desktop-only">
          <WatchlistPanel
            visibleItems={visibleItems}
            selectedTvSymbol={selectedTvSymbol}
            scanResults={scanResults}
            filter={filter}
            setFilter={setFilter}
            onPickSymbol={onPickSymbol}
            scoreHistory={scoreHistory}
            scorePulse={scorePulse}
          />
        </aside>

        <div
          className={`mobile-watchlist-overlay ${mobileWatchlistOpen ? 'is-open' : ''} mobile-only`}
          role="dialog"
          aria-modal="true"
          aria-label="Watchlist"
          aria-hidden={!mobileWatchlistOpen}
        >
          <div className="mobile-watchlist-sheet">
            <div className="mobile-sheet-top">
              <div className="mobile-sheet-title">Watchlist</div>
              <button
                type="button"
                className="mobile-sheet-close"
                onClick={() => setMobileWatchlistOpen(false)}
                aria-label="Close watchlist menu"
              >
                ✕
              </button>
            </div>

            <div className="mobile-sheet-content">
              <WatchlistPanel
                visibleItems={visibleItems}
                selectedTvSymbol={selectedTvSymbol}
                scanResults={scanResults}
                filter={filter}
                setFilter={setFilter}
                onPickSymbol={onPickSymbol}
                scoreHistory={scoreHistory}
                scorePulse={scorePulse}
              />
            </div>
          </div>
        </div>

        <section className="panel panel-center">
          <div className="panel-header">
            <div>
              <div className="panel-title">Chart temps reel</div>
              <div className="panel-subtitle">{selectedItem.label} (TradingView)</div>
            </div>
            <div className="panel-badge mono">{selectedTimeframeId}</div>
          </div>

          <div className="timeframe-block">
            <div className="timeframe-buttons" role="tablist" aria-label="Timeframe">
              {TIMEFRAMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`timeframe-btn ${selectedTimeframeId === t.id ? 'is-active' : ''}`}
                  onClick={() => setSelectedTimeframeId(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="timeframe-context">{selectedTimeframe.context}</div>
          </div>

          <div className="tv-shell">
            <TradingViewAdvancedChart
              symbol={selectedTvSymbol}
              tvInterval={selectedTimeframe.tradingViewInterval}
            />
          </div>
        </section>

        <aside className="panel panel-right">
          <div className="panel-title">Signal ideal</div>
          <SignalIdealPanel item={selectedItem} result={selectedComputed} />
        </aside>
      </main>

      <footer className="scanner-footer">
        Scores multi-timeframe 1D/4H/15m. Sources: Binance (crypto) + Twelve Data (forex/indices/matieres). Chart: TradingView ({selectedTimeframe.tradingViewInterval}).
      </footer>
    </div>
  )
}
