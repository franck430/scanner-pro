/**
 * Calendrier économique — ForexFactory (JSON public, sans clé API)
 * https://nfs.faireconomy.media/ff_calendar_thisweek.json
 */

const FF_CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'

function mapImpact(raw) {
  const x = String(raw || '').toLowerCase()
  if (x === 'high') return 'high'
  if (x === 'medium') return 'medium'
  if (x === 'holiday') return 'low'
  return 'low'
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  try {
    const r = await fetch(FF_CALENDAR_URL, {
      headers: { Accept: 'application/json' },
    })
    if (!r.ok) {
      return res.status(200).json({
        ok: false,
        events: [],
        error: `Calendrier HTTP ${r.status}`,
      })
    }

    const raw = await r.json()
    if (!Array.isArray(raw)) {
      return res.status(200).json({
        ok: false,
        events: [],
        error: 'Format calendrier inattendu',
      })
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

    return res.status(200).json({ ok: true, events, source: 'ff_calendar_thisweek' })
  } catch (e) {
    return res.status(502).json({
      ok: false,
      events: [],
      error: e instanceof Error ? e.message : String(e),
    })
  }
}
