import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local', quiet: true })

const WIKIPEDIA_SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary'
const REQUEST_DELAY_MS = 200
// Wikipedia REST API 는 식별 가능한 User-Agent 를 요구한다.
const USER_AGENT = 'todayartistlife/1.0 (artist profile image fetcher)'

const requiredEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
}

const missingEnv = Object.entries(requiredEnv)
  .filter(([, value]) => !value)
  .map(([key]) => key)

if (missingEnv.length > 0) {
  console.error(`Missing required environment variables in .env.local: ${missingEnv.join(', ')}`)
  process.exit(1)
}

const supabase = createClient(
  requiredEnv.NEXT_PUBLIC_SUPABASE_URL,
  requiredEnv.SUPABASE_SERVICE_ROLE_KEY
)

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

function readArtists(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
    if (!Array.isArray(parsed)) {
      throw new Error('Expected an array of artist entities')
    }
    return parsed
  } catch (error) {
    throw new Error(`Failed to load artist JSON at ${filePath}: ${error.message}`)
  }
}

function wikipediaTitle(name) {
  return encodeURIComponent(name.replace(/ /g, '_'))
}

async function fetchThumbnail(name) {
  const url = `${WIKIPEDIA_SUMMARY_URL}/${wikipediaTitle(name)}`

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Wikipedia API failed [${response.status}] for "${name}"`)
  }

  const data = await response.json()
  const source = data?.thumbnail?.source
  return typeof source === 'string' && source.length > 0 ? source : null
}

async function upsertProfileImage(artist, imageUrl) {
  const { error } = await supabase
    .from('entities')
    .upsert(
      {
        name: artist.name,
        korean_name: artist.korean_name ?? null,
        type: artist.type,
        profile_image_url: imageUrl,
      },
      { onConflict: 'name,type' }
    )

  if (error) {
    throw new Error(`Supabase upsert failed for "${artist.name}": ${error.message}`)
  }
}

async function main() {
  const artistsPath = resolve(process.cwd(), 'lib/entities/artists.json')
  const artists = readArtists(artistsPath)

  console.log(`Fetching Wikipedia profile images for ${artists.length} artists.`)

  let updated = 0
  let skipped = 0
  let failed = 0

  for (const [index, artist] of artists.entries()) {
    if (!artist?.name || !artist?.type) {
      console.warn(`Skipping invalid entity at index ${index}: ${JSON.stringify(artist)}`)
      skipped += 1
      continue
    }

    try {
      const imageUrl = await fetchThumbnail(artist.name)

      if (!imageUrl) {
        console.log(`- ${artist.name}: no image, skipped`)
        skipped += 1
      } else {
        await upsertProfileImage(artist, imageUrl)
        console.log(`✓ ${artist.name}: ${imageUrl}`)
        updated += 1
      }
    } catch (error) {
      console.error(`✗ ${artist.name}: ${error.message}`)
      failed += 1
    }

    if (index < artists.length - 1) {
      await sleep(REQUEST_DELAY_MS)
    }
  }

  console.log(`\nDone. updated=${updated}, skipped=${skipped}, failed=${failed}`)
}

main().catch((error) => {
  console.error('Failed to fetch artist images:', error)
  process.exit(1)
})
