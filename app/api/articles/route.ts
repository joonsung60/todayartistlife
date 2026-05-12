import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const MAX_LIMIT = 100

export async function GET(req: NextRequest) {
  const published = req.nextUrl.searchParams.get('published')
  const limitParam = Number(req.nextUrl.searchParams.get('limit') ?? 50)
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(Math.trunc(limitParam), 1), MAX_LIMIT)
    : 50

  let query = supabase
    .from('articles')
    .select('id, title, content, published, published_at, created_at, updated_at, cluster_id, slug, category, genre')
    .limit(limit)

  if (published === 'true' || published === 'false') {
    query = query.eq('published', published === 'true')
  }

  query =
    published === 'true'
      ? query.order('published_at', { ascending: false, nullsFirst: false })
      : query.order('created_at', { ascending: false })

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ articles: data ?? [] })
}
