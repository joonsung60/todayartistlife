import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local', quiet: true })

const DATALAB_URL = 'https://openapi.naver.com/v1/datalab/search'
const MAX_KEYWORD_GROUPS = 5
const REFERENCE_ENTITY_NAME = 'Taylor Swift'
const REQUEST_DELAY_MS = 300
const TIME_UNIT = 'week'
const COMPARISON_BATCH_SIZE = MAX_KEYWORD_GROUPS - 1

const requiredEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NAVER_DATALAB_CLIENT_ID: process.env.NAVER_DATALAB_CLIENT_ID,
  NAVER_DATALAB_CLIENT_SECRET: process.env.NAVER_DATALAB_CLIENT_SECRET,
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
  requiredEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

function formatDate(date) {
  return date.toISOString().slice(0, 10)
}

function getDateRange() {
  const endDate = new Date()
  const startDate = new Date(endDate)
  startDate.setMonth(startDate.getMonth() - 3)

  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
  }
}

function readEntities(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch (error) {
    throw new Error(`Failed to load entity JSON at ${filePath}: ${error.message}`)
  }
}

function normalizeEntity(entity) {
  if (!entity?.name || !entity?.type) {
    throw new Error(`Invalid entity record: ${JSON.stringify(entity)}`)
  }

  return {
    name: entity.name,
    korean_name: entity.korean_name ?? null,
    type: entity.type,
    aliases: entity.aliases ?? [],
    query: entity.korean_name || entity.name,
    is_korean: entity.is_korean === true,
  }
}

function entityKey(entity) {
  return `${entity.name}:${entity.type}`
}

function uniqueByNameAndType(entities) {
  return Array.from(
    new Map(entities.map((entity) => [entityKey(entity), entity])).values()
  )
}

function chunk(array, size) {
  const chunks = []
  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size))
  }
  return chunks
}

function averageRatio(points) {
  if (!points || points.length === 0) return 0

  const total = points.reduce((sum, point) => sum + Number(point.ratio ?? 0), 0)
  return Number((total / points.length).toFixed(2))
}

function normalizeAgainstReference(weight, referenceWeight) {
  return Number(((weight / referenceWeight) * 100).toFixed(2))
}

function isMissingWeightColumnError(error) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''} ${error?.details ?? ''}`
  return (
    text.includes('PGRST204') ||
    text.includes('42703') ||
    (/weight/i.test(text) && /column|schema cache|does not exist|not find/i.test(text))
  )
}

async function assertWeightColumnExists() {
  const { error } = await supabase.from('entities').select('weight').limit(1)

  if (!error) return

  if (isMissingWeightColumnError(error)) {
    console.error('Supabase entities.weight column does not exist. Add the weight column before running this script.')
    process.exit(1)
  }

  throw error
}

async function fetchDatalabWeights(referenceEntity, batch, dateRange) {
  const keywordGroups = [referenceEntity, ...batch]
  const body = {
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    timeUnit: TIME_UNIT,
    keywordGroups: keywordGroups.map((entity) => ({
      groupName: entity.name,
      keywords: [entity.query],
    })),
  }

  const response = await fetch(DATALAB_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Naver-Client-Id': requiredEnv.NAVER_DATALAB_CLIENT_ID,
      'X-Naver-Client-Secret': requiredEnv.NAVER_DATALAB_CLIENT_SECRET,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Naver DataLab API failed [${response.status}]: ${text}`)
  }

  const data = await response.json()
  const referenceWeight = averageRatio(data.results?.[0]?.data)

  if (referenceWeight <= 0) {
    throw new Error(`Reference entity "${referenceEntity.name}" returned zero DataLab weight.`)
  }

  return batch.map((entity, index) => ({
    ...entity,
    weight: normalizeAgainstReference(
      averageRatio(data.results?.[index + 1]?.data),
      referenceWeight
    ),
  }))
}

async function updateSupabaseWeights(entities) {
  const rows = entities.map((entity) => ({
    name: entity.name,
    korean_name: entity.korean_name,
    type: entity.type,
    aliases: entity.aliases,
    weight: entity.weight,
  }))

  const { error } = await supabase
    .from('entities')
    .upsert(rows, { onConflict: 'name,type' })

  if (error) {
    if (isMissingWeightColumnError(error)) {
      console.error('Supabase entities.weight column does not exist. Add the weight column before running this script.')
      process.exit(1)
    }

    throw error
  }
}

async function main() {
  const artistsPath = resolve(process.cwd(), 'lib/entities/artists.json')
  const dateRange = getDateRange()

  const entities = uniqueByNameAndType(
    readEntities(artistsPath).map(normalizeEntity)
  )
  const referenceEntity = entities.find((entity) => entity.name === REFERENCE_ENTITY_NAME)

  if (!referenceEntity) {
    throw new Error(`Reference entity "${REFERENCE_ENTITY_NAME}" was not found in entity JSON files.`)
  }

  const comparisonEntities = entities.filter((entity) => entityKey(entity) !== entityKey(referenceEntity))

  await assertWeightColumnExists()

  console.log(`Updating weights for ${entities.length} entities.`)
  console.log(`Reference entity: ${referenceEntity.name} (query: ${referenceEntity.query})`)
  console.log(`DataLab range: ${dateRange.startDate} ~ ${dateRange.endDate} (${TIME_UNIT})`)

  const weightedEntities = [{ ...referenceEntity, weight: 100 }]
  const batches = chunk(comparisonEntities, COMPARISON_BATCH_SIZE)

  for (const [index, batch] of batches.entries()) {
    const weightedBatch = await fetchDatalabWeights(referenceEntity, batch, dateRange)
    weightedEntities.push(...weightedBatch)
    console.log(`Fetched batch ${index + 1}/${batches.length}`)

    if (index < batches.length - 1) {
      await sleep(REQUEST_DELAY_MS)
    }
  }

  weightedEntities.sort((a, b) => b.weight - a.weight)

  const nonKoreanEntities = weightedEntities.filter(e => !e.is_korean)
  const top10NonKorean = nonKoreanEntities.slice(0, 10)
  const minNonKoreanWeight = top10NonKorean.length > 0
    ? top10NonKorean[Math.min(9, top10NonKorean.length - 1)].weight
    : 0

  const cappedLog = []
  if (minNonKoreanWeight > 0) {
    const capThreshold = Number(Math.max(0, minNonKoreanWeight - 0.01).toFixed(2))
    for (const entity of weightedEntities) {
      if (entity.is_korean && entity.weight >= capThreshold) {
        cappedLog.push(`${entity.name}: ${entity.weight} -> ${capThreshold}`)
        entity.weight = capThreshold
      }
    }
  }

  weightedEntities.sort((a, b) => b.weight - a.weight)

  if (cappedLog.length > 0) {
    console.log('\n[Weight Caps Applied]')
    console.log('Capped the following Korean artists to keep top 10 non-Korean:')
    cappedLog.forEach(log => console.log(` - ${log}`))
    console.log('')
  }

  await updateSupabaseWeights(weightedEntities)

  const topEntities = weightedEntities.slice(0, 10)

  console.log(`Updated ${weightedEntities.length} entity weights in Supabase.`)
  console.log('Top 10 by weight:')
  for (const [index, entity] of topEntities.entries()) {
    console.log(`${String(index + 1).padStart(2, ' ')}. ${entity.name} (${entity.type}) - ${entity.weight}`)
  }
}

main().catch((error) => {
  console.error('Failed to update entity weights:', error)
  process.exit(1)
})
