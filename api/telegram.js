/**
 * Proxy Vercel → Telegram Bot API
 * Variables: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  const tokenPreview = token && typeof token === 'string' ? token.trim().slice(0, 15) : '(absent)'
  console.log('[telegram] token présent:', !!token, 'token[0:15]:', tokenPreview, 'chatId:', chatId ?? '(absent)')

  if (!token || String(token).trim() === '') {
    return res.status(500).json({
      ok: false,
      error: 'TELEGRAM_BOT_TOKEN manquant',
      detail: 'Définissez TELEGRAM_BOT_TOKEN dans Vercel Environment Variables.',
      telegramResponse: null,
    })
  }

  if (!chatId || String(chatId).trim() === '') {
    return res.status(500).json({
      ok: false,
      error: 'TELEGRAM_CHAT_ID manquant',
      detail: 'Définissez TELEGRAM_CHAT_ID dans Vercel Environment Variables.',
      telegramResponse: null,
    })
  }

  let body
  try {
    body = typeof req.body === 'object' && req.body !== null
      ? req.body
      : typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : {}
  } catch {
    return res.status(400).json({
      ok: false,
      error: 'Corps JSON invalide',
      telegramResponse: null,
    })
  }

  const text = body?.text
  if (!text || typeof text !== 'string') {
    return res.status(400).json({
      ok: false,
      error: 'Champ "text" (string) requis',
      telegramResponse: null,
    })
  }

  const tokenTrimmed = String(token).trim()
  const url = `https://api.telegram.org/bot${tokenTrimmed}/sendMessage`

  try {
    const tgRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatId).trim(),
        text: text.slice(0, 4096),
        disable_web_page_preview: true,
      }),
    })

    const rawBody = await tgRes.text()
    let telegramResponse
    try {
      telegramResponse = rawBody ? JSON.parse(rawBody) : null
    } catch {
      telegramResponse = { _raw: rawBody.slice(0, 500) }
    }

    if (!tgRes.ok) {
      console.error('[telegram] Telegram HTTP', tgRes.status, rawBody)
      return res.status(200).json({
        ok: false,
        error: `Telegram HTTP ${tgRes.status}`,
        detail: telegramResponse?.description || rawBody.slice(0, 300),
        telegramResponse,
      })
    }

    if (telegramResponse?.ok !== true) {
      console.error('[telegram] Telegram API error:', telegramResponse)
      return res.status(200).json({
        ok: false,
        error: telegramResponse?.description || 'Erreur Telegram',
        telegramResponse,
      })
    }

    console.log('[telegram] Message envoyé avec succès')
    return res.status(200).json({
      ok: true,
      telegramResponse,
    })
  } catch (err) {
    console.error('[telegram]', err)
    return res.status(502).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      detail: err instanceof Error && err.stack ? err.stack.slice(0, 500) : '',
      telegramResponse: null,
    })
  }
}
