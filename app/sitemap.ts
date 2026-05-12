import { MetadataRoute } from 'next'
import { createClient } from '@/utils/supabase/server'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = createClient()
  const { data: articles } = await supabase
    .from('articles')
    .select('id, updated_at')

  const articleUrls = articles?.map((a) => ({
    url: `https://edmstarnews.com/articles/${a.id}`,
    lastModified: a.updated_at,
    changeFrequency: 'daily' as const,
    priority: 0.8,
  })) ?? []

  return [
    {
      url: 'https://edmstarnews.com',
      changeFrequency: 'hourly',
      priority: 1,
    },
    ...articleUrls,
  ]
}