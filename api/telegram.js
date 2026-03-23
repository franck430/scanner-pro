/**
 * Proxy Vercel → Telegram Bot API (évite CORS + garde le token côté serveur).
 * Variables : TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function safeJson(res, status, payload) {
  return res.status(status).json(payload)
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

export default async function handler(req, res) {
  corsHeaders(res)

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return safeJson(res, 405, { error: 'Method not allowed' })
  }

  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!token || String(token).trim() === '') {
    return safeJson(res, 500, {
      error: 'TELEGRAM_BOT_TOKEN manquant',
      detail: 'Definissez TELEGRAM_BOT_TOKEN dans Vercel (Environment Variables).',
    })
  }
  if (chatId == null || String(chatId).trim() === '') {
    return safeJson(res, 500, {
      error: 'TELEGRAM_CHAT_ID manquant',
      detail: 'Definissez TELEGRAM_CHAT_ID dans Vercel (Environment Variables).',
    })
  }

  let body
  try {
    body = await parseJsonBody(req)
  } catch (e) {
    return safeJson(res, 400, {
      error: 'Corps JSON invalide',
      detail: e instanceof Error ? e.message : String(e),
    })
  }

  const text = body?.text
  if (!text || typeof text !== 'string') {
    return safeJson(res, 400, { error: 'Champ "text" (string) requis' })
  }

  const url = `https://api.telegram.org/bot${String(token).trim()}/sendMessage`

  try {
    const tgRes = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatId).trim(),
        text: text.slice(0, 4096),
        disable_web_page_preview: true,
      }),
    })

    const rawBody = await tgRes.text()
    let data
    try {
      data = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      return safeJson(res, 502, {
        error: 'Reponse Telegram non-JSON',
        detail: rawBody.slice(0, 2000),
        httpStatus: tgRes.status,
      })
    }

    if (!tgRes.ok || data.ok === false) {
      const desc = data.description || data.error || `Telegram HTTP ${tgRes.status}`
      return safeJson(res, 502, {
        error: desc,
        detail: JSON.stringify(data),
        httpStatus: tgRes.status,
      })
    }

    return safeJson(res, 200, { ok: true, result: data.result })
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    console.error('[api/telegram]', err)
    return safeJson(res, 502, {
      error: err.message,
      detail: err.stack ? String(err.stack).slice(0, 1500) : '',
    })
  }
}
