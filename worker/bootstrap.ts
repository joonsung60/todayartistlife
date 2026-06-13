// 이 파일은 worker/index.ts에서 가장 먼저 import 되어야 한다.
// lib/supabase.ts가 모듈 로드 시점에 process.env를 읽어 createClient를 호출하기 때문에,
// 어떤 lib import보다 먼저 dotenv를 로드해야 한다.
import { config as loadEnv } from 'dotenv'
import path from 'node:path'

loadEnv({ path: path.resolve(__dirname, '../.env.local') })
loadEnv({ path: path.resolve(__dirname, '.env') })
