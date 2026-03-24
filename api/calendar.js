/**
 * Calendrier économique — Finnhub (FINNHUB_API_KEY) ou liste vide.
 * Filtre événements US majeurs : NFP, CPI, FOMC, GDP, etc.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const token = process.env.FINNHUB_API_KEY
  const now = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - 1)
  const to = new Date(now)
  to.setDate(to.getDate() + 14)

  const fromStr = from.toISOString().slice(0, 10)
  const toStr = to.toISOString().slice(0, 10)

  if (!token || String(token).trim() === '') {
    return res.status(200).json({
      ok: false,
      events: [],
      error: 'FINNHUB_API_KEY manquant',
      detail: 'Optionnel : ajoutez une clé gratuite sur finnhub.io pour le calendrier réel.',
    })
  }

  const url = `https://finnhub.io/api/v1/calendar/economic?from=${fromStr}&to=${toStr}&token=${String(token).trim()}`

  try {
    const r = await fetch(url)
    const data = await r.json()
    if (!r.ok) {
      return res.status(200).json({
        ok: false,
        events: [],
        error: `Finnhub HTTP ${r.status}`,
        raw: data,
      })
    }

    const economicCalendar = data.economicCalendar || []
    const keywords =
      /non.?farm|nfp|cpi|consumer price|fomc|fed|interest rate|gdp|gross domestic|retail sales|unemployment/i

    const filtered = economicCalendar
      .filter((e) => {
        const country = String(e.country || '').toUpperCase()
        if (country !== 'US' && country !== 'EU' && country !== 'EZ') return false
        const ev = String(e.event || e.description || '')
        return keywords.test(ev)
      })
      .slice(0, 8)
      .map((e) => {
        const ev = String(e.event || e.description || '—')
        const impact =
          /non.?farm|nfp|cpi|fomc|fed decision|interest rate/i.test(ev)
            ? 'high'
            : /gdp|retail|unemployment/i.test(ev)
              ? 'medium'
              : 'low'
        const time = e.time ? `${e.date} ${e.time}` : e.date
        return {
          title: ev,
          country: e.country || '—',
          date: e.date,
          time: e.time || null,
          displayTime: time,
          impact,
        }
      })

    return res.status(200).json({ ok: true, events: filtered })
  } catch (e) {
    return res.status(502).json({
      ok: false,
      events: [],
      error: e instanceof Error ? e.message : String(e),
    })
  }
}
