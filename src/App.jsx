import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const POLL_MS = 30000
const BINANCE_INTERVAL = '15m'
const BINANCE_LIMIT = 100

const FILTERS = ['Tous', 'Crypto', 'Forex', 'Indices', 'Matières']

const WATCHLIST = [
  // Crypto
  { label: 'BTC/USDT', category: 'Crypto', tvSymbol: 'BINANCE:BTCUSDT', binanceSymbol: 'BTCUSDT', decimals: 2, simBasePrice: 65000 },
  { label: 'ETH/USDT', category: 'Crypto', tvSymbol: 'BINANCE:ETHUSDT', binanceSymbol: 'ETHUSDT', decimals: 2, simBasePrice: 3200 },
  { label: 'SOL/USDT', category: 'Crypto', tvSymbol: 'BINANCE:SOLUSDT', binanceSymbol: 'SOLUSDT', decimals: 2, simBasePrice: 170 },
  { label: 'XRP/USDT', category: 'Crypto', tvSymbol: 'BINANCE:XRPUSDT', binanceSymbol: 'XRPUSDT', decimals: 4, simBasePrice: 0.52 },
  { label: 'BNB/USDT', category: 'Crypto', tvSymbol: 'BINANCE:BNBUSDT', binanceSymbol: 'BNBUSDT', decimals: 2, simBasePrice: 600 },

  // Forex
  { label: 'EUR/USD', category: 'Forex', tvSymbol: 'FX:EURUSD', decimals: 5, simBasePrice: 1.08 },
  { label: 'GBP/USD', category: 'Forex', tvSymbol: 'FX:GBPUSD', decimals: 5, simBasePrice: 1.28 },

  // Indices
  { label: 'NAS100', category: 'Indices', tvSymbol: 'TVC:NDX', decimals: 2, simBasePrice: 18000 },
  { label: 'SP500', category: 'Indices', tvSymbol: 'TVC:SPX', decimals: 2, simBasePrice: 5200 },

  // Matières
  { label: 'XAU/USD', category: 'Matières', tvSymbol: 'OANDA:XAUUSD', decimals: 2, simBasePrice: 2200 },
  { label: 'XAG/USD', category: 'Matières', tvSymbol: 'OANDA:XAGUSD', decimals: 2, simBasePrice: 26 },
]

const SIM_PROFILE_BY_CATEGORY = {
  Crypto: { entryVolPct: 0.004, atrPct: 0.012, emaDiffPct: 0.010 },
  Forex: { entryVolPct: 0.0006, atrPct: 0.0012, emaDiffPct: 0.0025 },
  Indices: { entryVolPct: 0.0035, atrPct: 0.008, emaDiffPct: 0.010 },
  'Matières': { entryVolPct: 0.0025, atrPct: 0.006, emaDiffPct: 0.009 },
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

  return { macd: macdLast, signal: signalLast, hist }
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

function scoreToBadgeClass(score) {
  if (score > 65) return 'badge--good'
  if (score >= 40) return 'badge--mid'
  return 'badge--bad'
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

  const stopLoss = isLong ? entry - atr * 1.5 : entry + atr * 1.5
  const takeProfit = isLong ? entry + atr * 4 : entry - atr * 4
  const rr = Math.abs(takeProfit - entry) / Math.abs(entry - stopLoss)

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

  // Trade levels based on ATR multipliers.
  const stopLoss = isLong ? entry - atr * 1.5 : entry + atr * 1.5
  const takeProfit = isLong ? entry + atr * 4 : entry - atr * 4
  const rr = Math.abs(takeProfit - entry) / Math.abs(entry - stopLoss)

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

function TradingViewAdvancedChart({ symbol }) {
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
      interval: '15',
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
  }, [symbol])

  return (
    <div
      ref={containerRef}
      className={`tradingview-widget-container tradingview-widget-container--app ${loading ? 'is-loading' : ''}`}
      aria-label="TradingView chart"
    />
  )
}

function TradeAutoPanel({ item, result }) {
  if (!result) {
    return (
      <div className="trade-empty">
        Donnees en attente...
      </div>
    )
  }

  const { trade, score, signals, indicators } = result
  if (!trade || !indicators) {
    return (
      <div className="trade-empty">
        Donnees en attente...
      </div>
    )
  }

  const isLong = trade.direction === 'LONG'
  const badgeClass = typeof score === 'number' ? scoreToBadgeClass(score) : 'badge--neutral'

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

  const rrPct = clamp((Number(trade.rr) / 3) * 100, 0, 100)
  const rr = Number(trade.rr)
  const rrText = Number.isFinite(rr) ? rr.toFixed(2) : '—'

  const signalChip = (key, label, value) => {
    const active = Boolean(signals?.[key])
    const cls = `signal-chip ${active ? 'is-green' : 'is-red'}`
    return (
      <div className={cls}>
        {label} {value}
      </div>
    )
  }

  return (
    <div className="trade-panel">
      <div className="trade-top">
        <div
          className={`direction-pill direction-pill--big ${
            isLong ? 'direction-pill--long' : 'direction-pill--short'
          }`}
        >
          {trade.direction}
        </div>
        <div className={`score-badge score-badge--big ${badgeClass}`}>
          {typeof score === 'number' ? score : '—'}
        </div>
      </div>

      <div className="trade-grid">
        <div className="trade-row">
          <div className="trade-k">Prix d&apos;entrée</div>
          <div className="trade-v mono">{fmt(trade.entry)}</div>
        </div>
        <div className="trade-row">
          <div className="trade-k">
            Stop Loss (ATR x1.5)
          </div>
          <div className="trade-v mono stop">
            {fmt(trade.stopLoss)}
            {slPct == null ? '' : ` (${slPct >= 0 ? '+' : ''}${slPct.toFixed(2)}%)`}
          </div>
        </div>
        <div className="trade-row">
          <div className="trade-k">
            Take Profit (ATR x4)
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
              background: isLong
                ? 'linear-gradient(90deg, rgba(0, 229, 160, 0.9), rgba(0, 229, 160, 0.2))'
                : 'linear-gradient(90deg, rgba(255, 61, 90, 0.9), rgba(255, 61, 90, 0.2))',
            }}
          />
        </div>
      </div>

      <div className="signals">
        <div className="signals-title">Signaux actifs</div>
        <div className="signals-row">
          {signalChip(
            'RSI',
            'RSI',
            Number.isFinite(indicators.rsi) ? indicators.rsi.toFixed(1) : '—',
          )}
          {signalChip(
            'MACD',
            'MACD',
            Number.isFinite(indicators?.macd?.hist)
              ? indicators.macd.hist.toFixed(4)
              : '—',
          )}
          {signalChip(
            'EMA',
            'EMA',
            `${Number.isFinite(indicators.ema20) ? indicators.ema20.toFixed(2) : '—'} / ${
              Number.isFinite(indicators.ema50) ? indicators.ema50.toFixed(2) : '—'
            }`,
          )}
          {signalChip(
            'BB',
            'BB',
            Number.isFinite(indicators.bb?.width) ? indicators.bb.width.toFixed(3) : '—',
          )}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [filter, setFilter] = useState('Tous')
  const visibleItems = useMemo(
    () => (filter === 'Tous' ? WATCHLIST : WATCHLIST.filter((x) => x.category === filter)),
    [filter],
  )

  const [selectedTvSymbol, setSelectedTvSymbol] = useState(WATCHLIST[0].tvSymbol)

  // Keep selected symbol valid when switching filters.
  useEffect(() => {
    if (!visibleItems.some((x) => x.tvSymbol === selectedTvSymbol)) {
      setSelectedTvSymbol(visibleItems[0]?.tvSymbol ?? WATCHLIST[0].tvSymbol)
    }
  }, [visibleItems, selectedTvSymbol])

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
      const { computed } = simulateComputedForItem(item, null)
      initial[item.tvSymbol] = computed
    }
    return initial
  })
  const scanningRef = useRef(false)
  const simStateRef = useRef({})

  const scanNow = useCallback(async () => {
    if (scanningRef.current) return
    scanningRef.current = true

    try {
      // 1) Mettre tout de suite des scores (simulation) pour éviter les "..."
      // 2) Recalculer ensuite les cryptos à partir de Binance et remplacer les scores simulés.
      const simUpdates = {}
      for (const item of visibleItems) {
        const prevSim = simStateRef.current[item.tvSymbol]
        const { computed, nextSim } = simulateComputedForItem(item, prevSim)
        simStateRef.current[item.tvSymbol] = nextSim
        simUpdates[item.tvSymbol] = computed
      }
      setScanResults((prev) => ({ ...prev, ...simUpdates }))

      const cryptoItems = visibleItems.filter(
        (x) => x.category === 'Crypto' && x.binanceSymbol,
      )
      if (cryptoItems.length === 0) return

      const tasks = cryptoItems.map(async (item) => {
        const candles = await fetchBinanceKlines(
          item.binanceSymbol,
          BINANCE_INTERVAL,
          BINANCE_LIMIT,
        )
        // Need enough candles for EMA20/50 etc.
        if (candles.length < 80) throw new Error('Not enough candles')
        const computed = computeIndicatorsAndTrade(candles)
        if (!computed) throw new Error('Indicators unavailable')
        return { tvSymbol: item.tvSymbol, computed }
      })

      const settled = await Promise.allSettled(tasks)
      const finalUpdates = {}
      for (const s of settled) {
        if (s.status !== 'fulfilled') continue
        const { tvSymbol, computed } = s.value
        finalUpdates[tvSymbol] = computed
        simStateRef.current[tvSymbol] = {
          score: computed.score,
          entry: computed.indicators.entry,
        }
      }

      setScanResults((prev) => ({ ...prev, ...finalUpdates }))
    } catch (err) {
      console.error(err)
    } finally {
      scanningRef.current = false
    }
  }, [visibleItems])

  useEffect(() => {
    scanNow()
    const id = window.setInterval(scanNow, POLL_MS)
    return () => window.clearInterval(id)
  }, [visibleItems, scanNow])

  const selectedResult = scanResults[selectedTvSymbol]
  const selectedComputed = selectedResult && selectedResult.score != null ? selectedResult : null

  return (
    <div className="scanner-app">
      <header className="scanner-header">
        <div className="brand">
          <div className="brand-title">Bloomberg Scanner</div>
          <div className="brand-subtitle">TradingView embed + signaux EMA/RSI/MACD/BB</div>
        </div>

        <div className="header-right">
          <div className="clock mono">{formatClock(now)}</div>
          <div className="live-pill">
            <span className="live-dot" />
            LIVE
          </div>
        </div>
      </header>

      <main className="scanner-grid">
        <aside className="panel panel-left">
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
              const score = result && result.score != null ? result.score : null
              const badgeClass = score == null ? 'badge--neutral' : scoreToBadgeClass(score)
              return (
                <button
                  key={item.tvSymbol}
                  type="button"
                  className={`watchlist-item ${isActive ? 'is-active' : ''}`}
                  onClick={() => setSelectedTvSymbol(item.tvSymbol)}
                >
                  <span className="watchlist-label">{item.label}</span>
                  <span className={`score-badge ${badgeClass}`}>
                    {score == null ? '...' : score}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="panel-help">
            Scores recalcules toutes les {Math.round(POLL_MS / 1000)}s (source: Stooq).
          </div>
        </aside>

        <section className="panel panel-center">
          <div className="panel-header">
            <div>
              <div className="panel-title">Chart temps reel</div>
              <div className="panel-subtitle">{selectedItem.label} (TradingView)</div>
            </div>
            <div className="panel-badge mono">15m</div>
          </div>

          <div className="tv-shell">
            <TradingViewAdvancedChart symbol={selectedTvSymbol} />
          </div>
        </section>

        <aside className="panel panel-right">
          <div className="panel-title">Trade auto</div>
          <TradeAutoPanel item={selectedItem} result={selectedComputed} />
        </aside>
      </main>

      <footer className="scanner-footer">
        Cryptos: Binance klines ({BINANCE_INTERVAL}, {BINANCE_LIMIT}). Forex/Indices: scores simulés. Chart: TradingView (15m).
      </footer>
    </div>
  )
}
