/**
 * Proxy NewsAPI.org — clé serveur NEWS_API_KEY (Vercel)
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const key = process.env.NEWS_API_KEY
  if (!key || String(key).trim() === '') {
    return res.status(200).json({
      ok: false,
      articles: [],
      error: 'NEWS_API_KEY manquant',
      detail: 'Ajoutez NEWS_API_KEY (NewsAPI.org) dans Vercel Environment Variables.',
    })
  }

  const keyTrim = String(key).trim()
  const everythingUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent('forex OR Fed OR CPI OR economy')}&language=en&sortBy=publishedAt&pageSize=5&apiKey=${keyTrim}`
  const headlinesUrl = `https://newsapi.org/v2/top-headlines?category=business&language=en&pageSize=5&apiKey=${keyTrim}`

  try {
    let r = await fetch(everythingUrl)
    let data = await r.json()
    if (!r.ok || data.status === 'error' || !Array.isArray(data.articles) || data.articles.length === 0) {
      r = await fetch(headlinesUrl)
      data = await r.json()
    }
    if (!r.ok || data.status === 'error') {
      return res.status(200).json({
        ok: false,
        articles: [],
        error: data.message || `NewsAPI HTTP ${r.status}`,
        raw: data,
      })
    }
    const articles = (data.articles || []).slice(0, 5).map((a) => ({
      title: a.title || '',
      source: a.source?.name || '—',
      publishedAt: a.publishedAt || null,
      url: a.url || '',
      impact: inferImpact(a.title || ''),
    }))
    return res.status(200).json({ ok: true, articles })
  } catch (e) {
    return res.status(502).json({
      ok: false,
      articles: [],
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

function inferImpact(title) {
  const t = title.toLowerCase()
  if (/fed|fomc|cpi|nfp|non-farm|interest rate|ecb|gdp|jobs report|payroll/i.test(t)) {
    return 'high'
  }
  if (/inflation|retail sales|pmi|unemployment|gdp|trade balance/i.test(t)) {
    return 'medium'
  }
  return 'low'
}
