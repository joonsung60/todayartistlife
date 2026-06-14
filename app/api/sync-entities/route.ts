import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

type EntityRecord = {
  name: string
  korean_name: string
  type: string
  aliases?: string[]
}

function createSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  }

  return createClient(supabaseUrl, supabaseKey)
}

function loadArtists(): EntityRecord[] {
  const artistsPath = resolve(process.cwd(), 'lib/entities/artists.json')
  return JSON.parse(readFileSync(artistsPath, 'utf-8')) as EntityRecord[]
}

export async function POST() {
  try {
    const supabase = createSupabaseClient()
    const artists = loadArtists().map((entity) => ({
      ...entity,
      aliases: entity.aliases ?? [],
    }))

    const { error } = await supabase
      .from('entities')
      .upsert(artists, { onConflict: 'name,type' })

    if (error) {
      throw error
    }

    return NextResponse.json({ synced: artists.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
