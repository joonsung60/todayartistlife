import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

// load .env.local manually
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

type EntityRecord = {
  name: string
  korean_name: string
  type: string
  aliases?: string[]
}

async function main() {
  try {
    const artistsPath = resolve(process.cwd(), 'lib/entities/artists.json')

    const artists = JSON.parse(readFileSync(artistsPath, 'utf-8')) as EntityRecord[]

    const allEntities = artists.map((entity) => ({
      ...entity,
      aliases: entity.aliases ?? [],
    }))

    console.log(`Syncing ${allEntities.length} entities to Supabase...`)

    const { error } = await supabase
      .from('entities')
      .upsert(allEntities, { onConflict: 'name,type' })

    if (error) {
      throw error
    }

    console.log('Successfully synced entities.')
  } catch (err) {
    console.error('Failed to sync entities:', err)
    process.exit(1)
  }
}

void main()
