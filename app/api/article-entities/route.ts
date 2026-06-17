import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const articleId = req.nextUrl.searchParams.get('article_id')
  if (!articleId) return NextResponse.json({ error: 'article_id 필요' }, { status: 400 })

  const { data, error } = await supabase
    .from('article_entities')
    .select('entity_id, entities(name, korean_name)')
    .eq('article_id', articleId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const entities = (data ?? []).map((row: any) => ({
    entity_id: row.entity_id,
    name: row.entities?.name ?? '',
    korean_name: row.entities?.korean_name ?? '',
  }))

  return NextResponse.json({ entities })
}
