import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST() {
  try {
    const { data: pendingSuggestions, error: fetchError } = await supabase
      .from('suggested_clusters')
      .select('id, article_ids')
      .eq('status', 'pending')

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    if (!pendingSuggestions || pendingSuggestions.length === 0) {
      return NextResponse.json({ message: 'No pending suggestions to reject', count: 0 })
    }

    const suggestionIds = pendingSuggestions.map((s) => s.id)
    const allArticleIds = new Set<string>()
    for (const s of pendingSuggestions) {
      if (Array.isArray(s.article_ids)) {
        s.article_ids.forEach((id) => allArticleIds.add(id))
      }
    }

    const articleIdsArray = Array.from(allArticleIds)

    const { error: updateError } = await supabase
      .from('suggested_clusters')
      .update({ status: 'rejected' })
      .in('id', suggestionIds)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    if (articleIdsArray.length > 0) {
      const { error: rawUpdateError } = await supabase
        .from('raw_articles')
        .update({
          suggestion_state: 'new',
          suggestion_rejected_at: new Date().toISOString(),
        })
        .in('id', articleIdsArray)

      if (rawUpdateError) {
        console.error('[suggest-clusters/reject-all] raw_articles update failed:', rawUpdateError.message)
      }
    }

    return NextResponse.json({ success: true, count: suggestionIds.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
