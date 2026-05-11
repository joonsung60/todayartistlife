import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!id) {
    return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
  }

  const publishedAt = new Date().toISOString()
  const { data, error } = await supabase
    .from('articles')
    .update({
      published: true,
      published_at: publishedAt,
    })
    .eq('id', id)
    .select('id, title, content, published, published_at, created_at, cluster_id')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: '기사를 찾을 수 없습니다.' }, { status: 404 })
  }

  return NextResponse.json({ article: data })
}
