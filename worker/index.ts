// 이 import는 반드시 최상단에 있어야 한다. lib/jobs/*가 lib/supabase.ts를 거쳐
// process.env를 읽기 때문에 dotenv가 그 전에 로드돼야 한다.
import './bootstrap'

import { setDefaultResultOrder } from 'node:dns'
import { createClient } from '@supabase/supabase-js'
import { generateFromCluster } from '../lib/jobs/generate-from-cluster'
import { generateFromSuggestion } from '../lib/jobs/generate-from-suggestion'
import { sendTelegramMessage } from '../lib/telegram'

// WSL2에서 api.telegram.org가 IPv6로 풀려 SYN이 막히는 케이스가 있어 IPv4 우선.
setDefaultResultOrder('ipv4first')

const POLL_INTERVAL_MS = 3000

const supabaseUrl =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'SUPABASE_URL / SUPABASE_ANON_KEY 환경변수가 없습니다.'
  )
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

type JobRow = {
  id: string
  job_type: string
  payload: Record<string, unknown> | null
  status: string
}

async function claimNextJob(): Promise<JobRow | null> {
  const { data, error } = await supabase.rpc('claim_pending_job')
  if (error) {
    console.error('[worker] claim 실패:', error.message)
    console.error(error)
    return null
  }
  const job = data as JobRow | null
  if (job && job.id) {
    return job
  }
  return null
}

async function runJob(job: JobRow): Promise<unknown> {
  const payload = job.payload ?? {}
  switch (job.job_type) {
    case 'generate_from_cluster': {
      const clusterIds = Array.isArray((payload as { clusterIds?: unknown }).clusterIds)
        ? ((payload as { clusterIds: unknown[] }).clusterIds.filter(
            (id): id is string => typeof id === 'string'
          ))
        : []
      return await generateFromCluster(clusterIds)
    }
    case 'generate_from_suggestion': {
      const suggestionId = (payload as { suggestionId?: unknown }).suggestionId
      if (typeof suggestionId !== 'string' || !suggestionId) {
        throw new Error('suggestionId가 payload에 없습니다.')
      }
      return await generateFromSuggestion(suggestionId)
    }
    default:
      throw new Error(`알 수 없는 job_type: ${job.job_type}`)
  }
}

async function markDone(jobId: string, result: unknown): Promise<void> {
  const { error } = await supabase
    .from('job_queue')
    .update({
      status: 'done',
      result: result as never,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
  if (error) {
    console.error('[worker] done 업데이트 실패:', error.message)
  }
}

async function markFailed(jobId: string, errorMessage: string): Promise<void> {
  const { error } = await supabase
    .from('job_queue')
    .update({
      status: 'failed',
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
  if (error) {
    console.error('[worker] failed 업데이트 실패:', error.message)
  }
}

function extractArticleTitle(result: unknown): string | null {
  if (Array.isArray(result)) {
    for (const item of result) {
      if (item && typeof item === 'object') {
        const r = item as Record<string, unknown>
        if (r.success === true && r.article && typeof r.article === 'object') {
          const title = (r.article as Record<string, unknown>).title
          if (typeof title === 'string') return title
        }
      }
    }
    return null
  }
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>
    const article = r.article as Record<string, unknown> | undefined
    if (article && typeof article.title === 'string') return article.title
  }
  return null
}

async function processOne(): Promise<void> {
  const job = await claimNextJob()
  if (!job) return

  console.log('[worker] 잡 claim됨:', {
    id: job.id,
    job_type: job.job_type,
    payload: job.payload,
  })

  try {
    console.log(`[worker] 처리 함수 호출 시작: ${job.job_type} (${job.id})`)
    const result = await runJob(job)
    await markDone(job.id, result)
    console.log(`[worker] 처리 완료: ${job.job_type} (${job.id})`)

    const title = extractArticleTitle(result)
    if (title) {
      await sendTelegramMessage(`✅ 기사 생성 완료: ${title}`)
    } else {
      await sendTelegramMessage(`✅ ${job.job_type} 완료`)
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[worker] 처리 실패: ${job.job_type} (${job.id}): ${errorMessage}`)
    console.error(err)
    await markFailed(job.id, errorMessage)

    await sendTelegramMessage(`❌ ${job.job_type} 실패\n${errorMessage}`)
  }
}

function startWorker(): void {
  console.log(`Worker started (poll ${POLL_INTERVAL_MS}ms)`)
  let processing = false
  setInterval(async () => {
    if (processing) return
    processing = true
    try {
      await processOne()
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e)
      console.error(`[worker] 루프 오류: ${errorMessage}`)
      console.error(e)
    } finally {
      processing = false
    }
  }, POLL_INTERVAL_MS)
}

startWorker()
