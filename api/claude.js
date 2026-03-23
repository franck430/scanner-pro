/**
 * Proxy Vercel Serverless → Anthropic (évite CORS navigateur).
 * Variables Vercel : ANTHROPIC_KEY (sans préfixe VITE_ — les clés VITE_* ne sont pas injectées côté API).
 */
function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function safeJson(res, status, payload) {
  return res.status(status).json(payload)
}

function truncate(str, max = 4000) {
  const s = String(str)
  return s.length <= max ? s : `${s.slice(0, max)}… [tronque]`
}

async function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body
  }
  if (typeof req.body === 'string') {
    try {
      return req.body ? JSON.parse(req.body) : {}
    } catch (e) {
      const err = new Error('Corps JSON invalide (string)')
      err.cause = e
      throw err
    }
  }
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch (e) {
    const err = new Error('Corps JSON invalide (stream)')
    err.cause = e
    throw err
  }
}

/**
 * Clé serveur uniquement. Vercel : Project Settings → Environment Variables → ANTHROPIC_KEY
 * (sans préfixe VITE_ — le client ne doit jamais recevoir cette clé).
 */
function getAnthropicKey() {
  const raw =
    process.env.ANTHROPIC_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    ''
  const key = typeof raw === 'string' ? raw.trim() : ''
  return key
}

export default async function handler(req, res) {
  corsHeaders(res)

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return safeJson(res, 405, {
      error: 'Method not allowed',
      detail: `Seules les requetes POST sont acceptees (recu: ${req.method || 'unknown'}).`,
    })
  }

  const key = getAnthropicKey()
  if (!key) {
    return safeJson(res, 500, {
      error: 'ANTHROPIC_KEY manquant cote serveur',
      detail:
        'Definissez la variable ANTHROPIC_KEY dans Vercel : Project → Settings → Environment Variables. ' +
        'Sans prefixe VITE_. Re-deployez apres ajout. Les variables VITE_* ne sont pas disponibles pour /api/*.',
      phase: 'env',
    })
  }

  let body
  try {
    body = await parseJsonBody(req)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : ''
    return safeJson(res, 400, {
      error: 'Corps de requete invalide',
      detail: truncate([msg, cause].filter(Boolean).join(' | ') || 'JSON parse error'),
      phase: 'parse_request_body',
    })
  }

  const prompt = body?.prompt
  if (!prompt || typeof prompt !== 'string') {
    return safeJson(res, 400, {
      error: 'Champ "prompt" (string) requis',
      detail: `Corps recu: ${truncate(JSON.stringify(body ?? {}))}`,
      phase: 'validate_prompt',
    })
  }

  let anthropicRes
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
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
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    console.error('[api/claude] fetch Anthropic', err)
    return safeJson(res, 502, {
      error: 'Echec reseau vers api.anthropic.com',
      detail: truncate(`${err.name}: ${err.message}${err.stack ? `\n${err.stack}` : ''}`),
      phase: 'fetch_anthropic',
    })
  }

  const rawBody = await anthropicRes.text()
  let data

  try {
    data = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    console.error('[api/claude] reponse non-JSON', anthropicRes.status, truncate(rawBody))
    return safeJson(res, 502, {
      error: `Reponse Anthropic non-JSON (HTTP ${anthropicRes.status})`,
      detail: truncate(rawBody || '(vide)'),
      anthropicStatus: anthropicRes.status,
      phase: 'parse_anthropic_json',
    })
  }

  if (!anthropicRes.ok) {
    const apiErr = data?.error
    const msg =
      (typeof apiErr === 'object' && apiErr?.message) ||
      (typeof apiErr === 'string' ? apiErr : null) ||
      data?.message ||
      `Anthropic HTTP ${anthropicRes.status}`
    const type = typeof apiErr === 'object' && apiErr?.type ? String(apiErr.type) : ''
    const detail =
      [
        type && `type: ${type}`,
        typeof data === 'object' && data !== null ? truncate(JSON.stringify(data)) : '',
      ]
        .filter(Boolean)
        .join('\n') || truncate(rawBody)

    const statusOut = anthropicRes.status >= 500 ? 502 : anthropicRes.status
    console.error('[api/claude] Anthropic erreur', anthropicRes.status, detail)

    return safeJson(res, statusOut, {
      error: msg,
      detail,
      anthropicStatus: anthropicRes.status,
      phase: 'anthropic_api_error',
    })
  }

  const text =
    Array.isArray(data?.content) && data.content[0]?.text
      ? String(data.content[0].text).trim()
      : ''

  return safeJson(res, 200, { text: text || 'Aucune reponse IA.' })
}
