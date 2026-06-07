import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { randomUUID } from 'node:crypto'

// R2(S3 호환) 설정. 필수 환경변수가 없으면 첫 사용 시점에 명확한 에러를 던진다.
function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`R2 환경변수 누락: ${name}`)
  }
  return value
}

let cachedClient: S3Client | null = null

function getClient(): S3Client {
  if (cachedClient) return cachedClient

  cachedClient = new S3Client({
    region: 'auto',
    endpoint: requireEnv('CLOUDFLARE_R2_ENDPOINT'),
    credentials: {
      accessKeyId: requireEnv('CLOUDFLARE_USER_R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('CLOUDFLARE_USER_R2_SECRET_ACCESS_KEY'),
    },
  })

  return cachedClient
}

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
}
const FETCH_TIMEOUT_MS = 15000

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

function extFromUrl(sourceUrl: string): string | null {
  try {
    const pathname = new URL(sourceUrl).pathname
    const match = pathname.match(/\.([a-zA-Z0-9]{2,5})$/)
    return match ? match[1].toLowerCase() : null
  } catch {
    return null
  }
}

/**
 * R2 키 생성: images/rss/YYYY-MM/랜덤uuid.확장자
 * 확장자는 content-type을 우선 사용하고, 없으면 원본 URL 경로에서 추론한다.
 */
export function buildRssImageKey(sourceUrl: string, contentType?: string | null): string {
  const now = new Date()
  const yyyyMM = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`

  const normalizedType = (contentType ?? '').split(';')[0].trim().toLowerCase()
  const ext = EXT_BY_CONTENT_TYPE[normalizedType] ?? extFromUrl(sourceUrl) ?? 'jpg'

  return `images/rss/${yyyyMM}/${randomUUID()}.${ext}`
}

/**
 * 외부 이미지 URL을 fetch해서 R2에 업로드하고 public_url을 반환한다.
 * r2Key를 직접 넘기면 그 키를 사용하고, 생략하면 buildRssImageKey로 생성한다.
 */
export async function uploadImageFromUrl(
  sourceUrl: string,
  r2Key?: string
): Promise<{ r2Key: string; publicUrl: string }> {
  const res = await fetch(sourceUrl, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  if (!res.ok) {
    throw new Error(`이미지 fetch 실패 (HTTP ${res.status}): ${sourceUrl}`)
  }

  const contentType = res.headers.get('content-type')
  if (!contentType || !contentType.toLowerCase().startsWith('image/')) {
    throw new Error(`이미지가 아님 (content-type: ${contentType ?? 'none'}): ${sourceUrl}`)
  }

  const body = new Uint8Array(await res.arrayBuffer())
  if (body.byteLength === 0) {
    throw new Error(`빈 이미지 응답: ${sourceUrl}`)
  }

  const key = r2Key ?? buildRssImageKey(sourceUrl, contentType)
  const bucket = requireEnv('CLOUDFLARE_R2_BUCKET_NAME')

  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType.split(';')[0].trim(),
    })
  )

  const publicBase = requireEnv('CLOUDFLARE_R2_PUBLIC_URL').replace(/\/+$/, '')
  return { r2Key: key, publicUrl: `${publicBase}/${key}` }
}
