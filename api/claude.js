/**
 * Proxy Vercel Serverless → Anthropic (évite CORS navigateur).
 * Variables : ANTHROPIC_KEY (sans préfixe VITE_)
 */

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

async function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return {}
    }
  }
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

export default async function handler(req, res) {
  corsHeaders(res)

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const key = process.env.ANTHROPIC_KEY
  if (!key) {
    return res.status(500).json({ error: 'ANTHROPIC_KEY manquant côté serveur' })
  }

  let body
  try {
    body = await parseJsonBody(req)
  } catch {
    return res.status(400).json({ error: 'JSON invalide' })
  }

  const prompt = body?.prompt
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Champ "prompt" (string) requis' })
  }

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-3-5-20251001',
        max_tokens: 240,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await anthropicRes.json()

    if (!anthropicRes.ok) {
      const msg =
        data?.error?.message ||
        data?.message ||
        `Anthropic HTTP ${anthropicRes.status}`
      return res.status(anthropicRes.status >= 500 ? 502 : anthropicRes.status).json({
        error: msg,
      })
    }

    const text =
      Array.isArray(data?.content) && data.content[0]?.text
        ? String(data.content[0].text).trim()
        : ''

    return res.status(200).json({ text: text || 'Aucune reponse IA.' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur serveur proxy'
    return res.status(502).json({ error: message })
  }
}
