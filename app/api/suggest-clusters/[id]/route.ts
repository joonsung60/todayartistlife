import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const ALLOWED_STATUSES = new Set(['pending', 'approved', 'rejected', 'published'])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!id) {
    return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const updates: Record<string, string | null> = {}

    if (typeof body.status === 'string') {
      if (!ALLOWED_STATUSES.has(body.status)) {
        return NextResponse.json(
          { error: `유효하지 않은 status: ${body.status}` },
          { status: 400 }
        )
      }
      updates.status = body.status
    }

    if (body.clusterId === null || typeof body.clusterId === 'string') {
      updates.cluster_id = body.clusterId
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: '업데이트할 필드가 없습니다.' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('suggested_clusters')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: '제안을 찾을 수 없습니다.' }, { status: 404 })
    }

    return NextResponse.json({ suggestion: data })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
