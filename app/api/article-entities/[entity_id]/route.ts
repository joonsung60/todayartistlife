import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ entity_id: string }> }) {
  const { entity_id } = await params
  const articleId = req.nextUrl.searchParams.get('article_id')
  if (!articleId) return NextResponse.json({ error: 'article_id 필요' }, { status: 400 })

  const { error } = await supabase
    .from('article_entities')
    .delete()
    .eq('article_id', articleId)
    .eq('entity_id', entity_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
