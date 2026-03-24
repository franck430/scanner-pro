import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const POLL_MS = 30000
const BINANCE_LIMIT = 100
const TWELVE_DATA_LIMIT = 100
const BACKTEST_BARS = 200
const BACKTEST_FETCH_LIMIT = 1000
const SCORE_HISTORY_LEN = 24
const TWELVE_DATA_KEY = import.meta.env.VITE_TWELVE_DATA_KEY
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'

/** Résumé divergences avant le premier scan réel (pas de bougies OHLC). */
function getDivergencePlaceholderSummary(item) {
  if (item?.twelveSymbol && !TWELVE_DATA_KEY) {
    return 'Clé Twelve Data manquante (VITE_TWELVE_DATA_KEY). Les divergences RSI/MACD seront calculées sur les bougies Twelve Data une fois la clé configurée.'
  }
  if (item?.twelveSymbol && TWELVE_DATA_KEY) {
    return 'Chargement des bougies Twelve Data (Forex / matières) — divergences calculées après réception des OHLC.'
  }
  if (item?.binanceSymbol) {
    return 'Chargement des bougies Binance — divergences calculées après réception des OHLC.'
  }
  return 'En attente du premier scan réel pour calculer les divergences.'
}

const TELEGRAM_COOLDOWN_MS = 30 * 60 * 1000
const LS_TELEGRAM_ALERTS = 'scanner-pro-telegram-alerts'
const LS_TELEGRAM_LAST = 'scanner-pro-telegram-last-alert'
const LS_CALENDAR_CACHE = 'scanner-pro-calendar-cache'
const CALENDAR_CLIENT_TTL_MS = 60 * 60 * 1000
const LS_POSITION_CAPITAL = 'scanner-pro-position-capital'
const LS_POSITION_RISK = 'scanner-pro-position-risk'
const LS_POSITION_ACCOUNT = 'scanner-pro-position-account-type'
const LS_FAVORITES = 'scanner-pro-favorites'

/** Unités de base par lot forex (MT4) selon type de compte */
const FOREX_LOT_UNITS = { Standard: 100000, Mini: 10000, Micro: 1000 }

const FAVORITES_FILTER = '⭐ Favoris'
const FILTERS = ['Tous', FAVORITES_FILTER, 'Crypto', 'Forex', 'Matières', '🔥 Signaux forts']
const STRONG_SIGNAL_FILTER = '🔥 Signaux forts'

function readFavoritesFromStorage() {
  try {
    const raw = localStorage.getItem(LS_FAVORITES)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

// Twelve Data: 15min pour Forex intraday (au lieu de 1day)
const MTF_TIMEFRAMES = [
  { key: '1D', binanceInterval: '1d', twelveInterval: '15min' },
  { key: '4H', binanceInterval: '4h', twelveInterval: '4h' },
  { key: '15m', binanceInterval: '15m', twelveInterval: '15min' },
]

const TIMEFRAMES = [
  { id: '1m', label: '1m', binanceInterval: '1m', twelveInterval: '1min', tradingViewInterval: '1', context: 'Scalping' },
  { id: '5m', label: '5m', binanceInterval: '5m', twelveInterval: '5min', tradingViewInterval: '5', context: 'Scalping' },
  { id: '15m', label: '15m', binanceInterval: '15m', twelveInterval: '15min', tradingViewInterval: '15', context: 'Scalping / Day trading' },
  { id: '1H', label: '1H', binanceInterval: '1h', twelveInterval: '1h', tradingViewInterval: '60', context: 'Day trading' },
  { id: '4H', label: '4H', binanceInterval: '4h', twelveInterval: '4h', tradingViewInterval: '240', context: 'Swing trading' },
  { id: '1D', label: '1D', binanceInterval: '1d', twelveInterval: '1day', tradingViewInterval: 'D', context: 'Position trading' },
  { id: '1W', label: '1W', binanceInterval: '1w', twelveInterval: '1week', tradingViewInterval: 'W', context: 'Trading long terme' },
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

  // Matières (Twelve Data)
  { label: 'XAU/USD', category: 'Matières', tvSymbol: 'OANDA:XAUUSD', twelveSymbol: 'XAU/USD', decimals: 2, simBasePrice: 2200 },
  { label: 'XAG/USD', category: 'Matières', tvSymbol: 'OANDA:XAGUSD', twelveSymbol: 'XAG/USD', decimals: 2, simBasePrice: 26 },
  { label: 'WTI/USD', category: 'Matières', tvSymbol: 'TVC:USOIL', twelveSymbol: 'WTI/USD', decimals: 2, simBasePrice: 75 },
]

const SIM_PROFILE_BY_CATEGORY = {
  Crypto: { entryVolPct: 0.004, atrPct: 0.012, emaDiffPct: 0.010 },
  Forex: { entryVolPct: 0.0006, atrPct: 0.0012, emaDiffPct: 0.0025 },
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
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const parts = [data.error, data.detail].filter(Boolean)
    throw new Error(parts.length > 0 ? parts.join('\n\n') : `Telegram HTTP ${res.status}`)
  }
  return data
}

async function sendTelegramTestAlert(text) {
  const url = '/api/telegram'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  const data = await res.json().catch(() => ({ error: 'Réponse non-JSON' }))
  return { ok: res.ok && data?.ok, ...data }
}

function Sparkline({ values, tone }) {
  const w = 120
  const h = 36
  if (!Array.isArray(values) || values.length < 2) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1

  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - 4 - ((v - min) / span) * (h - 8)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  const linePts = pts.join(' ')
  const firstX = values.map((_, i) => (i / (values.length - 1)) * w)[0]
  const lastX = w
  const areaPts = `${linePts} ${lastX},${h} ${firstX},${h}`

  const gid = tone === 'good' ? 'sparkGradGood' : tone === 'bad' ? 'sparkGradBad' : 'sparkGradMid'
  const stroke =
    tone === 'good' ? '#00e5a0' : tone === 'bad' ? '#ff3d5a' : '#ffb020'

  return (
    <svg
      className="sparkline sparkline-full"
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="sparkGradGood" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(0,229,160,0.35)" />
          <stop offset="100%" stopColor="rgba(0,229,160,0)" />
        </linearGradient>
        <linearGradient id="sparkGradBad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(255,61,90,0.35)" />
          <stop offset="100%" stopColor="rgba(255,61,90,0)" />
        </linearGradient>
        <linearGradient id="sparkGradMid" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(255,176,32,0.3)" />
          <stop offset="100%" stopColor="rgba(255,176,32,0)" />
        </linearGradient>
      </defs>
      <polygon className="sparkline-area" points={areaPts} fill={`url(#${gid})`} />
      <polyline
        points={linePts}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="sparkline-line"
      />
    </svg>
  )
}

/** Anneau de score 0–100 (TradingView / terminal style) */
function ScoreRing({ score, size = 104, strokeWidth = 7, labelClass = '' }) {
  const dim = size
  const r = (dim - strokeWidth) / 2 - 1
  const c = 2 * Math.PI * r
  const pct = clamp(Number(score) || 0, 0, 100)
  const offset = c * (1 - pct / 100)
  const badge = scoreToBadgeClass(score)
  return (
    <svg
      className={`score-ring-svg ${labelClass}`}
      width={dim}
      height={dim}
      viewBox={`0 0 ${dim} ${dim}`}
      aria-hidden="true"
    >
      <circle
        className="score-ring-track"
        cx={dim / 2}
        cy={dim / 2}
        r={r}
        fill="none"
        strokeWidth={strokeWidth}
      />
      <circle
        className={`score-ring-progress ${badge}`}
        cx={dim / 2}
        cy={dim / 2}
        r={r}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${dim / 2} ${dim / 2})`}
      />
      <text
        x={dim / 2}
        y={dim / 2}
        dominantBaseline="middle"
        textAnchor="middle"
        className="score-ring-label mono"
      >
        {Math.round(score)}
      </text>
    </svg>
  )
}

function mtfBadgeClass(score) {
  if (score == null || !Number.isFinite(score)) return 'mtf-badge--na'
  if (score > 75) return 'mtf-badge--good'
  if (score >= 50) return 'mtf-badge--mid'
  return 'mtf-badge--bad'
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
  macroContext,
  favoriteSymbols,
  onToggleFavorite,
}) {
  const favoriteSet = useMemo(() => new Set(favoriteSymbols), [favoriteSymbols])

  const { favoriteRows, otherRows } = useMemo(() => {
    const favoriteRows = []
    const otherRows = []
    for (const item of visibleItems) {
      if (favoriteSet.has(item.tvSymbol)) favoriteRows.push(item)
      else otherRows.push(item)
    }
    return { favoriteRows, otherRows }
  }, [visibleItems, favoriteSet])

  const renderItem = (item) => {
    const isActive = item.tvSymbol === selectedTvSymbol
    const isFavorite = favoriteSet.has(item.tvSymbol)
    const result = scanResults[item.tvSymbol]
    const adj = result?.confluence
      ? applyMacroToConfluence(result.confluence, macroContext)
      : null
    const score = typeof adj?.score === 'number' ? adj.score : null
    const mtfScores = result?.confluence?.mtfScores

    const values = (scoreHistory[item.tvSymbol] && scoreHistory[item.tvSymbol].length >= 2)
      ? scoreHistory[item.tvSymbol]
      : typeof score === 'number'
        ? [score, score]
        : [50, 50]

    const tone = score == null ? 'mid' : score > 65 ? 'good' : score < 40 ? 'bad' : 'mid'

    return (
      <div key={item.tvSymbol} className="watchlist-item-wrap">
        <div
          className={`watchlist-item ${isActive ? 'is-active' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => onPickSymbol(item.tvSymbol)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onPickSymbol(item.tvSymbol)
            }
          }}
        >
          <div className="watchlist-item-head">
            <span className="watchlist-label-row">
              <button
                type="button"
                className="watchlist-star"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleFavorite(item.tvSymbol)
                }}
                aria-pressed={isFavorite}
                aria-label={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                title={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              >
                {isFavorite ? '⭐' : '☆'}
              </button>
              <span className="watchlist-label">{item.label}</span>
            </span>
            <div
              className={`watchlist-score-wrap ${scorePulse[item.tvSymbol] ? 'watchlist-score-pulse' : ''}`}
            >
              {score == null ? (
                <span className="watchlist-score-dash mono">—</span>
              ) : (
                <ScoreRing score={score} size={56} strokeWidth={5} />
              )}
            </div>
          </div>
          <div className="watchlist-mtf-badges">
            {[
              { key: '1D', label: '1D' },
              { key: '4H', label: '4H' },
              { key: '15m', label: '15m' },
            ].map(({ key, label }) => {
              const v = mtfScores?.[key]
              return (
                <span key={key} className={`mtf-badge ${mtfBadgeClass(v)}`}>
                  {label} {v == null ? '—' : v}
                </span>
              )
            })}
          </div>
          <div className="watchlist-sparkline-wrap">
            <Sparkline values={values} tone={tone} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="panel-title syne">Watchlist</div>

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
        {visibleItems.length === 0 && (
          <div className="watchlist-empty">
            {filter === FAVORITES_FILTER ? 'Aucun favori — cliquez sur ☆ pour en ajouter.' : 'Aucun actif dans ce filtre.'}
          </div>
        )}
        {favoriteRows.map(renderItem)}
        {favoriteRows.length > 0 && otherRows.length > 0 && (
          <div className="watchlist-separator" role="separator" aria-hidden="true">
            <span className="watchlist-separator-line" />
            <span className="watchlist-separator-text">Autres actifs</span>
            <span className="watchlist-separator-line" />
          </div>
        )}
        {otherRows.map(renderItem)}
      </div>

      <div className="panel-help">Scores recalcules toutes les {Math.round(POLL_MS / 1000)}s.</div>
    </>
  )
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

/**
 * Montant risqué = capital × risque%
 * Distance SL = |entrée − SL| / entrée (fraction)
 * Taille position (€) = montant risqué / distance SL
 * Lots recommandés = taille position / prix entrée (unités d’actif)
 */
function computePositionSizing(capital, riskPct, entry, stopLoss, accountType) {
  const e = Number(entry)
  const sl = Number(stopLoss)
  const cap = Number(capital)
  const r = Number(riskPct)
  if (!Number.isFinite(e) || e <= 0 || !Number.isFinite(sl) || !Number.isFinite(cap) || cap <= 0) return null
  if (!Number.isFinite(r) || r <= 0) return null
  const d = Math.abs(e - sl) / e
  if (d <= 0 || !Number.isFinite(d)) return null
  const distanceSlPct = d * 100
  const montantRisque = cap * (r / 100)
  const taillePosition = montantRisque / d
  const lotsRecommended = taillePosition / e
  const lotUnits = FOREX_LOT_UNITS[accountType] ?? FOREX_LOT_UNITS.Standard
  const forexLotsEquivalent = lotsRecommended / lotUnits
  const exposurePctOfCapital = (taillePosition / cap) * 100
  const tooLarge = taillePosition > cap * 0.2
  return {
    montantRisque,
    distanceSlPct,
    taillePosition,
    lotsRecommended,
    forexLotsEquivalent,
    exposurePctOfCapital,
    tooLarge,
  }
}

function positionRiskTier(riskPct) {
  const x = Number(riskPct)
  if (!Number.isFinite(x)) return 'orange'
  if (x < 1) return 'green'
  if (x <= 2) return 'orange'
  return 'red'
}

function readPositionCapital() {
  try {
    const c = parseFloat(localStorage.getItem(LS_POSITION_CAPITAL))
    if (Number.isFinite(c) && c > 0) return c
  } catch {
    /* ignore */
  }
  return 10000
}

function readPositionRisk() {
  try {
    const x = parseFloat(localStorage.getItem(LS_POSITION_RISK))
    if (Number.isFinite(x) && x > 0) return x
  } catch {
    /* ignore */
  }
  return 1
}

function readPositionAccount() {
  try {
    const a = localStorage.getItem(LS_POSITION_ACCOUNT)
    if (a === 'Standard' || a === 'Mini' || a === 'Micro') return a
  } catch {
    /* ignore */
  }
  return 'Standard'
}

/** Ajuste le score confluence selon Fear & Greed (crypto) */
function applyMacroToConfluence(confluence, macro) {
  if (!confluence) return null
  const fg = macro?.fearGreedValue
  let score = confluence.score
  if (fg != null && Number.isFinite(fg) && fg < 25) score = clamp(score - 5, 0, 100)
  if (fg != null && Number.isFinite(fg) && fg > 75) score = clamp(score + 5, 0, 100)
  return {
    ...confluence,
    score,
    macroWarning: macro?.macroImminent === true,
    fearGreedAdj: fg != null && fg < 25 ? 'SHORT' : fg != null && fg > 75 ? 'LONG' : null,
  }
}

function fearGreedLabel(value) {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value <= 24) return 'Extreme Fear'
  if (value <= 44) return 'Fear'
  if (value <= 55) return 'Neutral'
  if (value <= 75) return 'Greed'
  return 'Extreme Greed'
}

function fearGreedEmoji(value) {
  if (value == null || !Number.isFinite(value)) return '⚪'
  if (value <= 24) return '🔴'
  if (value <= 44) return '🟡'
  if (value <= 55) return '⚪'
  if (value <= 75) return '🟢'
  return '🔵'
}

function parseCalendarEventTime(e) {
  if (!e?.date) return null
  const d = String(e.date)
  if (d.includes('T')) {
    const t = Date.parse(d)
    return Number.isFinite(t) ? t : null
  }
  const time = e.time && String(e.time).trim() ? String(e.time).trim() : '12:00:00'
  const iso = `${d}T${time.length <= 5 ? `${time}:00` : time}`
  const t = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`)
  return Number.isFinite(t) ? t : null
}

function hasHighImpactMacroWithin2h(events) {
  if (!Array.isArray(events)) return false
  const now = Date.now()
  const windowMs = 2 * 60 * 60 * 1000
  for (const e of events) {
    if (e.impact !== 'high') continue
    const t = parseCalendarEventTime(e)
    if (t == null) continue
    if (t >= now && t <= now + windowMs) return true
  }
  return false
}

function impactBadge(impact) {
  if (impact === 'high') return '🔴 High'
  if (impact === 'medium') return '🟡 Medium'
  return '🟢 Low'
}

function newsCardImpactClass(impact) {
  if (impact === 'high') return 'news-card--high'
  if (impact === 'medium') return 'news-card--medium'
  return 'news-card--low'
}

function NewsPanel({ articles, calendarEvents, newsError, calendarError }) {
  return (
    <div className="news-panel">
      <div className="news-panel-title syne">Actualites & calendrier</div>
      <p className="panel-help news-hint">
        Bonus score : FG &lt; 25 → SHORT | FG &gt; 75 → LONG. Fear & Greed affiche dans le header.
      </p>

      <div className="news-subtitle syne">Calendrier (NFP, CPI, FOMC, PIB…)</div>
      {calendarError && <div className="news-error">{calendarError}</div>}
      {!calendarEvents?.length && !calendarError && (
        <div className="news-empty">Aucun evenement cette semaine</div>
      )}
      <ul className="news-list news-calendar">
        {(calendarEvents || []).slice(0, 6).map((e, i) => (
          <li
            key={`${e.date}-${e.title}-${i}`}
            className={`news-item news-card ${newsCardImpactClass(e.impact)}`}
            style={{ animationDelay: `${i * 45}ms` }}
          >
            <div className="news-item-title">{e.title}</div>
            <div className="news-item-meta">
              {e.displayTime || e.date} · {impactBadge(e.impact)}
            </div>
          </li>
        ))}
      </ul>

      <div className="news-subtitle syne">Dernieres news</div>
      {newsError && <div className="news-error">{newsError}</div>}
      {!articles?.length && !newsError && (
        <div className="news-empty">Aucune news (ajoutez NEWS_API_KEY NewsAPI.org)</div>
      )}
      <ul className="news-list">
        {(articles || []).slice(0, 5).map((a, i) => (
          <li
            key={`${a.publishedAt}-${i}`}
            className={`news-item news-card ${newsCardImpactClass(a.impact)}`}
            style={{ animationDelay: `${(i + 6) * 45}ms` }}
          >
            {a.url ? (
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="news-item-link">
                {a.title}
              </a>
            ) : (
              <span className="news-item-title">{a.title}</span>
            )}
            <div className="news-item-meta">
              {a.source} · {a.publishedAt ? new Date(a.publishedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'} · {impactBadge(a.impact)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
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
  const series = computeRSISeries(closes, period)
  return series && series.length > 0 ? series[series.length - 1] : null
}

/** Série RSI complète pour Stoch RSI. */
function computeRSISeries(closes, period = 14) {
  if (closes.length < period + 1) return []
  const out = []
  let gainSum = 0
  let lossSum = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gainSum += diff
    else lossSum += Math.abs(diff)
  }
  let avgGain = gainSum / period
  let avgLoss = lossSum / period
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? Math.abs(diff) : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    let rsi
    if (avgLoss === 0) rsi = 100
    else {
      const rs = avgGain / avgLoss
      rsi = 100 - 100 / (1 + rs)
    }
    out.push(rsi)
  }
  return out
}

/** Stoch RSI (14,3,3) : RSI period 14, %K 3, %D 3, lookback 14 pour min/max. */
function computeStochRSI(closes, rsiPeriod = 14, kPeriod = 3, dPeriod = 3) {
  const rsiSeries = computeRSISeries(closes, rsiPeriod)
  if (rsiSeries.length < rsiPeriod) return null
  const lookback = rsiPeriod
  const rawStoch = []
  for (let i = lookback - 1; i < rsiSeries.length; i++) {
    const slice = rsiSeries.slice(i - lookback + 1, i + 1)
    const minR = Math.min(...slice)
    const maxR = Math.max(...slice)
    const v = maxR - minR === 0 ? 50 : ((rsiSeries[i] - minR) / (maxR - minR)) * 100
    rawStoch.push(v)
  }
  if (rawStoch.length < kPeriod) return null
  const stochK = ema(rawStoch, kPeriod)
  const stochD = ema(stochK.filter((x) => x != null), dPeriod)
  const k = stochK[stochK.length - 1]
  const d = stochD[stochD.length - 1]
  return k != null && d != null ? { k, d } : null
}

/** Williams %R (14). Retourne valeur entre -100 et 0. */
function computeWilliamsR(candles, period = 14) {
  if (candles.length < period) return null
  const slice = candles.slice(-period)
  const hh = Math.max(...slice.map((c) => c.high))
  const ll = Math.min(...slice.map((c) => c.low))
  const close = candles[candles.length - 1].close
  if (hh === ll) return -50
  return -100 * ((hh - close) / (hh - ll))
}

/** Ichimoku (9,26,52). Retourne { aboveCloud } pour la dernière barre. */
function computeIchimokuCloud(candles, tenkan = 9, kijun = 26, senkou = 52) {
  const n = candles.length
  if (n < Math.max(senkou, kijun) + 26) return null
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const closes = candles.map((c) => c.close)

  const t = (i) => (i < tenkan - 1 ? null : (Math.max(...highs.slice(i - tenkan + 1, i + 1)) + Math.min(...lows.slice(i - tenkan + 1, i + 1))) / 2)
  const k = (i) => (i < kijun - 1 ? null : (Math.max(...highs.slice(i - kijun + 1, i + 1)) + Math.min(...lows.slice(i - kijun + 1, i + 1))) / 2)
  const sa = (i) => (t(i) != null && k(i) != null ? (t(i) + k(i)) / 2 : null)
  const sb = (i) => (i < senkou - 1 ? null : (Math.max(...highs.slice(i - senkou + 1, i + 1)) + Math.min(...lows.slice(i - senkou + 1, i + 1))) / 2)

  const lastBar = n - 1
  const srcBar = lastBar - 26
  if (srcBar < 0) return null
  const saVal = sa(srcBar)
  const sbVal = sb(srcBar)
  if (saVal == null || sbVal == null) return null
  const cloudTop = Math.max(saVal, sbVal)
  const cloudBottom = Math.min(saVal, sbVal)
  const price = closes[lastBar]
  return { aboveCloud: price > cloudTop, cloudTop, cloudBottom }
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

/** Tous les pivots hauts sur les 100 dernières bougies. */
function findPivotHighs(candles, pivot = 5) {
  const n = candles.length
  if (n < pivot * 2 + 1) return []
  const pts = []
  for (let i = pivot; i < n - pivot; i++) {
    const high = candles[i].high
    let isPivot = true
    for (let j = i - pivot; j <= i + pivot; j++) {
      if (j !== i && candles[j].high >= high) {
        isPivot = false
        break
      }
    }
    if (isPivot) pts.push(high)
  }
  return pts
}

/** Tous les pivots bas sur les 100 dernières bougies. */
function findPivotLows(candles, pivot = 5) {
  const n = candles.length
  if (n < pivot * 2 + 1) return []
  const pts = []
  for (let i = pivot; i < n - pivot; i++) {
    const low = candles[i].low
    let isPivot = true
    for (let j = i - pivot; j <= i + pivot; j++) {
      if (j !== i && candles[j].low <= low) {
        isPivot = false
        break
      }
    }
    if (isPivot) pts.push(low)
  }
  return pts
}

/** Support le plus proche (meilleur pivot bas sous le prix). */
function getNearestSupport(candles, entry, pivot = 5) {
  const lows = findPivotLows(candles, pivot)
  const below = lows.filter((v) => v < entry)
  if (below.length > 0) return Math.max(...below)
  const recent = candles.slice(-30)
  if (recent.length === 0) return null
  const fallback = Math.min(...recent.map((c) => c.low))
  return fallback < entry ? fallback : null
}

/** Résistance la plus proche (meilleur pivot haut au-dessus du prix). */
function getNearestResistance(candles, entry, pivot = 5) {
  const highs = findPivotHighs(candles, pivot)
  const above = highs.filter((v) => v > entry)
  if (above.length > 0) return Math.min(...above)
  const recent = candles.slice(-30)
  if (recent.length === 0) return null
  const fallback = Math.max(...recent.map((c) => c.high))
  return fallback > entry ? fallback : null
}

/** Détecte les patterns de chandeliers japonais sur les dernières bougies. */
function detectCandlestickPattern(candles) {
  if (!candles || candles.length < 3) return { name: null, bullish: null }
  const c = (i) => candles[candles.length - 1 - i]
  const curr = c(0)
  const prev = c(1)
  const prev2 = c(2)

  const body = (x) => Math.abs(x.close - x.open)
  const upperWick = (x) => x.high - Math.max(x.open, x.close)
  const lowerWick = (x) => Math.min(x.open, x.close) - x.low
  const range = (x) => x.high - x.low || 1e-9
  const isGreen = (x) => x.close > x.open
  const isRed = (x) => x.close < x.open
  const isDoji = (x) => body(x) / range(x) < 0.15
  const bodySmall = (x) => body(x) / range(x) < 0.35

  const bCurr = body(curr)
  const bPrev = body(prev)
  const avgPrice = candles.slice(-10).reduce((s, x) => s + x.close, 0) / Math.min(10, candles.length)

  // --- HAUSSIERS ---
  if (bCurr > 1e-12 && lowerWick(curr) >= 2 * bCurr && upperWick(curr) < bCurr * 0.5 &&
      curr.close < avgPrice * 1.02) {
    return { name: 'Hammer', bullish: true }
  }
  if (isGreen(curr) && isRed(prev) && curr.open <= prev.close && curr.close >= prev.open &&
      bCurr > bPrev * 1.05) {
    return { name: 'Bullish Engulfing', bullish: true }
  }
  if (isRed(prev2) && body(prev2) > 1e-9 && (isDoji(prev) || bodySmall(prev)) && isGreen(curr) &&
      curr.close > (prev2.open + prev2.close) / 2) {
    return { name: 'Morning Star', bullish: true }
  }
  if (isDoji(curr) && (upperWick(curr) + lowerWick(curr)) > body(curr) * 2) {
    return { name: 'Bullish Doji', bullish: true }
  }
  if (isGreen(curr) && isRed(prev) && curr.open < prev.low && curr.close > prev.open &&
      curr.close > prev.open + (prev.close - prev.open) * 0.5) {
    return { name: 'Piercing Line', bullish: true }
  }

  // --- BAISSIERS ---
  if (bCurr > 1e-12 && upperWick(curr) >= 2 * bCurr && lowerWick(curr) < bCurr * 0.5) {
    return { name: 'Shooting Star', bullish: false }
  }
  if (isRed(curr) && isGreen(prev) && curr.open >= prev.close && curr.close <= prev.open &&
      bCurr > bPrev * 1.05) {
    return { name: 'Bearish Engulfing', bullish: false }
  }
  if (isGreen(prev2) && body(prev2) > 1e-9 && (isDoji(prev) || bodySmall(prev)) && isRed(curr) &&
      curr.close < (prev2.open + prev2.close) / 2) {
    return { name: 'Evening Star', bullish: false }
  }
  if (bCurr > 1e-12 && lowerWick(curr) >= 2 * bCurr && upperWick(curr) < bCurr * 0.5 &&
      curr.close > avgPrice * 1.02) {
    return { name: 'Hanging Man', bullish: false }
  }
  if (isRed(curr) && isGreen(prev) && curr.open > prev.high && curr.close < prev.close &&
      curr.close < prev.open + (prev.close - prev.open) * 0.5) {
    return { name: 'Dark Cloud Cover', bullish: false }
  }

  return { name: null, bullish: null }
}

/** RSI indexé par bougie (aligné sur closes) pour divergences. */
function buildRsiByBar(closes, period = 14) {
  const raw = computeRSISeries(closes, period)
  const rsiByBar = Array(closes.length).fill(null)
  for (let k = 0; k < raw.length; k++) {
    rsiByBar[period + 1 + k] = raw[k]
  }
  return rsiByBar
}

/** Ligne MACD (EMA12 − EMA26) par bougie. */
function buildMacdLineByBar(closes) {
  const emaFast = ema(closes, 12)
  const emaSlow = ema(closes, 26)
  return Array.from({ length: closes.length }, (_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null,
  )
}

function findPivotLowIndices(candles, pivot = 3, lookback = 90) {
  const n = candles.length
  const start = Math.max(pivot, n - lookback)
  const idx = []
  for (let i = pivot; i < n - pivot; i++) {
    if (i < start) continue
    const low = candles[i].low
    let isPivot = true
    for (let j = i - pivot; j <= i + pivot; j++) {
      if (j !== i && candles[j].low <= low) {
        isPivot = false
        break
      }
    }
    if (isPivot) idx.push(i)
  }
  return idx
}

function findPivotHighIndices(candles, pivot = 3, lookback = 90) {
  const n = candles.length
  const start = Math.max(pivot, n - lookback)
  const idx = []
  for (let i = pivot; i < n - pivot; i++) {
    if (i < start) continue
    const high = candles[i].high
    let isPivot = true
    for (let j = i - pivot; j <= i + pivot; j++) {
      if (j !== i && candles[j].high >= high) {
        isPivot = false
        break
      }
    }
    if (isPivot) idx.push(i)
  }
  return idx
}

/**
 * Divergences sur pivots (2 derniers creux / 2 derniers sommets).
 * Classique haussière : prix LL, oscillateur HL. Cachée haussière : prix HL, oscillateur LL.
 */
function detectOscillatorDivergence(candles, oscByBar, oscName) {
  const pivot = 3
  const lookback = 90
  const messages = []
  let hasBullish = false
  let hasBearish = false

  const lowIdx = findPivotLowIndices(candles, pivot, lookback)
  if (lowIdx.length >= 2) {
    const a = lowIdx[lowIdx.length - 2]
    const b = lowIdx[lowIdx.length - 1]
    const pl = candles[a].low
    const pl2 = candles[b].low
    const oa = oscByBar[a]
    const ob = oscByBar[b]
    if (Number.isFinite(oa) && Number.isFinite(ob)) {
      if (pl2 < pl && ob > oa) {
        hasBullish = true
        messages.push(
          oscName === 'RSI'
            ? '📈 Divergence haussière RSI (classique) détectée'
            : '📈 Divergence haussière MACD (classique) détectée',
        )
      } else if (pl2 > pl && ob < oa) {
        hasBullish = true
        messages.push(
          oscName === 'RSI'
            ? '📈 Divergence haussière RSI (cachée) détectée'
            : '📈 Divergence haussière MACD (cachée) détectée',
        )
      }
    }
  }

  const highIdx = findPivotHighIndices(candles, pivot, lookback)
  if (highIdx.length >= 2) {
    const a = highIdx[highIdx.length - 2]
    const b = highIdx[highIdx.length - 1]
    const ph = candles[a].high
    const ph2 = candles[b].high
    const oa = oscByBar[a]
    const ob = oscByBar[b]
    if (Number.isFinite(oa) && Number.isFinite(ob)) {
      if (ph2 > ph && ob < oa) {
        hasBearish = true
        messages.push(
          oscName === 'RSI'
            ? '📉 Divergence baissière RSI (classique) détectée'
            : '📉 Divergence baissière MACD (classique) détectée',
        )
      } else if (ph2 < ph && ob > oa) {
        hasBearish = true
        messages.push(
          oscName === 'RSI'
            ? '📉 Divergence baissière RSI (cachée) détectée'
            : '📉 Divergence baissière MACD (cachée) détectée',
        )
      }
    }
  }

  return { messages, hasBullish, hasBearish }
}

function mergeDivergenceDetections(candles, closes) {
  if (!candles?.length || closes.length < 40) {
    return {
      messages: [],
      scoreAdjust: 0,
      hasBullish: false,
      hasBearish: false,
      summary:
        'Historique OHLC trop court pour divergences (minimum ~40 bougies requises sur les données réelles Binance ou Twelve Data).',
    }
  }
  const rsiByBar = buildRsiByBar(closes)
  const macdLine = buildMacdLineByBar(closes)
  const r = detectOscillatorDivergence(candles, rsiByBar, 'RSI')
  const m = detectOscillatorDivergence(candles, macdLine, 'MACD')
  const messages = [...r.messages, ...m.messages]
  const hasBullish = r.hasBullish || m.hasBullish
  const hasBearish = r.hasBearish || m.hasBearish
  let scoreAdjust = 0
  if (hasBullish && !hasBearish) scoreAdjust = 15
  else if (hasBearish && !hasBullish) scoreAdjust = -15
  const summary =
    messages.length > 0
      ? messages.join(' | ')
      : 'Aucune divergence RSI/MACD sur les pivots récents (calcul sur bougies OHLC réelles Binance ou Twelve Data).'
  return { messages, scoreAdjust, hasBullish, hasBearish, summary }
}

function scoreToBadgeClass(score) {
  if (score > 75) return 'badge--good'
  if (score >= 50) return 'badge--mid'
  return 'badge--bad'
}

function scoreLabel(score) {
  if (score > 75) return 'SIGNAL FORT'
  if (score >= 50) return 'SURVEILLER'
  return 'ATTENDRE'
}

function buildConfluenceResult(mtfMap) {
  const d1 = mtfMap['1D']
  const h4 = mtfMap['4H']
  const m15 = mtfMap['15m']
  if (!d1 || !h4 || !m15) return null

  const div = m15.divergences ?? {
    messages: [],
    scoreAdjust: 0,
    hasBullish: false,
    hasBearish: false,
    summary: '',
  }

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

  // Score final pondéré : 1D x3, 4H x2, 15m x1 → /6 pour 0-100, puis ajustement divergences (±15)
  const weightedScore = Math.round(
    clamp(
      (scores['1D'] * 3 + scores['4H'] * 2 + scores['15m'] * 1) / 6 + (div.scoreAdjust || 0),
      0,
      100,
    ),
  )

  const rsi = m15.indicators.rsi
  const rsiLong = rsi >= 50 && rsi <= 65
  const rsiShort = rsi >= 35 && rsi <= 50

  const macdHist = m15.indicators.macd.hist
  const macdPrev = m15.indicators.macd.prevHist
  const macdPositiveGrowing =
    Number.isFinite(macdHist) && Number.isFinite(macdPrev) && macdHist > 0 && macdHist > macdPrev

  const price = m15.indicators.entry
  const emaLong = price > m15.indicators.ema20 && price > m15.indicators.ema50

  // Seuils : >75 signal fort, 50-75 surveiller, <50 attendre
  const score1dOkLong = scores['1D'] > 75
  const score4hOkLong = scores['4H'] > 75
  const score15mOkLong = scores['15m'] > 75

  const score1dOkShort = scores['1D'] < 25
  const score4hOkShort = scores['4H'] < 25
  const score15mOkShort = scores['15m'] < 25

  const macdLong = Number.isFinite(macdHist) ? macdHist > 0 : false
  const macdShort = Number.isFinite(macdHist) ? macdHist < 0 : false
  const emaShort = price < m15.indicators.ema20 && price < m15.indicators.ema50
  const rrOk = m15.trade.rr > 2
  const ichimokuAbove = m15.indicators.ichimoku?.aboveCloud ?? false
  const stochK = m15.indicators.stochRsi?.k ?? 50
  const stochRsiFavLong = stochK < 20
  const stochRsiFavShort = stochK > 80
  const cp = m15.indicators.candlestickPattern
  const patternCheckLong = cp?.bullish === true
  const patternCheckShort = cp?.bullish === false

  const divergenceCheckLong = div.hasBullish && !div.hasBearish
  const divergenceCheckShort = div.hasBearish && !div.hasBullish

  const longChecks = [
    score1dOkLong,
    score4hOkLong,
    score15mOkLong,
    rsiLong,
    macdLong,
    emaLong,
    rrOk,
    ichimokuAbove,
    stochRsiFavLong,
    patternCheckLong,
    divergenceCheckLong,
  ]

  const shortChecks = [
    score1dOkShort,
    score4hOkShort,
    score15mOkShort,
    rsiShort,
    macdShort,
    emaShort,
    rrOk,
    !ichimokuAbove,
    stochRsiFavShort,
    patternCheckShort,
    divergenceCheckShort,
  ]

  const longCount = longChecks.filter(Boolean).length
  const shortCount = shortChecks.filter(Boolean).length

  let recommendation = 'ATTENDRE'
  let signalBadge = 'EN ATTENTE'
  let signalTone = 'mid'
  let checks = longChecks
  let checksPassed = longCount
  let checksDirection = 'LONG'

  if (longCount >= 7 && longCount >= shortCount && weightedScore > 75) {
    recommendation = 'LONG'
    signalBadge = 'LONG IDÉAL'
    signalTone = 'good'
    checks = longChecks
    checksPassed = longCount
    checksDirection = 'LONG'
  } else if (shortCount >= 7 && shortCount > longCount && weightedScore < 25) {
    recommendation = 'SHORT'
    signalBadge = 'SHORT IDÉAL'
    signalTone = 'bad'
    checks = shortChecks
    checksPassed = shortCount
    checksDirection = 'SHORT'
  } else if (longCount >= 7 && longCount >= shortCount) {
    recommendation = 'LONG'
    signalBadge = 'SURVEILLER LONG'
    signalTone = 'mid'
    checks = longChecks
    checksPassed = longCount
    checksDirection = 'LONG'
  } else if (shortCount >= 7 && shortCount > longCount) {
    recommendation = 'SHORT'
    signalBadge = 'SURVEILLER SHORT'
    signalTone = 'mid'
    checks = shortChecks
    checksPassed = shortCount
    checksDirection = 'SHORT'
  }

  const checkLabels =
    checksDirection === 'LONG'
      ? [
          'Score 1D > 75',
          'Score 4H > 75',
          'Score 15m > 75',
          'RSI entre 50-65',
          'MACD positif',
          'Prix > EMA20 et EMA50',
          'R/R > 2.0',
          'Prix > nuage Ichimoku',
          'Stoch RSI zone favorable',
          'Pattern de retournement détecté',
          'Divergence RSI/MACD favorable',
        ]
      : [
          'Score 1D < 25',
          'Score 4H < 25',
          'Score 15m < 25',
          'RSI entre 35-50',
          'MACD négatif',
          'Prix < EMA20 et EMA50',
          'R/R > 2.0',
          'Prix < nuage Ichimoku',
          'Stoch RSI zone favorable',
          'Pattern de retournement détecté',
          'Divergence RSI/MACD favorable',
        ]

  return {
    score: weightedScore,
    label: scoreLabel(weightedScore),
    alignedCount,
    dominantDirection,
    mtfScores: scores,
    recommendation,
    signalBadge,
    signalTone,
    checklist: checkLabels.map((label, i) => ({ label, ok: checks[i] })),
    checksPassed,
    checksTotal: 11,
    divergenceMessages: div.messages ?? [],
    divergenceSummary: div.summary ?? '',
    trade: m15.trade,
    indicators: m15.indicators,
  }
}

const INTERVAL_MS = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '15min': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1day': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  '1week': 7 * 24 * 60 * 60 * 1000,
}

function intervalKeyFromMtf(tfKey) {
  const row = MTF_TIMEFRAMES.find((x) => x.key === tfKey)
  return row ? row.binanceInterval : '15m'
}

function lastClosedHtfIndex(candles, intervalKey, targetTimeMs) {
  const tfMs = INTERVAL_MS[intervalKey] ?? INTERVAL_MS['15m']
  let j = -1
  for (let i = 0; i < candles.length; i++) {
    if (candles[i].date.getTime() + tfMs <= targetTimeMs) j = i
    else break
  }
  return j
}

async function fetchBacktestMtfCandles(item) {
  const out = { m15: [], h4: [], d1: [] }
  if (item.binanceSymbol) {
    const [m15, h4, d1] = await Promise.all([
      fetchBinanceKlines(item.binanceSymbol, '15m', BACKTEST_FETCH_LIMIT),
      fetchBinanceKlines(item.binanceSymbol, '4h', BACKTEST_FETCH_LIMIT),
      fetchBinanceKlines(item.binanceSymbol, '1d', BACKTEST_FETCH_LIMIT),
    ])
    out.m15 = m15
    out.h4 = h4
    out.d1 = d1
    return out
  }
  if (item.twelveSymbol && TWELVE_DATA_KEY) {
    const [m15, h4, d1] = await Promise.all([
      fetchTwelveDataCandles(item.twelveSymbol, '15min', BACKTEST_FETCH_LIMIT, TWELVE_DATA_KEY),
      fetchTwelveDataCandles(item.twelveSymbol, '4h', BACKTEST_FETCH_LIMIT, TWELVE_DATA_KEY),
      fetchTwelveDataCandles(item.twelveSymbol, '1day', BACKTEST_FETCH_LIMIT, TWELVE_DATA_KEY),
    ])
    out.m15 = m15
    out.h4 = h4
    out.d1 = d1
    return out
  }
  throw new Error('Données indisponibles pour cet actif')
}

function simulateExitFromBar(direction, entry, sl, tp, candles, fromIdx) {
  for (let k = fromIdx; k < candles.length; k++) {
    const bar = candles[k]
    if (direction === 'LONG') {
      const hitSl = bar.low <= sl
      const hitTp = bar.high >= tp
      if (hitSl && hitTp) {
        const pnlPct = ((sl - entry) / entry) * 100
        return {
          exitIdx: k,
          exitPrice: sl,
          reason: 'SL',
          pnlPct,
          exitTime: bar.date,
        }
      }
      if (hitSl) {
        return {
          exitIdx: k,
          exitPrice: sl,
          reason: 'SL',
          pnlPct: ((sl - entry) / entry) * 100,
          exitTime: bar.date,
        }
      }
      if (hitTp) {
        return {
          exitIdx: k,
          exitPrice: tp,
          reason: 'TP',
          pnlPct: ((tp - entry) / entry) * 100,
          exitTime: bar.date,
        }
      }
    } else {
      const hitSl = bar.high >= sl
      const hitTp = bar.low <= tp
      if (hitSl && hitTp) {
        return {
          exitIdx: k,
          exitPrice: sl,
          reason: 'SL',
          pnlPct: ((entry - sl) / entry) * 100,
          exitTime: bar.date,
        }
      }
      if (hitSl) {
        return {
          exitIdx: k,
          exitPrice: sl,
          reason: 'SL',
          pnlPct: ((entry - sl) / entry) * 100,
          exitTime: bar.date,
        }
      }
      if (hitTp) {
        return {
          exitIdx: k,
          exitPrice: tp,
          reason: 'TP',
          pnlPct: ((entry - tp) / entry) * 100,
          exitTime: bar.date,
        }
      }
    }
  }
  const last = candles[candles.length - 1]
  const close = last.close
  const pnlPct =
    direction === 'LONG' ? ((close - entry) / entry) * 100 : ((entry - close) / entry) * 100
  return {
    exitIdx: candles.length - 1,
    exitPrice: close,
    reason: 'FIN_SERIE',
    pnlPct,
    exitTime: last.date,
  }
}

function runBacktestOnCandles(m15, h4, d1) {
  const minWarmup = 80
  if (m15.length < minWarmup + BACKTEST_BARS) {
    throw new Error(`Pas assez de bougies 15m (reçu ${m15.length}, besoin ~${minWarmup + BACKTEST_BARS})`)
  }

  const h4Key = intervalKeyFromMtf('4H')
  const d1Key = intervalKeyFromMtf('1D')
  const m15Ms = INTERVAL_MS['15m']

  const startIdx = m15.length - BACKTEST_BARS
  const endIdx = m15.length - 1
  const periodStart = m15[startIdx].date
  const periodEnd = m15[endIdx].date

  const trades = []
  let openUntil = -1

  for (let i = startIdx; i <= endIdx; i++) {
    if (i < minWarmup) continue
    if (i <= openUntil) continue

    const tClose = m15[i].date.getTime() + m15Ms
    const j4 = lastClosedHtfIndex(h4, h4Key, tClose)
    const jd = lastClosedHtfIndex(d1, d1Key, tClose)
    if (j4 < 0 || jd < 0) continue

    const slice15 = m15.slice(0, i + 1)
    const c15 = computeIndicatorsAndTrade(slice15)
    const c4 = computeIndicatorsAndTrade(h4.slice(0, j4 + 1))
    const cd = computeIndicatorsAndTrade(d1.slice(0, jd + 1))
    if (!c15 || !c4 || !cd) continue

    const mtfMap = { '15m': c15, '4H': c4, '1D': cd }
    const conf = buildConfluenceResult(mtfMap)
    if (!conf) continue

    const score = conf.score
    let direction = null
    if (score > 75) direction = 'LONG'
    else if (score < 25) direction = 'SHORT'
    else continue

    const entry = m15[i].close
    const { stopLoss: sl, takeProfit: tp } = c15.trade
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(sl) || !Number.isFinite(tp)) continue

    if (direction === 'LONG' && !(sl < entry && tp > entry)) continue
    if (direction === 'SHORT' && !(sl > entry && tp < entry)) continue

    const exitFrom = i + 1
    if (exitFrom >= m15.length) break

    const sim = simulateExitFromBar(direction, entry, sl, tp, m15, exitFrom)
    openUntil = sim.exitIdx

    trades.push({
      signalIndex: i,
      exitIdx: sim.exitIdx,
      entryTime: m15[i].date,
      direction,
      score,
      entry,
      sl,
      tp,
      exitTime: sim.exitTime,
      exitPrice: sim.exitPrice,
      exitReason: sim.reason,
      pnlPct: sim.pnlPct,
    })
  }

  trades.sort((a, b) => a.exitIdx - b.exitIdx)

  let eFinal = 100
  for (const tr of trades) eFinal *= 1 + tr.pnlPct / 100

  const curve = []
  let e = 100
  let ti = 0
  for (let u = 0; u < BACKTEST_BARS; u++) {
    const barIdx = startIdx + u
    while (ti < trades.length && trades[ti].exitIdx <= barIdx) {
      e *= 1 + trades[ti].pnlPct / 100
      ti++
    }
    curve.push({ t: m15[startIdx + u].date, equity: e })
  }

  const winners = trades.filter((x) => x.pnlPct > 0)
  const losers = trades.filter((x) => x.pnlPct <= 0)
  const total = trades.length
  const winCount = winners.length
  const lossCount = losers.length
  const winRatePct = total > 0 ? (winCount / total) * 100 : 0
  const avgWin =
    winCount > 0 ? winners.reduce((s, x) => s + x.pnlPct, 0) / winCount : 0
  const avgLoss =
    lossCount > 0 ? losers.reduce((s, x) => s + x.pnlPct, 0) / lossCount : 0
  const sumWin = winners.reduce((s, x) => s + x.pnlPct, 0)
  const sumLossAbs = losers.reduce((s, x) => s + Math.abs(x.pnlPct), 0)
  const profitFactor = sumLossAbs > 0 ? sumWin / sumLossAbs : sumWin > 0 ? Infinity : 0
  const totalGainPct = eFinal - 100

  return {
    periodStart,
    periodEnd,
    trades,
    stats: {
      total,
      winCount,
      lossCount,
      winRatePct,
      avgWin,
      avgLoss,
      profitFactor,
      totalGainPct,
    },
    equityCurve: curve,
  }
}

function tradesToCsv(trades) {
  const headers = [
    'date_entree',
    'direction',
    'score',
    'entree',
    'stop_loss',
    'take_profit',
    'date_sortie',
    'prix_sortie',
    'raison',
    'pnl_pct',
  ]
  const rows = trades.map((tr) =>
    [
      tr.entryTime.toISOString(),
      tr.direction,
      tr.score,
      tr.entry,
      tr.sl,
      tr.tp,
      tr.exitTime.toISOString(),
      tr.exitPrice,
      tr.exitReason,
      tr.pnlPct.toFixed(4),
    ].join(','),
  )
  return [headers.join(','), ...rows].join('\n')
}

function EquityCurveChart({ points }) {
  const w = 560
  const h = 140
  if (!Array.isArray(points) || points.length < 2) return null
  const vals = points.map((p) => p.equity)
  const min = Math.min(...vals, 99)
  const max = Math.max(...vals, 101)
  const span = max - min || 1
  const linePts = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w
      const y = h - 6 - ((p.equity - min) / span) * (h - 12)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
  const firstX = 0
  const lastX = w
  const lastY = h - 6 - ((vals[vals.length - 1] - min) / span) * (h - 12)
  const areaPts = `${linePts} ${lastX},${h} ${firstX},${h}`
  return (
    <svg
      className="equity-curve-chart"
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="equityGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(0,229,160,0.35)" />
          <stop offset="100%" stopColor="rgba(0,229,160,0)" />
        </linearGradient>
      </defs>
      <polygon points={areaPts} fill="url(#equityGrad)" />
      <polyline
        points={linePts}
        fill="none"
        stroke="#00e5a0"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

function BacktestPanel({ open, onClose, item, loading, error, data, onExportCsv }) {
  useEffect(() => {
    if (!open) return
    const h = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  if (!open) return null

  const fmtPct = (x) => `${x >= 0 ? '+' : ''}${Number(x).toFixed(2)}%`
  const fmtDate = (d) =>
    d instanceof Date && !Number.isNaN(d.getTime())
      ? d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
      : '—'

  const s = data?.stats
  const total = s?.total ?? 0
  const winPct = total > 0 ? ((s.winCount / total) * 100).toFixed(1) : '0.0'
  const lossPct = total > 0 ? ((s.lossCount / total) * 100).toFixed(1) : '0.0'
  const pf =
    s?.profitFactor === Infinity || s?.profitFactor === Number.POSITIVE_INFINITY
      ? '∞'
      : Number.isFinite(s?.profitFactor)
        ? s.profitFactor.toFixed(2)
        : '—'

  return (
    <div
      className="backtest-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="backtest-title"
      onClick={onClose}
    >
      <div className="backtest-modal" onClick={(e) => e.stopPropagation()}>
        <div className="backtest-modal-head">
          <h2 id="backtest-title" className="backtest-title syne">
            📊 Backtest {item.label} - {BACKTEST_BARS} bougies 15m
          </h2>
          <button type="button" className="backtest-close" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        <div className="backtest-modal-body">
          {loading && <div className="backtest-loading">Calcul en cours…</div>}
          {error && <div className="backtest-error">{error}</div>}

          {!loading && !error && data && (
            <>
              <div className="backtest-block mono">
                <div>
                  ⏱ Période : du {fmtDate(data.periodStart)} au {fmtDate(data.periodEnd)}
                </div>
                <div className="backtest-sep">─────────────────────────────</div>
                <div>📈 Trades totaux : {total}</div>
                <div>
                  ✅ Gagnants : {s.winCount} ({winPct}%)
                </div>
                <div>
                  ❌ Perdants : {s.lossCount} ({lossPct}%)
                </div>
                <div className="backtest-sep">─────────────────────────────</div>
                <div>💰 Profit moyen : {fmtPct(s.avgWin)}</div>
                <div>📉 Perte moyenne : {fmtPct(s.avgLoss)}</div>
                <div>⚖️ Profit Factor : {pf}</div>
                <div>📈 Win Rate : {s.winRatePct.toFixed(1)}%</div>
                <div>💵 Gain total simulé : {fmtPct(s.totalGainPct)}</div>
                <div className="backtest-sep">─────────────────────────────</div>
                <div className="backtest-disclaimer">
                  ⚠️ &quot;Résultats passés ne garantissent pas les résultats futurs&quot;
                </div>
              </div>

              <div className="backtest-chart-wrap">
                <div className="backtest-chart-label syne">Courbe d&apos;équité (capital de départ 100)</div>
                <EquityCurveChart points={data.equityCurve} />
              </div>

              <div className="backtest-actions">
                <button
                  type="button"
                  className="backtest-export-btn"
                  onClick={onExportCsv}
                  disabled={!data.trades?.length}
                >
                  📥 Exporter CSV
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
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

  const stochKSim = isLong ? 15 + Math.random() * 25 : 55 + Math.random() * 35
  const williamsRSim = isLong ? -85 - Math.random() * 15 : -35 + Math.random() * 35
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
        stochRsi: { k: stochKSim, d: stochKSim - 5 },
        williamsR: williamsRSim,
        ichimoku: { aboveCloud: isLong },
        candlestickPattern: Math.random() > 0.7 ? { name: isLong ? 'Hammer' : 'Shooting Star', bullish: isLong } : null,
      },
      trade: {
        direction,
        entry,
        stopLoss,
        takeProfit,
        rr,
        support: isLong ? entry - riskDist : entry - riskDist * 0.5,
        resistance: isLong ? entry + riskDist * 0.5 : entry + riskDist,
      },
      signals: {
        RSI: rsiActive,
        MACD: macdActive,
        EMA: emaActive,
        BB: bbActive,
        'Stoch RSI': stochKSim < 20 && isLong,
        'Williams %R': (williamsRSim < -80 && isLong) || (williamsRSim > -20 && !isLong),
      },
      divergences: {
        messages: [],
        scoreAdjust: 0,
        hasBullish: false,
        hasBearish: false,
        summary: getDivergencePlaceholderSummary(item),
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
  const stochRsi = computeStochRSI(closes, 14, 3, 3)
  const williamsR = computeWilliamsR(candles, 14)
  const ichimoku = computeIchimokuCloud(candles, 9, 26, 52)
  const candlestickPattern = detectCandlestickPattern(candles)
  if (rsi == null || macd == null || bb == null || atr == null) return null

  // Pondération par indicateur (total 100 pts) : EMA 25, Ichimoku 20, RSI 15, MACD 15, BB 10, Stoch RSI 8, Williams 7
  const emaStrongBull = ema20 > ema50 && entry > ema20
  const emaStrongBear = ema50 > ema20 && entry < ema50
  const emaScore = emaStrongBull ? 25 : emaStrongBear ? 0 : 12.5

  const ichimokuAbove = ichimoku?.aboveCloud ?? false
  const ichimokuScore = ichimokuAbove ? 20 : 0

  const rsiScore = clamp((rsi - 30) / 40, 0, 1) * 15

  const histAbsNorm = Math.abs(macd.hist) / (entry * 0.002)
  const histStrength = clamp(histAbsNorm, 0, 1)
  const macdScore = macd.hist >= 0 ? histStrength * 15 : histStrength * 1.5

  const volStrength = clamp((bb.width - 0.01) / 0.04, 0, 1)
  const bbScore = (entry >= bb.middle ? volStrength : volStrength * 0.5) * 10

  const stochK = stochRsi?.k ?? 50
  const stochScore = stochK < 20 ? 8 : stochK > 80 ? 0 : 4

  const williamsScore =
    williamsR != null && williamsR < -80 ? 7 : williamsR != null && williamsR > -20 ? 0 : 3.5

  let score = Math.round(
    clamp(emaScore + ichimokuScore + rsiScore + macdScore + bbScore + stochScore + williamsScore, 0, 100)
  )
  if (candlestickPattern?.name) {
    score = clamp(score + (candlestickPattern.bullish ? 10 : -10), 0, 100)
  }

  // Direction LONG/SHORT based on majority of bullish signals.
  const emaBull = ema20 > ema50
  const rsiBull = rsi >= 50
  const macdBull = macd.hist >= 0
  const bullishCount = (emaBull ? 1 : 0) + (rsiBull ? 1 : 0) + (macdBull ? 1 : 0)
  const direction = bullishCount >= 2 ? 'LONG' : 'SHORT'

  const isLong = direction === 'LONG'

  // --- Support/Résistance basés sur pivots (100 bougies) ---
  const pivot = 5
  const nearestSupport = getNearestSupport(candles, entry, pivot)
  const nearestResistance = getNearestResistance(candles, entry, pivot)
  const levelBuf = atr * 0.03 // léger buffer sous/sur le niveau

  // SL et TP à partir des vrais niveaux S/R
  let stopLoss
  let takeProfit
  if (isLong) {
    stopLoss =
      Number.isFinite(nearestSupport) && nearestSupport < entry
        ? nearestSupport - levelBuf
        : entry - atr * 1.2
    takeProfit =
      Number.isFinite(nearestResistance) && nearestResistance > entry
        ? nearestResistance + levelBuf
        : entry + atr * 2.5
  } else {
    stopLoss =
      Number.isFinite(nearestResistance) && nearestResistance > entry
        ? nearestResistance + levelBuf
        : entry + atr * 1.2
    takeProfit =
      Number.isFinite(nearestSupport) && nearestSupport < entry
        ? nearestSupport - levelBuf
        : entry - atr * 2.5
  }

  // Sécuriser SL (doit être du bon côté du prix)
  if (isLong && stopLoss >= entry) stopLoss = entry - atr * 1.0
  if (!isLong && stopLoss <= entry) stopLoss = entry + atr * 1.0

  const riskDist = Math.abs(entry - stopLoss)
  let rr = riskDist > 0 ? Math.abs(takeProfit - entry) / riskDist : 2.0
  rr = clamp(rr, 1.5, 5.0)

  // Ajuster TP pour respecter le RR contraint
  takeProfit = isLong ? entry + riskDist * rr : entry - riskDist * rr

  // Active signals based on direction.
  const emaActive = isLong ? emaBull : !emaBull
  const rsiActive = isLong ? rsi >= 55 : rsi <= 45
  const macdActive = isLong ? macdBull : !macdBull
  const bbActive = isLong ? entry >= bb.middle : entry <= bb.middle
  const stochRsiOversold = stochK < 20
  const stochRsiOverbought = stochK > 80
  const stochRsiFavLong = stochRsiOversold
  const stochRsiFavShort = stochRsiOverbought
  const williamsOversold = williamsR != null && williamsR < -80
  const williamsOverbought = williamsR != null && williamsR > -20
  const williamsActive = isLong ? williamsOversold : williamsOverbought

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
      stochRsi: stochRsi ? { k: stochK, d: stochRsi.d } : null,
      williamsR,
      ichimoku,
      candlestickPattern,
    },
    trade: {
      direction,
      entry,
      stopLoss,
      takeProfit,
      rr,
      support: Number.isFinite(nearestSupport) ? nearestSupport : null,
      resistance: Number.isFinite(nearestResistance) ? nearestResistance : null,
    },
    signals: {
      RSI: rsiActive,
      MACD: macdActive,
      EMA: emaActive,
      BB: bbActive,
      'Stoch RSI': stochRsiFavLong && isLong ? true : stochRsiFavShort && !isLong,
      'Williams %R': williamsActive,
    },
    divergences: mergeDivergenceDetections(candles, closes),
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
      hide_side_toolbar: false,
      drawings_access: {
        type: 'all',
        tools: [{ name: 'Regression Trend' }],
      },
      show_popup_button: true,
      popup_width: '1000',
      popup_height: '650',
      allow_symbol_change: true,
      save_image: true,
      calendar: false,
      support_host: 'https://www.tradingview.com',
      studies: ['IchimokuCloud@tv-basicstudies'],
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

function SignalIdealPanel({
  item,
  result,
  contextIndicators,
  contextTfLabel,
  contextLoading,
  selectedTimeframe,
  fearGreed,
  macroContext,
}) {
  const [capital, setCapital] = useState(() => readPositionCapital())
  const [riskPct, setRiskPct] = useState(() => readPositionRisk())
  const [accountType, setAccountType] = useState(() => readPositionAccount())
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiText, setAiText] = useState('')

  useEffect(() => {
    try {
      localStorage.setItem(LS_POSITION_CAPITAL, String(capital))
    } catch {
      /* ignore */
    }
  }, [capital])

  useEffect(() => {
    try {
      localStorage.setItem(LS_POSITION_RISK, String(riskPct))
    } catch {
      /* ignore */
    }
  }, [riskPct])

  useEffect(() => {
    try {
      localStorage.setItem(LS_POSITION_ACCOUNT, accountType)
    } catch {
      /* ignore */
    }
  }, [accountType])

  const positionSizing = useMemo(() => {
    const t = result?.confluence?.trade
    if (!t) return null
    return computePositionSizing(capital, riskPct, t.entry, t.stopLoss, accountType)
  }, [result, capital, riskPct, accountType])

  const riskTier = useMemo(() => positionRiskTier(riskPct), [riskPct])

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

  const { trade } = conf
  const indicators = contextIndicators ?? conf.indicators
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

  const slBarPct = slPct == null ? 0 : Math.min(100, (Math.abs(slPct) / 6) * 100)
  const tpBarPct = tpPct == null ? 0 : Math.min(100, (Math.abs(tpPct) / 6) * 100)

  const callClaudeAnalysis = async () => {
    setAiError('')

    const fgLine =
      fearGreed?.value != null
        ? `Fear & Greed crypto=${Math.round(fearGreed.value)} (${fearGreedLabel(fearGreed.value)})`
        : 'Fear & Greed crypto=NA'
    const macroLine = macroContext?.macroImminent
      ? 'ATTENTION: evenement macro majeur possible dans les 2 prochaines heures.'
      : 'Pas d\'alerte calendrier macro imminente.'
    const divLine =
      conf.divergenceSummary && String(conf.divergenceSummary).trim()
        ? `Divergences RSI/MACD (15m): ${conf.divergenceSummary}`
        : 'Divergences RSI/MACD: non disponibles'
    const posForPrompt = computePositionSizing(
      capital,
      riskPct,
      trade.entry,
      trade.stopLoss,
      accountType,
    )
    const posLine = posForPrompt
      ? `Capital : ${Math.round(capital)}€ | Risque : ${riskPct}% | Lots recommandés : ${posForPrompt.lotsRecommended.toFixed(4)}`
      : `Capital : ${Math.round(capital)}€ | Risque : ${riskPct}% | Lots recommandés : N/A (distance SL invalide)`
    const prompt = `Tu es un expert en trading. Analyse ces données techniques et donne un avis concis en français :
actif=${item.label}
scores timeframes: 1D=${conf.mtfScores['1D']} | 4H=${conf.mtfScores['4H']} | 15m=${conf.mtfScores['15m']}
${fgLine}
${macroLine}
${divLine}
${posLine} | Type compte : ${accountType}
indicateurs: RSI=${Number.isFinite(indicators.rsi) ? indicators.rsi.toFixed(2) : 'NA'}, MACD.hist=${Number.isFinite(indicators?.macd?.hist) ? indicators.macd.hist.toFixed(5) : 'NA'}, Stoch RSI=${Number.isFinite(indicators.stochRsi?.k) ? indicators.stochRsi.k.toFixed(1) : 'NA'}, Williams %R=${Number.isFinite(indicators.williamsR) ? indicators.williamsR.toFixed(1) : 'NA'}, Ichimoku=${indicators.ichimoku?.aboveCloud ? 'au-dessus nuage' : 'sous nuage'}${indicators.candlestickPattern?.name ? `, Pattern chandelier=${indicators.candlestickPattern.name} (${indicators.candlestickPattern.bullish ? 'haussiere' : 'baissiere'})` : ''}
direction recommandee=${conf.recommendation}
checklist validee=${conf.checksPassed}/${conf.checksTotal}
Dis si c'est un bon setup ou pas et pourquoi. Tiens compte des divergences signalees si presentes.
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

  const directionPulse =
    conf.signalTone === 'good' || conf.signalTone === 'bad' ? 'direction-pill--pulse' : ''

  return (
    <div className="trade-panel">
      <div className="trade-hero">
        <div className={`direction-pill direction-pill--hero ${signalClass} ${directionPulse}`}>
          {conf.signalBadge}
        </div>
        <div className="trade-hero-score">
          <ScoreRing score={conf.score} size={112} strokeWidth={8} labelClass="score-ring--hero" />
        </div>
      </div>

      <div className="panel-help">{conf.label}</div>

      {conf.macroWarning && (
        <div className="macro-warning-banner" role="alert">
          Evenement macro imminent — attention au trade
        </div>
      )}
      {conf.fearGreedAdj && (
        <div className="macro-fg-hint">
          Ajustement score (Fear & Greed) : bonus {conf.fearGreedAdj === 'LONG' ? 'LONG' : 'SHORT'}
        </div>
      )}

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

      {Array.isArray(conf.divergenceMessages) && conf.divergenceMessages.length > 0 && (
        <div className="divergence-alerts" role="status">
          {conf.divergenceMessages.map((msg, i) => (
            <div key={`${msg}-${i}`} className="divergence-line mono">
              {msg}
            </div>
          ))}
        </div>
      )}

      <div className="signals signals--checklist">
        <div className="signals-title syne">Checklist</div>
        <div className="signals-row signals-row--checklist">
          {conf.checklist.map((c) => (
            <div key={c.label} className={`signal-chip signal-chip--check ${c.ok ? 'is-green' : 'is-red'}`}>
              <span className="checklist-icon" aria-hidden="true">
                {c.ok ? '✓' : '✕'}
              </span>
              <span>{c.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={`position-panel position-panel--risk-${riskTier}`}>
        <div className="signals-title syne">Gestion de position</div>
        <div className="position-inputs">
          <label className="position-field">
            <span className="position-label">Mon capital (€)</span>
            <input
              type="number"
              min={1}
              step={100}
              className="position-input mono"
              value={capital}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                setCapital(Number.isFinite(v) && v > 0 ? v : capital)
              }}
            />
          </label>
          <label className="position-field">
            <span className="position-label">Risque max par trade (%)</span>
            <input
              type="number"
              min={0.1}
              step={0.1}
              className="position-input mono"
              value={riskPct}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                setRiskPct(Number.isFinite(v) && v > 0 ? v : riskPct)
              }}
            />
          </label>
          <label className="position-field">
            <span className="position-label">Type de compte</span>
            <select
              className="position-input position-select mono"
              value={accountType}
              onChange={(e) => setAccountType(e.target.value)}
            >
              <option value="Standard">Standard</option>
              <option value="Mini">Mini</option>
              <option value="Micro">Micro</option>
            </select>
          </label>
        </div>

        {positionSizing ? (
          <div className="position-summary mono">
            <div className="position-line">
              💰 Capital : {Math.round(capital).toLocaleString('fr-FR')}€
            </div>
            <div className="position-line">
              ⚠️ Risque max : {riskPct}% = {Math.round(positionSizing.montantRisque).toLocaleString('fr-FR')}€
            </div>
            <div className="position-line">
              📏 Distance SL : {positionSizing.distanceSlPct.toFixed(2)}%
            </div>
            <div className="position-line">
              📊 Taille position : {Math.round(positionSizing.taillePosition).toLocaleString('fr-FR')}€
            </div>
            <div className="position-line">
              📈 Lots recommandés : {positionSizing.lotsRecommended.toFixed(4)}
              {item.category === 'Forex' && (
                <span className="position-forex-hint">
                  {' '}
                  (≈ {positionSizing.forexLotsEquivalent.toFixed(4)} lot(s) {accountType})
                </span>
              )}
            </div>
            <div className="position-line">
              💵 Exposition totale : {Math.round(positionSizing.taillePosition).toLocaleString('fr-FR')}€
            </div>
            {positionSizing.tooLarge && (
              <div className="position-warning" role="alert">
                ⚠️ Position trop grande — réduisez votre risque (exposition {'>'} 20 % du capital).
              </div>
            )}
          </div>
        ) : (
          <div className="position-summary position-summary--empty mono">
            Impossible de calculer (entrée = stop loss ou données invalides).
          </div>
        )}
      </div>

      <div className="ai-actions">
        <button
          type="button"
          className="ai-btn"
          onClick={callClaudeAnalysis}
          disabled={aiLoading}
        >
          <span className="ai-btn-glow" aria-hidden="true" />
          <span className="ai-btn-label">
            {aiLoading ? 'Analyse IA en cours...' : 'Analyse IA — Claude'}
          </span>
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
          <div className="trade-k">Support le plus proche</div>
          <div className="trade-v mono">{trade.support != null ? fmt(trade.support) : '—'}</div>
        </div>
        <div className="trade-row">
          <div className="trade-k">Résistance la plus proche</div>
          <div className="trade-v mono">{trade.resistance != null ? fmt(trade.resistance) : '—'}</div>
        </div>
        <div className="trade-row trade-row--sltp">
          <div className="trade-k">
            Stop Loss (niveau S/R)
          </div>
          <div className="trade-v mono stop">
            {fmt(trade.stopLoss)}
            {slPct == null ? '' : ` (${slPct >= 0 ? '+' : ''}${slPct.toFixed(2)}%)`}
          </div>
        </div>
        <div className="sltp-visual-track sltp-visual-track--sl" aria-hidden="true">
          <div className="sltp-visual-fill" style={{ width: `${slBarPct}%` }} />
        </div>
        <div className="trade-row trade-row--sltp">
          <div className="trade-k">
            Take Profit (niveau S/R)
          </div>
          <div className="trade-v mono take">
            {fmt(trade.takeProfit)}
            {tpPct == null ? '' : ` (${tpPct >= 0 ? '+' : ''}${tpPct.toFixed(2)}%)`}
          </div>
        </div>
        <div className="sltp-visual-track sltp-visual-track--tp" aria-hidden="true">
          <div className="sltp-visual-fill" style={{ width: `${tpBarPct}%` }} />
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
        <div className="signals-title">
          Contexte {contextTfLabel ?? '15m'}
          {contextLoading ? ' (chargement…)' : ''}
        </div>
        <div className="context-debug" style={{ fontSize: '11px', opacity: 0.9, marginBottom: 6 }}>
          TF actif : {contextTfLabel ?? '—'} | RSI calculé : {Number.isFinite(indicators?.rsi) ? indicators.rsi.toFixed(1) : '—'}
        </div>
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
          <div
            className={`signal-chip ${(indicators.stochRsi?.k ?? 50) < 20 ? 'is-green' : (indicators.stochRsi?.k ?? 50) > 80 ? 'is-red' : ''}`}
          >
            Stoch RSI {Number.isFinite(indicators.stochRsi?.k) ? indicators.stochRsi.k.toFixed(1) : '—'}
            {(indicators.stochRsi?.k ?? 50) < 20 ? ' (surv.)' : (indicators.stochRsi?.k ?? 50) > 80 ? ' (surch.)' : ''}
          </div>
          <div
            className={`signal-chip ${indicators.williamsR != null && indicators.williamsR < -80 ? 'is-green' : indicators.williamsR != null && indicators.williamsR > -20 ? 'is-red' : ''}`}
          >
            W%R {Number.isFinite(indicators.williamsR) ? indicators.williamsR.toFixed(1) : '—'}
          </div>
          {indicators.candlestickPattern?.name && (
            <div
              className={`signal-chip ${indicators.candlestickPattern.bullish ? 'is-green' : 'is-red'}`}
              title={`Pattern ${indicators.candlestickPattern.bullish ? 'haussiere' : 'baissiere'}`}
            >
              🕯️ {indicators.candlestickPattern.name}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [filter, setFilter] = useState('Tous')
  const [favoriteSymbols, setFavoriteSymbols] = useState(() => readFavoritesFromStorage())

  useEffect(() => {
    try {
      localStorage.setItem(LS_FAVORITES, JSON.stringify(favoriteSymbols))
    } catch {
      /* ignore */
    }
  }, [favoriteSymbols])

  const toggleFavorite = useCallback((sym) => {
    setFavoriteSymbols((prev) => {
      const s = new Set(prev)
      if (s.has(sym)) s.delete(sym)
      else s.add(sym)
      return [...s]
    })
  }, [])

  const categoryItems = useMemo(() => {
    if (filter === STRONG_SIGNAL_FILTER) return WATCHLIST
    if (filter === FAVORITES_FILTER) return WATCHLIST.filter((x) => favoriteSymbols.includes(x.tvSymbol))
    if (filter === 'Tous') return WATCHLIST
    return WATCHLIST.filter((x) => x.category === filter)
  }, [filter, favoriteSymbols])

  const [selectedTvSymbol, setSelectedTvSymbol] = useState(WATCHLIST[0].tvSymbol)
  // Un seul state pour chart + contexte (boutons timeframe)
  const [selectedTimeframe, setSelectedTimeframe] = useState(TIMEFRAMES[2])

  const handleTimeframeClick = useCallback((tf) => {
    setSelectedTimeframe(tf)
  }, [])

  const selectedItem = useMemo(
    () => WATCHLIST.find((x) => x.tvSymbol === selectedTvSymbol) ?? WATCHLIST[0],
    [selectedTvSymbol],
  )

  const [appReady, setAppReady] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setAppReady(true))
    return () => cancelAnimationFrame(id)
  }, [])

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
      initial[item.tvSymbol] = {
        confluence: buildConfluenceResult(mtfMap),
        mtfData: mtfMap,
      }
    }
    return initial
  })
  const [scoreHistory, setScoreHistory] = useState({})
  const [scorePulse, setScorePulse] = useState({})
  const [mobileWatchlistOpen, setMobileWatchlistOpen] = useState(false)
  const [chartFullscreen, setChartFullscreen] = useState(false)
  const [testAlertLoading, setTestAlertLoading] = useState(false)
  const [testAlertStatus, setTestAlertStatus] = useState(null)
  const [testAlertResponse, setTestAlertResponse] = useState(null)
  const [backtestOpen, setBacktestOpen] = useState(false)
  const [backtestLoading, setBacktestLoading] = useState(false)
  const [backtestError, setBacktestError] = useState(null)
  const [backtestData, setBacktestData] = useState(null)
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
  const macroRef = useRef({ fearGreedValue: null, macroImminent: false })

  const [fearGreed, setFearGreed] = useState(null)
  const [newsArticles, setNewsArticles] = useState([])
  const [calendarEvents, setCalendarEvents] = useState([])
  const [newsError, setNewsError] = useState(null)
  const [calendarError, setCalendarError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function loadFng() {
      try {
        const r = await fetch('https://api.alternative.me/fng/?limit=1')
        const json = await r.json()
        const row = json?.data?.[0]
        if (!cancelled && row) {
          setFearGreed({
            value: Number(row.value),
            label: row.value_classification || fearGreedLabel(Number(row.value)),
          })
        }
      } catch {
        if (!cancelled) setFearGreed(null)
      }
    }
    loadFng()
    const id = window.setInterval(loadFng, 5 * 60 * 1000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadNews() {
      try {
        const newsRes = await fetch('/api/news')
        const newsJson = await newsRes.json().catch(() => ({}))
        if (cancelled) return
        setNewsError(newsJson.ok === false && newsJson.error ? newsJson.error : null)
        if (newsJson.ok && Array.isArray(newsJson.articles)) setNewsArticles(newsJson.articles)
        else if (!newsJson.ok) setNewsArticles([])
      } catch {
        if (!cancelled) setNewsError('Erreur reseau')
      }
    }
    loadNews()
    const id = window.setInterval(loadNews, 5 * 60 * 1000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    function readCalendarCache() {
      try {
        const raw = localStorage.getItem(LS_CALENDAR_CACHE)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed.ts !== 'number' || !Array.isArray(parsed.events)) return null
        if (Date.now() - parsed.ts >= CALENDAR_CLIENT_TTL_MS) return null
        return parsed
      } catch {
        return null
      }
    }

    function writeCalendarCache(events) {
      try {
        localStorage.setItem(LS_CALENDAR_CACHE, JSON.stringify({ ts: Date.now(), events }))
      } catch {
        /* ignore */
      }
    }

    async function fetchCalendar() {
      try {
        const calRes = await fetch('/api/calendar')
        const calJson = await calRes.json().catch(() => ({}))
        if (cancelled) return
        setCalendarError(calJson.ok === false && calJson.error ? calJson.error : null)
        if (calJson.ok && Array.isArray(calJson.events)) {
          setCalendarEvents(calJson.events)
          writeCalendarCache(calJson.events)
        } else if (!calJson.ok) setCalendarEvents([])
      } catch {
        if (!cancelled) setCalendarError('Erreur reseau')
      }
    }

    const cached = readCalendarCache()
    if (cached) {
      setCalendarEvents(cached.events)
      setCalendarError(null)
    } else {
      fetchCalendar()
    }

    const id = window.setInterval(fetchCalendar, CALENDAR_CLIENT_TTL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  const macroContext = useMemo(
    () => ({
      fearGreedValue: fearGreed?.value,
      macroImminent: hasHighImpactMacroWithin2h(calendarEvents),
    }),
    [fearGreed, calendarEvents],
  )

  useEffect(() => {
    macroRef.current = macroContext
  }, [macroContext])

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
      const raw = scanResultsMap[item.tvSymbol]?.confluence
      if (!raw) continue
      const conf = applyMacroToConfluence(raw, macroRef.current)
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
      const raw = scanResults[item.tvSymbol]?.confluence
      if (!raw) return false
      const conf = applyMacroToConfluence(raw, macroContext)
      if (!conf) return false
      return conf.score > 75 && conf.trade.rr > 2 && conf.alignedCount >= 2
    })
  }, [filter, categoryItems, scanResults, macroContext])

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
        simUpdates[item.tvSymbol] = { confluence, mtfData: mtfMap }

        const nextScore = applyMacroToConfluence(confluence, macroRef.current)?.score
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

      // Twelve Data exige VITE_TWELVE_DATA_KEY : sinon ne pas lancer de tâches vouées à l'échec (Forex reste en placeholder).
      const realDataItems = WATCHLIST.filter(
        (x) => x.binanceSymbol || (x.twelveSymbol && TWELVE_DATA_KEY),
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
        return { tvSymbol: item.tvSymbol, confluence, mtfData: mtfMap }
      })

      const settled = await Promise.allSettled(tasks)
      const finalUpdates = {}
      const finalHistoryScores = {}
      const finalPulseSyms = []

      for (const s of settled) {
        if (s.status !== 'fulfilled') continue
        const { tvSymbol, confluence, mtfData } = s.value
        finalUpdates[tvSymbol] = { confluence, mtfData }

        const nextScore = applyMacroToConfluence(confluence, macroRef.current)?.score
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
    setTestAlertResponse(null)
    setTestAlertLoading(true)
    const text = '🧪 Test Scanner Pro - connexion OK !'
    try {
      const data = await sendTelegramTestAlert(text)
      setTestAlertResponse(data)
      setTestAlertStatus(data?.ok ? 'ok' : data?.error || 'Erreur')
      setTimeout(() => {
        setTestAlertStatus(null)
        setTestAlertResponse(null)
      }, 8000)
    } catch (err) {
      setTestAlertStatus(err instanceof Error ? err.message : 'Erreur')
      setTestAlertResponse({ error: err.message })
      setTimeout(() => {
        setTestAlertStatus(null)
        setTestAlertResponse(null)
      }, 8000)
    } finally {
      setTestAlertLoading(false)
    }
  }, [])

  const handleBacktestExportCsv = useCallback(() => {
    if (!backtestData?.trades?.length) return
    const csv = tradesToCsv(backtestData.trades)
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const safe = selectedItem.label.replace(/[/\\?%*:|"<>]/g, '-')
    a.download = `backtest-${safe}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [backtestData, selectedItem.label])

  useEffect(() => {
    if (!backtestOpen) return
    let cancelled = false
    ;(async () => {
      setBacktestLoading(true)
      setBacktestError(null)
      setBacktestData(null)
      try {
        if (!selectedItem.binanceSymbol && !(selectedItem.twelveSymbol && TWELVE_DATA_KEY)) {
          throw new Error(
            'Backtest disponible pour les cryptos (Binance) ou avec une clé Twelve Data (forex / matières).',
          )
        }
        const { m15, h4, d1 } = await fetchBacktestMtfCandles(selectedItem)
        if (cancelled) return
        const data = runBacktestOnCandles(m15, h4, d1)
        if (!cancelled) setBacktestData(data)
      } catch (e) {
        if (!cancelled) setBacktestError(e instanceof Error ? e.message : 'Erreur')
      } finally {
        if (!cancelled) setBacktestLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [backtestOpen, selectedItem])

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
  }, [selectedTimeframe])

  const selectedResult = scanResults[selectedTvSymbol]
  const selectedComputed = useMemo(() => {
    if (!selectedResult?.confluence) return null
    return {
      ...selectedResult,
      confluence: applyMacroToConfluence(selectedResult.confluence, macroContext),
    }
  }, [selectedResult, macroContext])

  const [contextIndicators, setContextIndicators] = useState(null)
  const [contextTfLabel, setContextTfLabel] = useState(selectedTimeframe.label ?? '15m')
  const [contextLoading, setContextLoading] = useState(false)

  // Recalcule le contexte (RSI, MACD, etc.) quand le timeframe ou le symbole change
  useEffect(() => {
    const tfId = selectedTimeframe.id
    const mtfKey = ['1D', '4H', '15m'].includes(tfId) ? tfId : null
    const result = scanResults[selectedTvSymbol]
    const mtfData = result?.mtfData

    if (mtfKey && mtfData?.[mtfKey]?.indicators) {
      const ind = mtfData[mtfKey].indicators
      setContextTfLabel(selectedTimeframe.label)
      setContextIndicators(ind)
      setContextLoading(false)
      return
    }

    if (!result?.confluence?.indicators) {
      setContextIndicators(null)
      setContextTfLabel(selectedTimeframe.label)
      setContextLoading(false)
      return
    }

    const item = WATCHLIST.find((x) => x.tvSymbol === selectedTvSymbol)
    if (!item?.binanceSymbol && !item?.twelveSymbol) {
      const fallback = tfId === '1m' || tfId === '5m' ? '15m' : tfId === '1H' ? '4H' : '1D'
      setContextIndicators(mtfData?.[fallback]?.indicators ?? result.confluence.indicators)
      setContextTfLabel(selectedTimeframe.label)
      setContextLoading(false)
      return
    }

    setContextLoading(true)
    setContextTfLabel(selectedTimeframe.label)

    let cancelled = false
    ;(async () => {
      try {
        let candles = []
        if (item.binanceSymbol) {
          candles = await fetchBinanceKlines(item.binanceSymbol, selectedTimeframe.binanceInterval, BINANCE_LIMIT)
        } else if (item.twelveSymbol && TWELVE_DATA_KEY) {
          candles = await fetchTwelveDataCandles(
            item.twelveSymbol,
            selectedTimeframe.twelveInterval,
            TWELVE_DATA_LIMIT,
            TWELVE_DATA_KEY,
          )
        }

        if (cancelled) return
        if (candles.length >= 80) {
          const computed = computeIndicatorsAndTrade(candles)
          if (computed) setContextIndicators(computed.indicators)
        } else {
          const fallback = tfId === '1m' || tfId === '5m' ? '15m' : tfId === '1H' ? '4H' : '1D'
          setContextIndicators(mtfData?.[fallback]?.indicators ?? result.confluence.indicators)
        }
      } catch {
        if (cancelled) return
        const fallback = tfId === '1m' || tfId === '5m' ? '15m' : tfId === '1H' ? '4H' : '1D'
        setContextIndicators(mtfData?.[fallback]?.indicators ?? result.confluence.indicators)
      } finally {
        if (!cancelled) setContextLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [selectedTvSymbol, selectedTimeframe.id, selectedTimeframe.label, selectedTimeframe.binanceInterval, selectedTimeframe.twelveInterval, scanResults])

  return (
    <div
      className={`scanner-app ${chartFullscreen ? 'is-fullscreen' : ''} ${appReady ? 'scanner-app--ready' : ''}`}
    >
      <header className="scanner-header">
        <div className="brand">
          <div className="brand-logo syne" aria-hidden="true">
            SP
          </div>
          <div className="brand-text">
            <div className="brand-title syne">
              Scanner Pro
              <span className="brand-accent">™</span>
            </div>
            <div className="brand-subtitle">
              TradingView · scores multi-TF · indicateurs temps reel
            </div>
          </div>
        </div>

        <div className="header-right">
          <button
            type="button"
            className="backtest-header-btn"
            onClick={() => setBacktestOpen(true)}
            title="Backtest : 200 bougies 15m, score confluence comme le scanner"
          >
            📊 Backtest
          </button>
          <div className="fear-greed-block" title="Crypto Fear & Greed (alternative.me)">
            <div className="fear-greed-pill mono">
              <span className="fear-greed-emoji">{fearGreedEmoji(fearGreed?.value)}</span>
              <span className="fear-greed-num">
                {fearGreed?.value != null ? `${Math.round(fearGreed.value)}` : '—'}
              </span>
              <span className="fear-greed-label">{fearGreedLabel(fearGreed?.value)}</span>
            </div>
            <div className="fear-greed-bar-wrap" aria-hidden="true">
              <div
                className="fear-greed-bar-fill"
                style={{
                  width: `${fearGreed?.value != null ? Math.round(clamp(fearGreed.value, 0, 100)) : 0}%`,
                }}
              />
            </div>
          </div>
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
          <div style={{ position: 'relative' }}>
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
          {testAlertResponse && (
            <div className="telegram-response-debug" style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 4,
              padding: 8,
              background: 'rgba(0,0,0,0.9)',
              border: '1px solid rgba(148,163,184,0.3)',
              borderRadius: 8,
              fontSize: 11,
              fontFamily: 'monospace',
              maxWidth: 320,
              maxHeight: 200,
              overflow: 'auto',
              zIndex: 100,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              Réponse API: {JSON.stringify(testAlertResponse, null, 2)}
            </div>
          )}
          </div>
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
        <aside className={`panel panel-left desktop-only ${chartFullscreen ? 'is-hidden' : ''}`}>
          <WatchlistPanel
            visibleItems={visibleItems}
            selectedTvSymbol={selectedTvSymbol}
            scanResults={scanResults}
            filter={filter}
            setFilter={setFilter}
            onPickSymbol={onPickSymbol}
            scoreHistory={scoreHistory}
            scorePulse={scorePulse}
            macroContext={macroContext}
            favoriteSymbols={favoriteSymbols}
            onToggleFavorite={toggleFavorite}
          />
          <NewsPanel
            articles={newsArticles}
            calendarEvents={calendarEvents}
            newsError={newsError}
            calendarError={calendarError}
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
                macroContext={macroContext}
                favoriteSymbols={favoriteSymbols}
                onToggleFavorite={toggleFavorite}
              />
            </div>
          </div>
        </div>

        <section className={`panel panel-center ${chartFullscreen ? 'is-fullscreen' : ''}`}>
          <div className="panel-header">
            <div>
              <div className="panel-title syne">Chart temps reel</div>
              <div className="panel-subtitle">{selectedItem.label} (TradingView)</div>
            </div>
            <div className="panel-header-right">
              <div className="panel-badge mono" title="Timeframe actif">
                TF: {selectedTimeframe.label}
              </div>
              <button
                type="button"
                className="fullscreen-btn"
                onClick={() => setChartFullscreen((v) => !v)}
                title={chartFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
                aria-label={chartFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
              >
                {chartFullscreen ? '⊡ Réduire' : '⛶ Plein écran'}
              </button>
            </div>
          </div>

          <div className="timeframe-block">
            <div className="timeframe-buttons" role="tablist" aria-label="Timeframe">
              {TIMEFRAMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`timeframe-btn ${selectedTimeframe.id === t.id ? 'is-active' : ''}`}
                  onClick={() => handleTimeframeClick(t)}
                  aria-pressed={selectedTimeframe.id === t.id}
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

        <aside className={`panel panel-right ${chartFullscreen ? 'is-hidden' : ''}`}>
          <div className="panel-title syne">Signal ideal</div>
          <SignalIdealPanel
            item={selectedItem}
            result={selectedComputed}
            contextIndicators={contextIndicators}
            contextTfLabel={contextTfLabel}
            contextLoading={contextLoading}
            selectedTimeframe={selectedTimeframe}
            fearGreed={fearGreed}
            macroContext={macroContext}
          />
        </aside>
      </main>

      <footer className="scanner-footer">
        {`Données : Binance (crypto) + Twelve Data (forex/matières). Scores multi-timeframe 1D/4H/15m. Chart : TradingView (${selectedTimeframe.tradingViewInterval}).`}
      </footer>

      <BacktestPanel
        open={backtestOpen}
        onClose={() => setBacktestOpen(false)}
        item={selectedItem}
        loading={backtestLoading}
        error={backtestError}
        data={backtestData}
        onExportCsv={handleBacktestExportCsv}
      />
    </div>
  )
}
