import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const DATALAB_URL = 'https://openapi.naver.com/v1/datalab/search'
const MAX_KEYWORD_GROUPS = 5
const REFERENCE_ENTITY_NAME = 'Taylor Swift'
const REQUEST_DELAY_MS = 300
const TIME_UNIT = 'week'
const COMPARISON_BATCH_SIZE = MAX_KEYWORD_GROUPS - 1

type EntityRecord = {
  name: string
  korean_name?: string | null
  type: string
  aliases?: string[]
}

type WeightedEntity = EntityRecord & {
  aliases: string[]
  query: string
  weight: number
}

type DataLabPoint = {
  ratio?: number
}

type DataLabResult = {
  data?: DataLabPoint[]
}

type DataLabResponse = {
  results?: DataLabResult[]
}

function createSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  }

  return createClient(supabaseUrl, supabaseKey)
}

type SupabaseClient = ReturnType<typeof createSupabaseClient>

function getNaverCredentials() {
  const clientId = process.env.NAVER_DATALAB_CLIENT_ID
  const clientSecret = process.env.NAVER_DATALAB_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Missing NAVER_DATALAB_CLIENT_ID or NAVER_DATALAB_CLIENT_SECRET.')
  }

  return { clientId, clientSecret }
}

const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

function formatDate(date: Date) {
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

function readArtists() {
  const artistsPath = resolve(process.cwd(), 'lib/entities/artists.json')
  return JSON.parse(readFileSync(artistsPath, 'utf-8')) as EntityRecord[]
}

function normalizeEntity(entity: EntityRecord): WeightedEntity {
  if (!entity.name || !entity.type) {
    throw new Error(`Invalid entity record: ${JSON.stringify(entity)}`)
  }

  return {
    ...entity,
    korean_name: entity.korean_name ?? null,
    aliases: entity.aliases ?? [],
    query: entity.korean_name || entity.name,
    weight: 0,
  }
}

function entityKey(entity: EntityRecord) {
  return `${entity.name}:${entity.type}`
}

function uniqueByNameAndType(entities: WeightedEntity[]) {
  return Array.from(
    new Map(entities.map((entity) => [entityKey(entity), entity])).values()
  )
}

function chunk<T>(array: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size))
  }
  return chunks
}

function averageRatio(points: DataLabPoint[] | undefined) {
  if (!points || points.length === 0) return 0

  const total = points.reduce((sum, point) => sum + Number(point.ratio ?? 0), 0)
  return Number((total / points.length).toFixed(2))
}

function normalizeAgainstReference(weight: number, referenceWeight: number) {
  return Number(((weight / referenceWeight) * 100).toFixed(2))
}

function isMissingWeightColumnError(error: unknown) {
  const err = error as { code?: string; message?: string; details?: string }
  const text = `${err?.code ?? ''} ${err?.message ?? ''} ${err?.details ?? ''}`
  return (
    text.includes('PGRST204') ||
    text.includes('42703') ||
    (/weight/i.test(text) && /column|schema cache|does not exist|not find/i.test(text))
  )
}

async function assertWeightColumnExists(supabase: SupabaseClient) {
  const { error } = await supabase.from('entities').select('weight').limit(1)

  if (!error) return

  if (isMissingWeightColumnError(error)) {
    throw new Error('Supabase entities.weight column does not exist.')
  }

  throw error
}

async function fetchDatalabWeights(
  referenceEntity: WeightedEntity,
  batch: WeightedEntity[],
  dateRange: { startDate: string; endDate: string },
  credentials: { clientId: string; clientSecret: string }
) {
  const keywordGroups = [referenceEntity, ...batch]
  const response = await fetch(DATALAB_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Naver-Client-Id': credentials.clientId,
      'X-Naver-Client-Secret': credentials.clientSecret,
    },
    body: JSON.stringify({
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      timeUnit: TIME_UNIT,
      keywordGroups: keywordGroups.map((entity) => ({
        groupName: entity.name,
        keywords: [entity.query],
      })),
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Naver DataLab API failed [${response.status}]: ${text}`)
  }

  const data = await response.json() as DataLabResponse
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

async function updateSupabaseWeights(
  supabase: SupabaseClient,
  entities: WeightedEntity[]
) {
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
      throw new Error('Supabase entities.weight column does not exist.')
    }

    throw error
  }
}

export async function POST() {
  try {
    const supabase = createSupabaseClient()
    const credentials = getNaverCredentials()
    const dateRange = getDateRange()
    const entities = uniqueByNameAndType(readArtists().map(normalizeEntity))
    const referenceEntity = entities.find((entity) => entity.name === REFERENCE_ENTITY_NAME)

    if (!referenceEntity) {
      throw new Error(`Reference entity "${REFERENCE_ENTITY_NAME}" was not found in artists.json.`)
    }

    const comparisonEntities = entities.filter((entity) => entityKey(entity) !== entityKey(referenceEntity))
    const weightedEntities: WeightedEntity[] = [{ ...referenceEntity, weight: 100 }]
    const batches = chunk(comparisonEntities, COMPARISON_BATCH_SIZE)

    await assertWeightColumnExists(supabase)

    for (const [index, batch] of batches.entries()) {
      weightedEntities.push(
        ...await fetchDatalabWeights(referenceEntity, batch, dateRange, credentials)
      )

      if (index < batches.length - 1) {
        await sleep(REQUEST_DELAY_MS)
      }
    }

    await updateSupabaseWeights(supabase, weightedEntities)

    const top5 = [...weightedEntities]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 5)
      .map((entity) => ({
        name: entity.name,
        korean_name: entity.korean_name,
        type: entity.type,
        weight: entity.weight,
      }))

    return NextResponse.json({
      updated: weightedEntities.length,
      top5,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
