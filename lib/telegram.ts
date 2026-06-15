import { config as loadEnv } from 'dotenv'
import path from 'node:path'
import https from 'node:https'

loadEnv({ path: path.resolve(process.cwd(), '.env.local') })
loadEnv({ path: path.resolve(process.cwd(), '.env') })

const BOT_TOKEN = process.env.BOT_TOKEN
const ALLOWED_USERS = (process.env.ALLOWED_USERS?.split(',') ?? [])
  .map((id) => id.trim())
  .filter((id) => id.length > 0)

const ipv4Agent = new https.Agent({ family: 4, keepAlive: true })

export async function sendTelegramMessage(text: string): Promise<void> {
  if (!BOT_TOKEN || ALLOWED_USERS.length === 0) {
    return
  }

  const chatId = ALLOWED_USERS[0]
  const postData = JSON.stringify({ chat_id: chatId, text })

  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${BOT_TOKEN}/sendMessage`,
    method: 'POST',
    agent: ipv4Agent,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const req = https.request(options, (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            console.error(`[telegram] sendMessage failed (${res.statusCode}): ${body}`)
          }
          resolve()
        })
      })

      req.on('error', (e) => {
        console.error(`[telegram] sendMessage network error:`, e)
        resolve() // Do not reject, to avoid throwing
      })

      req.write(postData)
      req.end()
    })
  } catch (error) {
    console.error(`[telegram] sendMessage unexpected error:`, error)
  }
}
