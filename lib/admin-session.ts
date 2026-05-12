export const SESSION_COOKIE_NAME = 'admin_session'
export const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60
const SESSION_DURATION_MS = SESSION_MAX_AGE_SECONDS * 1000

const encoder = new TextEncoder()

async function importKey(password: string) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function toBase64Url(buffer: ArrayBuffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): ArrayBuffer {
  const pad = (4 - (value.length % 4)) % 4
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad)
  const binary = atob(b64)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return buffer
}

export async function signAdminSession(password: string): Promise<string> {
  const expiresAt = Date.now() + SESSION_DURATION_MS
  const payload = String(expiresAt)
  const key = await importKey(password)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return `${payload}.${toBase64Url(signature)}`
}

export async function verifyAdminSession(token: string, password: string): Promise<boolean> {
  const dot = token.indexOf('.')
  if (dot < 0) return false
  const payload = token.slice(0, dot)
  const sigPart = token.slice(dot + 1)
  const expiresAt = Number(payload)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false

  let signature: ArrayBuffer
  try {
    signature = fromBase64Url(sigPart)
  } catch {
    return false
  }
  const key = await importKey(password)
  return crypto.subtle.verify('HMAC', key, new Uint8Array(signature), encoder.encode(payload))
}
