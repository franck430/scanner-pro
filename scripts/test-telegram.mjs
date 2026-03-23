#!/usr/bin/env node
/**
 * Test direct de l'API Telegram (sans passer par le proxy).
 * Usage: node scripts/test-telegram.mjs
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

let token = ''
let chatId = ''
try {
  const env = readFileSync(join(root, '.env'), 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^TELEGRAM_BOT_TOKEN=(.*)$/)
    if (m) token = m[1].trim()
    const m2 = line.match(/^TELEGRAM_CHAT_ID=(.*)$/)
    if (m2) chatId = m2[1].trim()
  }
} catch (e) {
  console.error('Impossible de lire .env:', e.message)
  process.exit(1)
}

if (!token || !chatId) {
  console.error('TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID manquant dans .env')
  process.exit(1)
}

const url = `https://api.telegram.org/bot${token}/sendMessage`
const body = JSON.stringify({
  chat_id: chatId,
  text: '🧪 Test direct API Telegram - Scanner Pro',
})

console.log('Appel Telegram:', url.replace(token.slice(0, 10), '***'))
console.log('chat_id:', chatId)

const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body,
})

const data = await res.json().catch(() => ({}))
console.log('HTTP', res.status)
console.log('Response:', JSON.stringify(data, null, 2))

if (res.ok && data.ok) {
  console.log('\n✅ Message envoyé avec succès sur Telegram.')
} else {
  console.error('\n❌ Échec:', data.description || data.error || res.statusText)
  process.exit(1)
}
