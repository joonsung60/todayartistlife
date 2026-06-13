import fs from 'node:fs/promises'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

type Entity = {
  name: string
  korean_name: string
  type: string
  aliases?: string[]
}

type SuggestedClusterRow = {
  id: string
  keywords: string[] | null
}

const ENTITY_FILES = [
  'lib/entities/artists.json',
]

function normalizeKey(value: string): string {
  return value.trim().toLowerCase()
}

function entityMatchesKeyword(entity: Entity, keyword: string): boolean {
  const normalizedKeyword = normalizeKey(keyword)
  const terms = [entity.name, entity.korean_name, ...(entity.aliases ?? [])]
  return terms.some((term) => normalizeKey(term) === normalizedKeyword)
}

async function removeEntityFromJson(keyword: string) {
  const removed: { file: string; name: string }[] = []

  for (const relativeFile of ENTITY_FILES) {
    const filePath = path.join(process.cwd(), relativeFile)
    const raw = await fs.readFile(filePath, 'utf-8')
    const entities = JSON.parse(raw) as Entity[]
    const kept = entities.filter((entity) => {
      const shouldRemove = entityMatchesKeyword(entity, keyword)
      if (shouldRemove) {
        removed.push({ file: relativeFile, name: entity.name })
      }
      return !shouldRemove
    })

    if (kept.length !== entities.length) {
      await fs.writeFile(filePath, `${JSON.stringify(kept, null, 2)}\n`)
    }
  }

  return removed
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const keyword = typeof body.keyword === 'string' ? body.keyword.trim() : ''

  if (!id) {
    return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
  }

  if (!keyword) {
    return NextResponse.json({ error: '제거할 키워드가 필요합니다.' }, { status: 400 })
  }

  const { data: suggestion, error: fetchError } = await supabase
    .from('suggested_clusters')
    .select('id, keywords')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!suggestion) {
    return NextResponse.json({ error: '제안을 찾을 수 없습니다.' }, { status: 404 })
  }

  const currentKeywords = Array.isArray((suggestion as SuggestedClusterRow).keywords)
    ? (suggestion as SuggestedClusterRow).keywords ?? []
    : []
  const normalizedKeyword = normalizeKey(keyword)
  const nextKeywords = currentKeywords.filter((item) => normalizeKey(item) !== normalizedKeyword)

  const { data: updated, error: updateError } = await supabase
    .from('suggested_clusters')
    .update({ keywords: nextKeywords })
    .eq('id', id)
    .select()
    .single()

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  const removedEntities = await removeEntityFromJson(keyword)

  return NextResponse.json({
    suggestion: updated,
    keywords: nextKeywords,
    removedEntities,
  })
}
