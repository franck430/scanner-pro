/**
 * Calendrier économique — ForexFactory (JSON public, sans clé API)
 * https://nfs.faireconomy.media/ff_calendar_thisweek.json
 *
 * Cache mémoire 1 h pour limiter les 429 côté upstream.
 */

const FF_CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'
const CACHE_TTL_MS = 60 * 60 * 1000

/** @type {{ payload: object | null, expiresAt: number }} */
let memoryCache = { payload: null, expiresAt: 0 }

function mapImpact(raw) {
  const x = String(raw || '').toLowerCase()
  if (x === 'high') return 'high'
  if (x === 'medium') return 'medium'
  if (x === 'holiday') return 'low'
  return 'low'
}

function buildPayloadFromRaw(raw) {
  if (!Array.isArray(raw)) {
    return { ok: false, events: [], error: 'Format calendrier inattendu', source: 'ff_calendar_thisweek' }
  }

  const now = Date.now()
  const mapped = raw
    .filter((e) => e && String(e.impact || '').toLowerCase() !== 'holiday')
    .map((e) => {
      const iso = e.date
      const ts = iso ? Date.parse(iso) : NaN
      const impact = mapImpact(e.impact)
      let displayTime = '—'
      if (Number.isFinite(ts)) {
        displayTime = new Date(ts).toLocaleString('fr-FR', {
          dateStyle: 'short',
          timeStyle: 'short',
        })
      }
      return {
        title: e.title || '—',
        country: e.country || '—',
        date: iso || null,
        displayTime,
        impact,
        _ts: ts,
      }
    })
    .filter((e) => Number.isFinite(e._ts))

  const sorted = mapped.sort((a, b) => a._ts - b._ts)
  const upcoming = sorted.filter((e) => e._ts >= now)
  const picked = (upcoming.length ? upcoming : sorted).slice(0, 12)
  const events = picked.map(({ _ts, ...rest }) => rest)

  return { ok: true, events, source: 'ff_calendar_thisweek' }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Cache-Control', 'public, max-age=3600')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const now = Date.now()
  if (memoryCache.payload && now < memoryCache.expiresAt) {
    return res.status(200).json({ ...memoryCache.payload, cached: true })
  }

  try {
    const r = await fetch(FF_CALENDAR_URL, {
      headers: { Accept: 'application/json' },
    })

    if (!r.ok) {
      if (memoryCache.payload) {
        memoryCache = { payload: memoryCache.payload, expiresAt: now + CACHE_TTL_MS }
        return res.status(200).json({ ...memoryCache.payload, cached: true, stale: true })
      }
      return res.status(200).json({
        ok: false,
        events: [],
        error: `Calendrier HTTP ${r.status}`,
        source: 'ff_calendar_thisweek',
      })
    }

    const raw = await r.json()
    const payload = buildPayloadFromRaw(raw)
    if (payload.ok) {
      memoryCache = { payload, expiresAt: now + CACHE_TTL_MS }
    }
    return res.status(200).json({ ...payload, cached: false })
  } catch (e) {
    if (memoryCache.payload) {
      memoryCache = { payload: memoryCache.payload, expiresAt: now + CACHE_TTL_MS }
      return res.status(200).json({ ...memoryCache.payload, cached: true, stale: true })
    }
    return res.status(502).json({
      ok: false,
      events: [],
      error: e instanceof Error ? e.message : String(e),
    })
  }
}
