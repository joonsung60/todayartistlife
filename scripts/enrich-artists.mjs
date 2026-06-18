// 아티스트 프로필 보강(enrichment) 스크립트.
//
// lib/entities/artists.json 의 각 아티스트에 대해 외부 소스에서 데이터를 수집하고
// Supabase entities 테이블(name,type conflict)에 upsert 한다.
//
//   - 이미지        : Wikipedia REST summary thumbnail → 없으면 Last.fm artist.getinfo
//   - 장르/시대/관련: Last.fm artist.getinfo(tags) + artist.getSimilar
//   - 외부 링크     : MusicBrainz url-rels (spotify / apple music / SNS)
//   - 수상 이력     : MusicBrainz (수집 가능한 경우)
//   - 바이오        : Wikipedia summary + Last.fm bio → Ollama 로 한국어 재구성
//                     (Ollama 실패 시 Wikipedia summary 를 그대로 저장)
//
// scripts/fetch-artist-images.mjs 의 이미지 로직을 참고했다. (원본은 수정하지 않음)
//
// 사용 예:
//   node scripts/enrich-artists.mjs                 # 전체
//   node scripts/enrich-artists.mjs --limit=10      # 앞에서 10명만
//   node scripts/enrich-artists.mjs --offset=20     # 21번째부터
//   node scripts/enrich-artists.mjs --only="Taylor Swift"
//   node scripts/enrich-artists.mjs --missing-only  # 아직 보강 안 된 항목만

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import dns from 'node:dns'
import net from 'node:net'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local', quiet: true })

// 일부 외부 API(특히 MusicBrainz)는 IPv6 주소를 함께 광고한다.
// WSL 등 IPv6 경로가 막힌 환경에서 Node 의 Happy Eyeballs 가 멈춰
// fetch 가 ETIMEDOUT 으로 실패하는 문제가 있어 IPv4 를 우선/강제한다.
dns.setDefaultResultOrder('ipv4first')
net.setDefaultAutoSelectFamily?.(false)

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------
const WIKIPEDIA_SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary'
const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/'
const MUSICBRAINZ_URL = 'https://musicbrainz.org/ws/2'

// 외부 API 호출 사이 최소 delay. MusicBrainz 는 1req/sec 정책이라 더 길게 잡는다.
const DEFAULT_DELAY_MS = 220
const MUSICBRAINZ_DELAY_MS = 1100

// Wikipedia / MusicBrainz 는 식별 가능한 User-Agent 를 요구한다.
const USER_AGENT = 'todayartistlife/1.0 ( gwakjoonsung@gmail.com )'

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
const OLLAMA_MODEL =
  (process.env.OLLAMA_GENERATE_MODEL || process.env.OLLAMA_MODEL || 'gemma3:27b').trim()
const OLLAMA_TIMEOUT_MS = 5 * 60 * 1000 // 로컬 LLM 은 수 분이 걸릴 수 있다.

const LASTFM_API_KEY = process.env.LASTFM_API_KEY

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// CLI 인자
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { limit: null, offset: 0, only: null, missingOnly: false }
  for (const arg of argv) {
    if (arg.startsWith('--limit=')) opts.limit = Number(arg.slice('--limit='.length))
    else if (arg.startsWith('--offset=')) opts.offset = Number(arg.slice('--offset='.length))
    else if (arg.startsWith('--only=')) opts.only = arg.slice('--only='.length)
    else if (arg === '--missing-only') opts.missingOnly = true
  }
  return opts
}

// ---------------------------------------------------------------------------
// 입력 로딩
// ---------------------------------------------------------------------------
function readArtists(filePath) {
  const parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
  if (!Array.isArray(parsed)) throw new Error('Expected an array of artist entities')
  return parsed
}

// ---------------------------------------------------------------------------
// 공용 fetch 유틸
// ---------------------------------------------------------------------------
async function fetchJson(url, { headers = {}, timeoutMs = 15000 } = {}) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (response.status === 404) return { status: 404, data: null }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`)
  }
  return { status: response.status, data: await response.json() }
}

function wikipediaTitle(name) {
  return encodeURIComponent(name.replace(/ /g, '_'))
}

function stripHtml(html) {
  if (!html) return ''
  return html
    .replace(/<a\b[^>]*>.*?<\/a>/gis, '') // "Read more on Last.fm" 링크 제거
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// 1) 이미지 + 바이오 소스: Wikipedia summary
// ---------------------------------------------------------------------------
async function fetchWikipediaSummary(name) {
  const url = `${WIKIPEDIA_SUMMARY_URL}/${wikipediaTitle(name)}`
  const { status, data } = await fetchJson(url)
  if (status === 404 || !data) return null
  return {
    thumbnail:
      typeof data?.thumbnail?.source === 'string' && data.thumbnail.source.length > 0
        ? data.thumbnail.source
        : null,
    extract: typeof data?.extract === 'string' ? data.extract.trim() : '',
  }
}

// ---------------------------------------------------------------------------
// 2) Last.fm: getinfo(tags, image, bio) + getSimilar
// ---------------------------------------------------------------------------
const DECADE_TAG = /^(((19|20)\d0s)|([0-9]0s))$/i
const YEAR_TAG = /^(19|20)\d{2}$/
const TAG_NOISE = new Set([
  'seen live', 'favorites', 'favourites', 'favorite', 'favourite', 'awesome',
  'best', 'love', 'beautiful', 'spotify', 'i love', 'good', 'my music', 'usa',
  'american', 'british', 'english', 'korean', 'under 2000 listeners',
])

function isPeriodTag(tag) {
  return DECADE_TAG.test(tag) || YEAR_TAG.test(tag)
}

function lastfmUrl(method, params) {
  const qs = new URLSearchParams({
    method,
    api_key: LASTFM_API_KEY,
    format: 'json',
    ...params,
  })
  return `${LASTFM_API_URL}?${qs.toString()}`
}

function tagNames(tagBlock) {
  const tags = tagBlock?.tag
  if (!tags) return []
  const arr = Array.isArray(tags) ? tags : [tags]
  return arr.map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean)
}

async function fetchLastfmInfo(name) {
  if (!LASTFM_API_KEY) return null
  const { data } = await fetchJson(lastfmUrl('artist.getinfo', { artist: name, autocorrect: '1' }))
  const artist = data?.artist
  if (!artist) return null

  const allTags = tagNames(artist.tags).map((t) => t.toLowerCase())
  const periods = Array.from(new Set(allTags.filter(isPeriodTag)))
  const genres = Array.from(
    new Set(allTags.filter((t) => !isPeriodTag(t) && !TAG_NOISE.has(t)))
  ).slice(0, 10)

  // Last.fm artist 이미지는 종종 빈 placeholder 라서 megastar/extralarge 우선.
  const images = Array.isArray(artist.image) ? artist.image : []
  const sizePriority = ['mega', 'extralarge', 'large', 'medium']
  let imageUrl = null
  for (const size of sizePriority) {
    const found = images.find((img) => img.size === size && img['#text'])
    if (found) {
      imageUrl = found['#text']
      break
    }
  }

  return {
    genres,
    periods,
    tagSet: new Set(allTags),
    bio: stripHtml(artist.bio?.content || artist.bio?.summary || ''),
    imageUrl,
  }
}

async function fetchLastfmTopTags(name) {
  if (!LASTFM_API_KEY) return []
  try {
    const { data } = await fetchJson(
      lastfmUrl('artist.gettoptags', { artist: name, autocorrect: '1' })
    )
    return tagNames(data?.toptags).map((t) => t.toLowerCase())
  } catch {
    return []
  }
}

async function fetchRelatedArtists(name, mainTagSet) {
  if (!LASTFM_API_KEY) return []
  const { data } = await fetchJson(
    lastfmUrl('artist.getsimilar', { artist: name, autocorrect: '1', limit: '6' })
  )
  const similar = data?.similarartists?.artist
  const list = Array.isArray(similar) ? similar : similar ? [similar] : []

  const related = []
  for (const item of list.slice(0, 6)) {
    const simName = item?.name
    if (!simName) continue
    await sleep(DEFAULT_DELAY_MS)
    const simTags = await fetchLastfmTopTags(simName)
    const common = simTags
      .filter((t) => mainTagSet.has(t))
      .filter((t) => !TAG_NOISE.has(t))
      .slice(0, 5)
    related.push({ name: simName, common_tags: common })
  }
  return related
}

// ---------------------------------------------------------------------------
// 3) MusicBrainz: 외부 링크 + 수상 이력
// ---------------------------------------------------------------------------
async function fetchMusicbrainz(name) {
  // 아티스트 검색 → 최고 점수 매치의 mbid
  const searchUrl = `${MUSICBRAINZ_URL}/artist?query=${encodeURIComponent(
    `artist:"${name}"`
  )}&fmt=json&limit=1`
  const { data: searchData } = await fetchJson(searchUrl)
  const match = searchData?.artists?.[0]
  if (!match?.id) return { external_links: null, awards: null }

  await sleep(MUSICBRAINZ_DELAY_MS)

  // url-rels + annotation 으로 링크/수상 정보 수집
  const detailUrl = `${MUSICBRAINZ_URL}/artist/${match.id}?inc=url-rels+annotation&fmt=json`
  const { data: detail } = await fetchJson(detailUrl)
  const relations = Array.isArray(detail?.relations) ? detail.relations : []

  const links = {}
  for (const rel of relations) {
    const resource = rel?.url?.resource
    if (!resource) continue
    const host = (() => {
      try {
        return new URL(resource).hostname.replace(/^www\./, '').toLowerCase()
      } catch {
        return ''
      }
    })()

    if (host.includes('open.spotify.com')) links.spotify ??= resource
    else if (host.includes('music.apple.com')) links.apple_music ??= resource
    else if (host.includes('instagram.com')) links.instagram ??= resource
    else if (host.includes('twitter.com') || host === 'x.com') links.twitter ??= resource
    else if (host.includes('facebook.com')) links.facebook ??= resource
    else if (host.includes('tiktok.com')) links.tiktok ??= resource
    else if (host.includes('youtube.com')) links.youtube ??= resource
    else if (host.includes('soundcloud.com')) links.soundcloud ??= resource
    else if (rel.type === 'official homepage') links.homepage ??= resource
  }

  // MusicBrainz 는 별도 수상(award) 엔드포인트가 없다.
  // annotation 텍스트에 award/grammy 등이 언급된 경우만 best-effort 로 저장한다.
  let awards = null
  const annotation = typeof detail?.annotation === 'string' ? detail.annotation : ''
  if (annotation) {
    const awardLines = annotation
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /\b(award|grammy|brit|emmy|prize|winner)\b/i.test(l))
    if (awardLines.length > 0) awards = awardLines.slice(0, 20)
  }

  return {
    external_links: Object.keys(links).length > 0 ? links : null,
    awards,
  }
}

// ---------------------------------------------------------------------------
// 4) Ollama 로 한국어 바이오 재구성
// ---------------------------------------------------------------------------
async function reconstructBioWithOllama({ name, koreanName, wikiExtract, lastfmBio }) {
  const sources = [wikiExtract, lastfmBio].filter((s) => s && s.length > 0)
  if (sources.length === 0) return { bio: null, source: null, usedOllama: false }

  const combined = sources.join('\n\n')
  const display = koreanName || name

  // Ollama 실패 시 사용할 fallback: Wikipedia summary(또는 가용 텍스트) 원문.
  const fallbackText = wikiExtract || lastfmBio || null
  const fallbackSourceLabel = wikiExtract ? 'wikipedia' : 'lastfm'

  const prompt = [
    `다음은 음악 아티스트 "${display}"(${name})에 대한 영어 소개 텍스트입니다.`,
    `이 내용을 바탕으로 한국어로 자연스럽고 간결한 소개글을 작성하세요.`,
    `규칙:`,
    `- 2~4문장, 한국어로만 작성`,
    `- 사실에 근거하며 새로운 정보를 지어내지 말 것`,
    `- 마크다운/머리말 없이 본문만 출력`,
    ``,
    `[원문]`,
    combined,
  ].join('\n')

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.4 },
      }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}`)
    }

    const data = await response.json()
    const text = (data?.response || '').trim()
    if (!text) throw new Error('Ollama returned empty response')

    const usedSources = []
    if (wikiExtract) usedSources.push('wikipedia')
    if (lastfmBio) usedSources.push('lastfm')
    return {
      bio: text,
      source: `${usedSources.join('+')} via ollama:${OLLAMA_MODEL}`,
      usedOllama: true,
    }
  } catch (error) {
    // Ollama 호출 실패 → Wikipedia summary(또는 가용 텍스트)를 그대로 저장.
    console.warn(`    ↳ Ollama 실패(${error.message}), 원문 fallback 사용`)
    if (!fallbackText) return { bio: null, source: null, usedOllama: false }
    return {
      bio: fallbackText,
      source: `${fallbackSourceLabel} (fallback)`,
      usedOllama: false,
    }
  }
}

// ---------------------------------------------------------------------------
// Supabase upsert
// ---------------------------------------------------------------------------
async function upsertEnrichment(artist, fields) {
  const payload = {
    name: artist.name,
    korean_name: artist.korean_name ?? null,
    type: artist.type,
    last_enriched_at: new Date().toISOString(),
    ...fields,
  }
  const { error } = await supabase
    .from('entities')
    .upsert(payload, { onConflict: 'name,type' })
  if (error) throw new Error(`Supabase upsert failed: ${error.message}`)
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const artistsPath = resolve(process.cwd(), 'lib/entities/artists.json')
  let artists = readArtists(artistsPath).filter((a) => a?.name && a?.type)

  if (opts.only) {
    artists = artists.filter((a) => a.name === opts.only)
  }
  if (opts.missingOnly) {
    const { data: enriched } = await supabase
      .from('entities')
      .select('name')
      .eq('type', 'artist')
      .not('last_enriched_at', 'is', null)
    const done = new Set((enriched ?? []).map((e) => e.name))
    artists = artists.filter((a) => !done.has(a.name))
  }
  if (opts.offset) artists = artists.slice(opts.offset)
  if (opts.limit != null) artists = artists.slice(0, opts.limit)

  console.log(`Enriching ${artists.length} artists.`)
  console.log(`  Last.fm:   ${LASTFM_API_KEY ? 'enabled' : 'DISABLED (LASTFM_API_KEY 없음)'}`)
  console.log(`  Ollama:    ${OLLAMA_MODEL} @ ${OLLAMA_BASE_URL}`)
  console.log('')

  const failures = []
  let processed = 0

  for (const [index, artist] of artists.entries()) {
    const label = `[${index + 1}/${artists.length}] ${artist.name}`
    const fields = {}
    const collected = []
    const partialErrors = []

    // --- Wikipedia summary (이미지 + 바이오 소스) ---
    let wiki = null
    try {
      wiki = await fetchWikipediaSummary(artist.name)
      if (wiki?.thumbnail) {
        fields.profile_image_url = wiki.thumbnail
        collected.push('image(wiki)')
      }
    } catch (error) {
      partialErrors.push(`wikipedia: ${error.message}`)
    }
    await sleep(DEFAULT_DELAY_MS)

    // --- Last.fm getinfo (genres / active_period / image fallback / bio 소스) ---
    let lastfm = null
    if (LASTFM_API_KEY) {
      try {
        lastfm = await fetchLastfmInfo(artist.name)
        if (lastfm) {
          if (lastfm.genres.length > 0) {
            fields.genres = lastfm.genres
            collected.push(`genres(${lastfm.genres.length})`)
          }
          if (lastfm.periods.length > 0) {
            fields.active_period = lastfm.periods
            collected.push(`period(${lastfm.periods.length})`)
          }
          if (!fields.profile_image_url && lastfm.imageUrl) {
            fields.profile_image_url = lastfm.imageUrl
            collected.push('image(lastfm)')
          }
        }
      } catch (error) {
        partialErrors.push(`lastfm.getinfo: ${error.message}`)
      }
      await sleep(DEFAULT_DELAY_MS)

      // --- Last.fm getSimilar → related_artists ---
      try {
        const related = await fetchRelatedArtists(
          artist.name,
          lastfm?.tagSet ?? new Set()
        )
        if (related.length > 0) {
          fields.related_artists = related
          collected.push(`related(${related.length})`)
        }
      } catch (error) {
        partialErrors.push(`lastfm.getsimilar: ${error.message}`)
      }
      await sleep(DEFAULT_DELAY_MS)
    }

    // --- MusicBrainz: external_links + awards ---
    try {
      const mb = await fetchMusicbrainz(artist.name)
      if (mb.external_links) {
        fields.external_links = mb.external_links
        collected.push(`links(${Object.keys(mb.external_links).length})`)
      }
      if (mb.awards) {
        fields.awards = mb.awards
        collected.push(`awards(${mb.awards.length})`)
      }
    } catch (error) {
      partialErrors.push(`musicbrainz: ${error.message}`)
    }
    await sleep(MUSICBRAINZ_DELAY_MS)

    // --- Bio: Wikipedia + Last.fm → Ollama 한국어 재구성 ---
    try {
      const { bio, source } = await reconstructBioWithOllama({
        name: artist.name,
        koreanName: artist.korean_name,
        wikiExtract: wiki?.extract || '',
        lastfmBio: lastfm?.bio || '',
      })
      if (bio) {
        fields.bio = bio
        fields.bio_source = source
        collected.push('bio')
      }
    } catch (error) {
      partialErrors.push(`bio: ${error.message}`)
    }

    // --- upsert ---
    try {
      await upsertEnrichment(artist, fields)
      processed += 1
      const summary = collected.length > 0 ? collected.join(', ') : '수집된 데이터 없음'
      console.log(`✓ ${label}: ${summary}`)
      if (partialErrors.length > 0) {
        console.log(`    ⚠ ${partialErrors.join(' | ')}`)
        failures.push({ name: artist.name, type: 'partial', errors: partialErrors })
      }
    } catch (error) {
      console.error(`✗ ${label}: upsert 실패 — ${error.message}`)
      failures.push({
        name: artist.name,
        type: 'fatal',
        errors: [error.message, ...partialErrors],
      })
    }

    if (index < artists.length - 1) await sleep(DEFAULT_DELAY_MS)
  }

  // --- 실패 로그 기록 ---
  const failPath = resolve(process.cwd(), 'logs/enrich-failed.json')
  mkdirSync(dirname(failPath), { recursive: true })
  writeFileSync(
    failPath,
    JSON.stringify(
      { generated_at: new Date().toISOString(), count: failures.length, failures },
      null,
      2
    ),
    'utf-8'
  )

  console.log('')
  console.log(`Done. processed=${processed}/${artists.length}, issues=${failures.length}`)
  console.log(`실패/부분실패 로그: ${failPath}`)
}

main().catch((error) => {
  console.error('Enrichment failed:', error)
  process.exit(1)
})
