'use client'

import { useCallback, useEffect, useState } from 'react'
import type { PercentCrop } from 'react-image-crop'
import { ImageCropper, getCroppedDataUrl } from '@/components/ImageCropper'
import { supabase } from '@/lib/supabase'

type RssTab = 'collect' | 'add-urls' | 'suggest' | 'articles' | 'cluster' | 'generate'

const RSS_TABS: { id: RssTab; label: string }[] = [
  { id: 'collect', label: '① RSS 수집' },
  { id: 'add-urls', label: '② URL 직접 추가' },
  { id: 'suggest', label: '③ 자동 토픽 제안' },
  { id: 'articles', label: '④ 생성 기사 검토' },
  { id: 'cluster', label: '⑤ 클러스터 (수동)' },
  { id: 'generate', label: '⑥ 기사 생성 (수동)' },
]

export default function AdminPage() {
  const [activeRssTab, setActiveRssTab] = useState<RssTab>('collect')

  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">투아라 어드민</h1>
        <span className="text-sm font-medium text-gray-500 bg-gray-100 px-3 py-1 rounded">RSS 및 URL 기반 기사 생성</span>
      </div>

      <TabBar
        tabs={RSS_TABS}
        activeId={activeRssTab}
        onChange={(id) => setActiveRssTab(id as RssTab)}
      />

      {activeRssTab === 'collect' && <CollectTab />}
      {activeRssTab === 'add-urls' && <AddUrlsTab />}
      {activeRssTab === 'suggest' && <SuggestTab />}
      {activeRssTab === 'articles' && <ArticlesReviewTab />}
      {activeRssTab === 'cluster' && <ClusterTab />}
      {activeRssTab === 'generate' && <GenerateTab />}
    </div>
  )
}

function TabBar<T extends string>({
  tabs,
  activeId,
  onChange,
}: {
  tabs: { id: T; label: string }[]
  activeId: T
  onChange: (id: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-2 mb-8 border-b">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeId === tab.id
              ? 'border-black text-black'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('이미지를 읽지 못했습니다.'))
      }
    }
    reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'))
    reader.readAsDataURL(file)
  })
}

function CollectTab() {
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<string>('')
  const [failures, setFailures] = useState<{ source: string; url: string; error: string }[]>([])
  const [activeCount, setActiveCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('rss_sources')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .then(({ count, error }) => {
        if (cancelled) return
        if (error || count === null) {
          setActiveCount(-1)
          return
        }
        setActiveCount(count)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleCollect = async () => {
    setIsLoading(true)
    setResult('')
    setFailures([])
    try {
      const res = await fetch('/api/collect', { method: 'POST' })
      const data = await res.json()
      setResult(`수집 완료: ${data.collected}개 기사 저장됨`)
      setFailures(data.failures ?? [])
    } catch {
      setResult('오류가 발생했습니다.')
    }
    setIsLoading(false)
  }

  const countLabel =
    activeCount === null
      ? '… '
      : activeCount < 0
        ? ''
        : `${activeCount}개 `

  return (
    <div>
      <p className="text-gray-600 mb-6">{countLabel}RSS 소스에서 새 기사를 수집합니다.</p>
      <button
        onClick={handleCollect}
        disabled={isLoading}
        className="px-6 py-3 bg-black text-white rounded font-semibold disabled:opacity-50"
      >
        {isLoading ? '수집 중...' : 'RSS 수집 실행'}
      </button>
      {result && <p className="mt-4 text-green-600">{result}</p>}
      {failures.length > 0 && (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-4">
          <p className="font-semibold text-amber-900">실패 RSS 소스 {failures.length}개</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {failures.map((failure) => (
              <li key={`${failure.source}-${failure.url}`}>
                <span className="font-medium">{failure.source}</span>: {failure.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function AddUrlsTab() {
  const [urls, setUrls] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<string>('')

  const handleAdd = async () => {
    const urlList = urls.split('\n').map(u => u.trim()).filter(u => u.length > 0)
    if (urlList.length === 0) return

    setIsLoading(true)
    setResult('')
    try {
      const res = await fetch('/api/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: urlList }),
      })
      const data = await res.json()
      setResult(`${data.collected}개 기사가 DB에 추가됐습니다.`)
      setUrls('')
    } catch {
      setResult('오류가 발생했습니다.')
    }
    setIsLoading(false)
  }

  return (
    <div>
      <p className="text-gray-600 mb-4">URL을 한 줄에 하나씩 붙여넣으세요.</p>
      <textarea
        className="w-full h-48 p-4 border rounded font-mono text-sm mb-4"
        placeholder="https://mixmag.net/article/...&#10;https://ra.co/articles/..."
        value={urls}
        onChange={(e) => setUrls(e.target.value)}
      />
      <button
        onClick={handleAdd}
        disabled={isLoading}
        className="px-6 py-3 bg-black text-white rounded font-semibold disabled:opacity-50"
      >
        {isLoading ? '추가 중...' : 'URL 추가'}
      </button>
      {result && <p className="mt-4 text-green-600">{result}</p>}
    </div>
  )
}

function ClusterTab() {
  const [topic, setTopic] = useState('')
  const [keywords, setKeywords] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<string>('')

  const handleCluster = async () => {
    if (!topic) return
    setIsLoading(true)
    setResult('')
    try {
      const res = await fetch('/api/cluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          keywords: keywords.split(',').map(k => k.trim()).filter(k => k.length > 0),
          matchMode: 'or',
        }),
      })
      const data = await res.json()
      setResult(`클러스터 생성 완료: ${data.clusterId} (${data.matched}개 기사 매칭)`)
      setTopic('')
      setKeywords('')
    } catch {
      setResult('오류가 발생했습니다.')
    }
    setIsLoading(false)
  }

  return (
    <div>
      <p className="text-gray-600 mb-6">토픽과 키워드를 입력하면 관련 기사들을 자동으로 묶습니다.</p>
      <input
        className="w-full p-3 border rounded mb-4"
        placeholder="토픽 (예: Martin Garrix 2026 신곡 발표)"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
      />
      <input
        className="w-full p-3 border rounded mb-4"
        placeholder="키워드 (쉼표로 구분, 예: Martin Garrix, STMPD, new single)"
        value={keywords}
        onChange={(e) => setKeywords(e.target.value)}
      />
      <button
        onClick={handleCluster}
        disabled={isLoading}
        className="px-6 py-3 bg-black text-white rounded font-semibold disabled:opacity-50"
      >
        {isLoading ? '클러스터 생성 중...' : '클러스터 생성'}
      </button>
      {result && <p className="mt-4 text-green-600">{result}</p>}
    </div>
  )
}

type SuggestionStatus = 'pending' | 'approved' | 'rejected' | 'published'
type SubTab = 'pending' | 'published' | 'rejected'

type PersistedSuggestion = {
  id: string
  topic: string
  keywords: string[]
  articleIds: string[]
  reason?: string
  commonEntities?: string[]
  cohesionScore?: number
  matchedEntities?: string[]
  articles: { id: string; title: string; url: string }[]
  status: SuggestionStatus
  clusterId: string | null
  articleId: string | null
  createdAt: string
}

type ProcessingState = { state: 'pending' | 'success' | 'error'; message: string }

type TopicBlockRule = {
  id: string
  pattern: string
  reason: string | null
  enabled: boolean
  created_at: string
}

type AdminArticle = {
  id: string
  slug: string | null
  title: string
  content: string
  published: boolean
  published_at: string | null
  created_at: string
  updated_at: string | null
  cluster_id: string | null
  image_url: string | null
  category: string | null
  genre: string | null
}

type GenerateResult = {
  success: boolean
  article?: {
    id?: string
    title: string
    content: string
  }
  error?: string
}

function SuggestTab() {
  const [subTab, setSubTab] = useState<SubTab>('pending')
  const [suggestions, setSuggestions] = useState<PersistedSuggestion[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState('')
  const [processing, setProcessing] = useState<string | null>(null)
  const [removingKeyword, setRemovingKeyword] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, ProcessingState>>({})
  const [lastGenSummary, setLastGenSummary] = useState('')
  const [blockRules, setBlockRules] = useState<TopicBlockRule[]>([])
  const [blockPattern, setBlockPattern] = useState('')
  const [blockReason, setBlockReason] = useState('')
  const [blockMessage, setBlockMessage] = useState('')
  const [isBlocklistLoading, setIsBlocklistLoading] = useState(false)
  const [isRejectingAll, setIsRejectingAll] = useState(false)

  const load = useCallback(async (status: SubTab) => {
    setIsLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/suggest-clusters?status=${status}`)
      const data = await res.json()
      if (data.error) {
        setError(data.error)
        setSuggestions([])
      } else {
        setSuggestions((data.suggestions ?? []) as PersistedSuggestion[])
      }
    } catch {
      setError('목록을 불러오지 못했습니다.')
      setSuggestions([])
    }
    setIsLoading(false)
  }, [])

  const loadBlockRules = useCallback(async () => {
    setIsBlocklistLoading(true)
    setBlockMessage('')
    try {
      const res = await fetch('/api/topic-suggestion-blocklist')
      const data = await res.json()
      if (data.error) {
        setBlockMessage(data.error)
        setBlockRules([])
      } else {
        setBlockRules((data.rules ?? []) as TopicBlockRule[])
      }
    } catch {
      setBlockMessage('차단 규칙을 불러오지 못했습니다.')
      setBlockRules([])
    }
    setIsBlocklistLoading(false)
  }, [])

  useEffect(() => {
    load(subTab)
  }, [subTab, load])

  useEffect(() => {
    loadBlockRules()
  }, [loadBlockRules])

  const patchStatus = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/suggest-clusters/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  const handleGenerate = async () => {
    setIsGenerating(true)
    setError('')
    setLastGenSummary('')
    try {
      const res = await fetch('/api/suggest-clusters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        const saved = data.saved ?? 0
        const total = data.total ?? 0
        const llmCount = data.llmSuggestionCount ?? 0
        const normalizedCount = data.normalizedSuggestionCount ?? 0
        const modelLabel = data.model ? ` / ${data.model}` : ''
        const sourceLabel =
          data.source === 'fallback' ? ' (자동 보정)' : data.source === 'llm' ? ' (LLM)' : ''
        const debugLabel = ` / LLM ${llmCount}개, 통과 ${normalizedCount}개${modelLabel}`
        setLastGenSummary(`${total}개 기사 분석 → ${saved}개 신규 제안 저장${sourceLabel}${debugLabel}`)
        if (saved === 0 && data.rawResponsePreview) {
          setError(`LLM 원 응답 미리보기: ${data.rawResponsePreview}`)
        }
        if (subTab === 'pending') {
          await load('pending')
        } else {
          setSubTab('pending')
        }
      }
    } catch {
      setError('오류가 발생했습니다.')
    }
    setIsGenerating(false)
  }

  const handleApprove = async (s: PersistedSuggestion) => {
    setProcessing(s.id)
    setResults((r) => ({ ...r, [s.id]: { state: 'pending', message: '승인 처리 중...' } }))

    try {
      const approveRes = await patchStatus(s.id, { status: 'approved' })
      if (approveRes.error) {
        setResults((r) => ({ ...r, [s.id]: { state: 'error', message: approveRes.error } }))
        setProcessing(null)
        return
      }

      setResults((r) => ({ ...r, [s.id]: { state: 'pending', message: '클러스터 생성 중...' } }))

      const clusterRes = await fetch('/api/cluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: s.topic,
          keywords: s.keywords,
          articleIds: s.articleIds,
        }),
      })
      const clusterData = await clusterRes.json()
      if (!clusterData.success) {
        await patchStatus(s.id, { status: 'pending' })
        setResults((r) => ({
          ...r,
          [s.id]: { state: 'error', message: clusterData.error ?? '클러스터 생성 실패' },
        }))
        setProcessing(null)
        return
      }

      setResults((r) => ({
        ...r,
        [s.id]: {
          state: 'pending',
          message: `클러스터 생성됨 (${clusterData.matched}개 매칭). 기사 생성 중...`,
        },
      }))

      const genRes = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusterIds: [clusterData.clusterId] }),
      })
      const genData = await genRes.json()
      const result = genData.results?.[0] as GenerateResult | undefined

      if (result?.success) {
        await patchStatus(s.id, {
          status: 'published',
          clusterId: clusterData.clusterId,
        })
        setResults((r) => ({
          ...r,
          [s.id]: { state: 'success', message: `완료: ${result.article?.title ?? ''}` },
        }))
        await load(subTab)
      } else {
        await patchStatus(s.id, { status: 'pending' })
        setResults((r) => ({
          ...r,
          [s.id]: { state: 'error', message: result?.error ?? '기사 생성 실패' },
        }))
      }
    } catch (err) {
      await patchStatus(s.id, { status: 'pending' }).catch(() => undefined)
      setResults((r) => ({ ...r, [s.id]: { state: 'error', message: String(err) } }))
    }
    setProcessing(null)
  }

  const handleRegenerate = async (s: PersistedSuggestion) => {
    setProcessing(s.id)
    setResults((r) => ({ ...r, [s.id]: { state: 'pending', message: '기사 재생성 중...' } }))

    try {
      let currentClusterId = s.clusterId

      if (!currentClusterId) {
        const clusterRes = await fetch('/api/cluster', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: s.topic,
            keywords: s.keywords,
            articleIds: s.articleIds,
          }),
        })
        const clusterData = await clusterRes.json()
        if (!clusterData.success) {
          setResults((r) => ({
            ...r,
            [s.id]: { state: 'error', message: clusterData.error ?? '클러스터 생성 실패' },
          }))
          setProcessing(null)
          return
        }
        currentClusterId = clusterData.clusterId
      }

      const genRes = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusterIds: [currentClusterId] }),
      })
      const genData = await genRes.json()
      const result = genData.results?.[0] as GenerateResult | undefined

      if (result?.success) {
        await patchStatus(s.id, {
          status: 'published',
          clusterId: currentClusterId,
        })
        setResults((r) => ({
          ...r,
          [s.id]: { state: 'success', message: `재생성 완료: ${result.article?.title ?? ''}` },
        }))
        await load(subTab)
      } else {
        setResults((r) => ({
          ...r,
          [s.id]: { state: 'error', message: result?.error ?? '기사 생성 실패' },
        }))
      }
    } catch (err) {
      setResults((r) => ({ ...r, [s.id]: { state: 'error', message: String(err) } }))
    }
    setProcessing(null)
  }

  const handleReject = async (s: PersistedSuggestion) => {
    setProcessing(s.id)
    try {
      const data = await patchStatus(s.id, { status: 'rejected', hideRawArticles: true })
      if (data.error) {
        setResults((r) => ({ ...r, [s.id]: { state: 'error', message: data.error } }))
      } else {
        await load(subTab)
      }
    } catch (err) {
      setResults((r) => ({ ...r, [s.id]: { state: 'error', message: String(err) } }))
    }
    setProcessing(null)
  }

  const handleRejectAll = async () => {
    if (!window.confirm(`미처리 토픽 ${suggestions.length}개를 모두 거절하시겠습니까?`)) {
      return
    }

    setIsRejectingAll(true)
    setError('')
    try {
      const res = await fetch('/api/suggest-clusters/reject-all', {
        method: 'POST',
      })
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        await load('pending')
      }
    } catch (err) {
      setError(String(err))
    }
    setIsRejectingAll(false)
  }

  const handleAddBlockRule = async () => {
    const pattern = blockPattern.trim()
    if (!pattern) return

    setIsBlocklistLoading(true)
    setBlockMessage('')
    try {
      const res = await fetch('/api/topic-suggestion-blocklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pattern,
          reason: blockReason.trim(),
        }),
      })
      const data = await res.json()
      if (data.error) {
        setBlockMessage(data.error)
      } else {
        setBlockPattern('')
        setBlockReason('')
        setBlockMessage(`차단 규칙 추가: ${data.rule?.pattern ?? pattern}`)
        await loadBlockRules()
      }
    } catch {
      setBlockMessage('차단 규칙 추가 중 오류가 발생했습니다.')
    }
    setIsBlocklistLoading(false)
  }

  const handleToggleBlockRule = async (rule: TopicBlockRule) => {
    setIsBlocklistLoading(true)
    setBlockMessage('')
    try {
      const res = await fetch('/api/topic-suggestion-blocklist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: rule.id,
          enabled: !rule.enabled,
        }),
      })
      const data = await res.json()
      if (data.error) {
        setBlockMessage(data.error)
      } else {
        await loadBlockRules()
      }
    } catch {
      setBlockMessage('차단 규칙 변경 중 오류가 발생했습니다.')
    }
    setIsBlocklistLoading(false)
  }

  const handleDeleteBlockRule = async (rule: TopicBlockRule) => {
    setIsBlocklistLoading(true)
    setBlockMessage('')
    try {
      const res = await fetch(`/api/topic-suggestion-blocklist?id=${encodeURIComponent(rule.id)}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (data.error) {
        setBlockMessage(data.error)
      } else {
        setBlockMessage(`차단 규칙 삭제: ${rule.pattern}`)
        await loadBlockRules()
      }
    } catch {
      setBlockMessage('차단 규칙 삭제 중 오류가 발생했습니다.')
    }
    setIsBlocklistLoading(false)
  }

  const handleIgnoreArticle = async (suggestionId: string, articleId: string) => {
    try {
      const res = await fetch(`/api/suggest-clusters/${suggestionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawArticleId: articleId }),
      })
      const data = await res.json()
      if (data.success) {
        setSuggestions((prev) =>
          prev.map((s) => {
            if (s.id === suggestionId) {
              return {
                ...s,
                articles: s.articles.filter((a) => a.id !== articleId),
              }
            }
            return s
          })
        )
      } else {
        console.error('Ignore error:', data.error)
      }
    } catch (err) {
      console.error('Ignore request failed:', err)
    }
  }

  const handleRemoveKeyword = async (suggestionId: string, keyword: string) => {
    const confirmed = window.confirm(
      `"${keyword}" 엔티티를 제거하고 엔티티 JSON에서도 삭제할까요?`
    )
    if (!confirmed) return

    const removalKey = `${suggestionId}:${keyword}`
    setRemovingKeyword(removalKey)
    setResults((r) => ({
      ...r,
      [suggestionId]: { state: 'pending', message: `"${keyword}" 엔티티 제거 중...` },
    }))

    try {
      const res = await fetch(`/api/suggest-clusters/${suggestionId}/keywords`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword }),
      })
      const data = await res.json()

      if (data.error) {
        setResults((r) => ({
          ...r,
          [suggestionId]: { state: 'error', message: data.error },
        }))
      } else {
        const nextKeywords = (data.keywords ?? []) as string[]
        setSuggestions((prev) =>
          prev.map((s) => {
            if (s.id !== suggestionId) return s
            return {
              ...s,
              keywords: nextKeywords,
              commonEntities: s.commonEntities?.filter(
                (entity) => entity.trim().toLowerCase() !== keyword.trim().toLowerCase()
              ),
              matchedEntities: s.matchedEntities?.filter(
                (entity) => entity.trim().toLowerCase() !== keyword.trim().toLowerCase()
              ),
            }
          })
        )
        const removedEntityNames = (data.removedEntities ?? [])
          .map((entity: { name?: string }) => entity.name)
          .filter(Boolean)
          .join(', ')
        setResults((r) => ({
          ...r,
          [suggestionId]: {
            state: 'success',
            message: removedEntityNames
              ? `키워드 제거 및 엔티티 삭제 완료: ${removedEntityNames}`
              : '엔티티 표시를 제거했습니다. 같은 이름의 엔티티는 JSON에서 찾지 못했습니다.',
          },
        }))
      }
    } catch (err) {
      setResults((r) => ({
        ...r,
        [suggestionId]: { state: 'error', message: String(err) },
      }))
    }
    setRemovingKeyword(null)
  }

  const emptyMessage =
    subTab === 'pending'
      ? '대기 중인 제안이 없습니다. 위 버튼으로 새 제안을 받아보세요.'
      : subTab === 'published'
      ? '기사 생성 완료된 제안이 아직 없습니다.'
      : '거절된 제안이 없습니다.'

  return (
    <div>
      <p className="text-gray-600 mb-6">
        최근 미사용 raw 기사를 LLM이 분석해 토픽 그룹을 제안합니다. 승인하면 기사 초안이 생성되고, 게시는 다음 탭에서 검토 후 진행합니다.
      </p>

      <section className="mb-6 border rounded p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">토픽 제안 차단 규칙</h2>
            <p className="mt-1 text-sm text-gray-500">토픽, 키워드, 공통 근거에 포함되면 저장하지 않습니다.</p>
          </div>
          <button
            type="button"
            onClick={loadBlockRules}
            disabled={isBlocklistLoading}
            className="px-3 py-2 border border-gray-300 text-sm rounded font-semibold disabled:opacity-50"
          >
            새로고침
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            className="rounded border p-3 text-sm"
            placeholder="차단 키워드 (예: catches up with)"
            value={blockPattern}
            onChange={(e) => setBlockPattern(e.target.value)}
          />
          <input
            className="rounded border p-3 text-sm"
            placeholder="메모 (선택)"
            value={blockReason}
            onChange={(e) => setBlockReason(e.target.value)}
          />
          <button
            type="button"
            onClick={handleAddBlockRule}
            disabled={isBlocklistLoading || !blockPattern.trim()}
            className="px-4 py-3 bg-black text-white text-sm rounded font-semibold disabled:opacity-50"
          >
            추가
          </button>
        </div>

        {blockMessage && <p className="mt-3 text-sm text-gray-500">{blockMessage}</p>}

        {blockRules.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {blockRules.map((rule) => (
              <div
                key={rule.id}
                className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${
                  rule.enabled ? 'border-gray-300' : 'border-gray-200 text-gray-400'
                }`}
              >
                <span className="font-medium">{rule.pattern}</span>
                {rule.reason && <span className="text-xs text-gray-500">{rule.reason}</span>}
                <button
                  type="button"
                  onClick={() => handleToggleBlockRule(rule)}
                  disabled={isBlocklistLoading}
                  className="text-xs text-gray-500 hover:text-black disabled:opacity-50"
                >
                  {rule.enabled ? '끄기' : '켜기'}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteBlockRule(rule)}
                  disabled={isBlocklistLoading}
                  className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          onClick={handleGenerate}
          disabled={isGenerating || isRejectingAll}
          className="px-6 py-3 bg-black text-white rounded font-semibold disabled:opacity-50"
        >
          {isGenerating ? '분석 중...' : '토픽 제안 받기'}
        </button>
        {subTab === 'pending' && suggestions.length > 0 && (
          <button
            onClick={handleRejectAll}
            disabled={isGenerating || processing !== null || isRejectingAll}
            className="px-6 py-3 border border-red-300 text-red-600 rounded font-semibold hover:bg-red-50 disabled:opacity-50"
          >
            {isRejectingAll ? '처리 중...' : '미처리 전체 거절'}
          </button>
        )}
        {lastGenSummary && <p className="text-sm text-gray-500">{lastGenSummary}</p>}
      </div>

      <div className="flex gap-2 mb-4 border-b text-sm">
        {[
          { id: 'pending', label: '미처리' },
          { id: 'published', label: '기사 생성 완료' },
          { id: 'rejected', label: '거절됨' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id as SubTab)}
            className={`px-3 py-2 font-medium border-b-2 transition-colors ${
              subTab === tab.id
                ? 'border-black text-black'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <p className="text-red-500 mb-4">{error}</p>}

      {isLoading && <p className="text-gray-500">불러오는 중...</p>}

      {!isLoading && suggestions.length === 0 && !error && (
        <p className="text-gray-500">{emptyMessage}</p>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-4">
          {suggestions.map((s) => {
            const result = results[s.id]
            const isProcessing = processing === s.id
            return (
              <div key={s.id} className="border rounded p-4">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-lg">{s.topic}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      {typeof s.cohesionScore === 'number' && (
                        <span className="font-medium text-gray-700">응집도 {s.cohesionScore}</span>
                      )}
                    </div>
                    {s.matchedEntities && s.matchedEntities.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {s.matchedEntities.map((k) => (
                          <span
                            key={k}
                            className="inline-flex items-center gap-1 rounded bg-gray-100 py-0.5 pl-2 pr-1 text-xs"
                          >
                            <span>{k}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveKeyword(s.id, k)}
                              disabled={removingKeyword !== null || processing !== null}
                              title={`${k} 엔티티 제거`}
                              aria-label={`${k} 엔티티 제거`}
                              className="rounded px-1 text-gray-400 hover:bg-gray-200 hover:text-red-600 disabled:opacity-40"
                            >
                              x
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {subTab === 'pending' && (
                    <div className="flex gap-2 whitespace-nowrap">
                      <button
                        onClick={() => handleApprove(s)}
                        disabled={processing !== null || isRejectingAll}
                        className="px-3 py-2 bg-black text-white text-sm rounded font-semibold disabled:opacity-50"
                      >
                        {isProcessing ? '처리 중...' : '승인 & 기사 생성'}
                      </button>
                      <button
                        onClick={() => handleReject(s)}
                        disabled={processing !== null || isRejectingAll}
                        className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded font-semibold hover:bg-gray-50 disabled:opacity-50"
                      >
                        거절
                      </button>
                    </div>
                  )}

                  {subTab === 'published' && (
                    <div className="flex gap-2 whitespace-nowrap">
                      <span className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded">
                        기사 초안 생성됨
                      </span>
                      <button
                        onClick={() => handleRegenerate(s)}
                        disabled={processing !== null || isRejectingAll}
                        className="px-3 py-2 bg-black text-white text-sm rounded font-semibold disabled:opacity-50"
                      >
                        {isProcessing ? '처리 중...' : '재생성'}
                      </button>
                    </div>
                  )}
                </div>

                <details className="mt-2">
                  <summary className="text-sm text-gray-500 cursor-pointer">
                    매칭된 기사 {s.articles.length}개
                  </summary>
                  <ul className="mt-2 text-sm text-gray-600 space-y-1">
                    {s.articles.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2">
                        <span className="truncate">
                          ・{' '}
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            {a.title}
                          </a>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleIgnoreArticle(s.id, a.id)}
                          className="shrink-0 text-xs text-gray-400 hover:text-red-500"
                        >
                          ignore
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>

                {result && (
                  <p
                    className={`mt-3 text-sm ${
                      result.state === 'success'
                        ? 'text-green-600'
                        : result.state === 'error'
                        ? 'text-red-500'
                        : 'text-gray-500'
                    }`}
                  >
                    {result.message}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

type ArticleReviewSubTab = 'draft' | 'published'

function ArticlesReviewTab() {
  const [subTab, setSubTab] = useState<ArticleReviewSubTab>('draft')
  const [articles, setArticles] = useState<AdminArticle[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [processing, setProcessing] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editGenre, setEditGenre] = useState('')
  const [replacingId, setReplacingId] = useState<string | null>(null)
  const [replacementImageDataUrl, setReplacementImageDataUrl] = useState('')
  const [replacementUseCrop, setReplacementUseCrop] = useState(false)
  const [replacementCrop, setReplacementCrop] = useState<PercentCrop | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async (tab: ArticleReviewSubTab) => {
    setIsLoading(true)
    setError('')
    setMessage('')

    try {
      const res = await fetch(`/api/articles?published=${tab === 'published'}&limit=50`)
      const data = await res.json()

      if (data.error) {
        setError(data.error)
        setArticles([])
      } else {
        setArticles((data.articles ?? []) as AdminArticle[])
      }
    } catch {
      setError('기사 목록을 불러오지 못했습니다.')
      setArticles([])
    }

    setIsLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(subTab)
  }, [subTab, load])

  const handlePublish = async (article: AdminArticle) => {
    setProcessing(article.id)
    setError('')
    setMessage('')

    try {
      const res = await fetch(`/api/articles/${article.id}/publish`, {
        method: 'PATCH',
      })
      const data = await res.json()

      if (data.error) {
        setError(data.error)
      } else {
        setMessage(`게시 완료: ${data.article?.title ?? article.title}`)
        await load(subTab)
      }
    } catch {
      setError('게시 중 오류가 발생했습니다.')
    }

    setProcessing(null)
  }

  const startEdit = (article: AdminArticle) => {
    setEditingId(article.id)
    setEditTitle(article.title)
    setEditContent(article.content)
    setEditCategory(article.category ?? '')
    setEditGenre(article.genre ?? '')
    setError('')
    setMessage('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditTitle('')
    setEditContent('')
    setEditCategory('')
    setEditGenre('')
  }

  const startReplaceImage = (article: AdminArticle) => {
    setReplacingId(article.id)
    setReplacementImageDataUrl('')
    setReplacementUseCrop(false)
    setReplacementCrop(null)
    setError('')
    setMessage('')
  }

  const cancelReplaceImage = () => {
    setReplacingId(null)
    setReplacementImageDataUrl('')
    setReplacementUseCrop(false)
    setReplacementCrop(null)
  }

  const insertImageMarkdown = () => {
    const url = window.prompt('삽입할 이미지 URL을 입력하세요.')
    if (!url?.trim()) return

    const alt = window.prompt('이미지 설명(alt)을 입력하세요.')?.trim() || '이미지'
    const imageMarkdown = `\n\n![${alt}](${url.trim()})\n\n`
    setEditContent((content) => `${content}${imageMarkdown}`)
  }

  const handleSaveEdit = async (article: AdminArticle) => {
    setProcessing(article.id)
    setError('')
    setMessage('')

    try {
      const res = await fetch(`/api/articles/${article.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle,
          content: editContent,
          category: editCategory,
          genre: editGenre,
        }),
      })
      const data = await res.json()

      if (data.error) {
        setError(data.error)
      } else {
        setMessage(`수정 완료: ${data.article?.title ?? editTitle}`)
        cancelEdit()
        await load(subTab)
      }
    } catch {
      setError('수정 중 오류가 발생했습니다.')
    }

    setProcessing(null)
  }

  const handleDelete = async (article: AdminArticle) => {
    const ok = window.confirm(`이 기사 초안을 삭제할까요?\n\n${article.title}`)
    if (!ok) return

    setProcessing(article.id)
    setError('')
    setMessage('')

    try {
      const res = await fetch(`/api/articles/${article.id}`, {
        method: 'DELETE',
      })
      const data = await res.json()

      if (data.error) {
        setError(data.error)
      } else {
        setMessage(`삭제 완료: ${data.article?.title ?? article.title}`)
        await load(subTab)
      }
    } catch {
      setError('삭제 중 오류가 발생했습니다.')
    }

    setProcessing(null)
  }

  const handleReview = (article: AdminArticle) => {
    window.open(`/articles/${article.slug ?? article.id}`, '_blank', 'noopener,noreferrer')
  }

  const handleSaveReplacementImage = async (article: AdminArticle) => {
    if (!replacementImageDataUrl) {
      setError('교체할 이미지를 선택하세요.')
      return
    }

    setProcessing(article.id)
    setError('')
    setMessage('')

    try {
      const imageBase64 = replacementUseCrop && replacementCrop
        ? await getCroppedDataUrl(replacementImageDataUrl, replacementCrop)
        : replacementImageDataUrl
      const res = await fetch(`/api/articles/${article.id}/image`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          mimeType: replacementUseCrop && replacementCrop ? 'image/jpeg' : undefined,
        }),
      })
      const data = await res.json()

      if (data.error) {
        setError(data.error)
      } else {
        setMessage(`이미지 교체 완료: ${data.article?.title ?? article.title}`)
        cancelReplaceImage()
        await load(subTab)
      }
    } catch (err) {
      setError(String(err))
    }

    setProcessing(null)
  }

  const emptyMessage =
    subTab === 'draft'
      ? '게시 대기 중인 기사 초안이 없습니다.'
      : '게시된 기사가 아직 없습니다.'

  return (
    <div>
      <p className="text-gray-600 mb-6">
        생성된 기사 초안과 게시된 기사를 검토하고 수정합니다. 게시된 기사를 저장하면 Cloudflare 재빌드가 자동으로 요청됩니다.
      </p>

      <div className="flex gap-2 mb-4 border-b text-sm">
        {[
          { id: 'draft', label: '게시 대기' },
          { id: 'published', label: '게시됨' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id as ArticleReviewSubTab)}
            className={`px-3 py-2 font-medium border-b-2 transition-colors ${
              subTab === tab.id
                ? 'border-black text-black'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {message && <p className="text-green-600 mb-4">{message}</p>}
      {error && <p className="text-red-500 mb-4">{error}</p>}
      {isLoading && <p className="text-gray-500">불러오는 중...</p>}

      {!isLoading && articles.length === 0 && !error && (
        <p className="text-gray-500">{emptyMessage}</p>
      )}

      {!isLoading && articles.length > 0 && (
        <div className="space-y-4">
          {articles.map((article) => {
            const isEditing = editingId === article.id
            const isReplacing = replacingId === article.id
            return (
              <article key={article.id} className="border rounded p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span>{article.published ? '게시일' : '생성일'} {formatDate(article.published_at ?? article.created_at)}</span>
                      {article.updated_at && <span>수정일 {formatDate(article.updated_at)}</span>}
                      {article.cluster_id && <span>cluster {article.cluster_id}</span>}
                    </div>

                    {isReplacing ? (
                      <div className="space-y-4">
                        <div>
                          <p className="mb-2 text-sm font-semibold text-gray-800">새 이미지 업로드</p>
                          <input
                            type="file"
                            accept="image/jpeg,image/png"
                            onChange={async (e) => {
                              const file = e.target.files?.[0]
                              if (!file) {
                                setReplacementImageDataUrl('')
                                setReplacementUseCrop(false)
                                setReplacementCrop(null)
                                return
                              }
                              try {
                                setReplacementImageDataUrl(await fileToDataUrl(file))
                                setReplacementUseCrop(false)
                                setReplacementCrop(null)
                              } catch (err) {
                                setError(String(err))
                              }
                            }}
                            className="block w-full rounded border p-3 text-sm file:mr-4 file:rounded file:border-0 file:bg-black file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                          />
                        </div>
                        {replacementImageDataUrl ? (
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="text-sm text-gray-500">
                                크롭을 사용하지 않으면 업로드한 원본 이미지가 그대로 저장됩니다.
                              </p>
                              <label className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={replacementUseCrop}
                                  onChange={(e) => {
                                    setReplacementUseCrop(e.target.checked)
                                    if (!e.target.checked) setReplacementCrop(null)
                                  }}
                                />
                                크롭 사용
                              </label>
                            </div>
                            {replacementUseCrop ? (
                              <ImageCropper
                                imageUrl={replacementImageDataUrl}
                                onCropChange={setReplacementCrop}
                              />
                            ) : (
                              <div className="max-h-[420px] overflow-hidden rounded border bg-gray-100">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={replacementImageDataUrl}
                                  alt=""
                                  className="block max-h-[420px] w-full object-contain"
                                />
                              </div>
                            )}
                          </div>
                        ) : article.image_url ? (
                          <div className="max-w-xs">
                            <p className="mb-2 text-sm font-semibold text-gray-800">현재 이미지</p>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={article.image_url}
                              alt=""
                              className="w-full rounded border bg-gray-100 object-cover"
                            />
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500">현재 등록된 이미지가 없습니다.</p>
                        )}
                      </div>
                    ) : isEditing ? (
                      <div className="space-y-3">
                        <input
                          className="w-full rounded border p-3 text-lg font-semibold"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                        />
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <input
                            className="w-full rounded border p-3 text-sm"
                            placeholder="카테고리 (페스티벌, 릴리즈, 뉴스)"
                            value={editCategory}
                            onChange={(e) => setEditCategory(e.target.value)}
                          />
                          <input
                            className="w-full rounded border p-3 text-sm"
                            placeholder="장르 (예: techno, house, trance)"
                            value={editGenre}
                            onChange={(e) => setEditGenre(e.target.value)}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={insertImageMarkdown}
                            className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded font-semibold hover:bg-gray-50"
                          >
                            이미지 삽입
                          </button>
                          <span className="text-xs text-gray-500">
                            본문 끝에 Markdown 이미지 문법으로 추가됩니다.
                          </span>
                        </div>
                        <textarea
                          className="h-72 w-full rounded border p-3 text-sm leading-6"
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                        />
                      </div>
                    ) : (
                      <>
                        <div className="mb-2 flex flex-wrap gap-1.5 text-xs">
                          {article.category && (
                            <span className="rounded bg-gray-900 px-2 py-0.5 font-medium text-white">
                              {article.category}
                            </span>
                          )}
                          {article.genre && (
                            <span className="rounded border border-gray-300 px-2 py-0.5 text-gray-600">
                              {article.genre}
                            </span>
                          )}
                        </div>
                        <h3 className="text-lg font-semibold leading-snug">{article.title}</h3>
                        <p className="mt-2 text-sm text-gray-600 line-clamp-3">{article.content}</p>
                      </>
                    )}
                  </div>

                  <div className="flex shrink-0 gap-2">
                    {isReplacing ? (
                      <>
                        <button
                          onClick={() => handleSaveReplacementImage(article)}
                          disabled={processing !== null || !replacementImageDataUrl}
                          className="px-3 py-2 bg-black text-white text-sm rounded font-semibold disabled:opacity-50 whitespace-nowrap"
                        >
                          {processing === article.id ? '저장 중...' : '이미지 저장'}
                        </button>
                        <button
                          onClick={cancelReplaceImage}
                          disabled={processing !== null}
                          className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded font-semibold hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                        >
                          취소
                        </button>
                      </>
                    ) : isEditing ? (
                      <>
                        <button
                          onClick={() => handleSaveEdit(article)}
                          disabled={processing !== null}
                          className="px-3 py-2 bg-black text-white text-sm rounded font-semibold disabled:opacity-50 whitespace-nowrap"
                        >
                          {processing === article.id ? '저장 중...' : '저장'}
                        </button>
                        <button
                          onClick={cancelEdit}
                          disabled={processing !== null}
                          className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded font-semibold hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                        >
                          취소
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleReview(article)}
                          className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded font-semibold hover:bg-gray-50 whitespace-nowrap"
                        >
                          검토
                        </button>
                        <button
                          onClick={() => startEdit(article)}
                          disabled={processing !== null || editingId !== null || replacingId !== null}
                          className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded font-semibold hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => startReplaceImage(article)}
                          disabled={processing !== null || editingId !== null || replacingId !== null}
                          className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded font-semibold hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                        >
                          이미지 교체
                        </button>
                        {subTab === 'draft' && (
                          <>
                            <button
                              onClick={() => handlePublish(article)}
                              disabled={processing !== null || editingId !== null || replacingId !== null}
                              className="px-3 py-2 bg-black text-white text-sm rounded font-semibold disabled:opacity-50 whitespace-nowrap"
                            >
                              {processing === article.id ? '게시 중...' : '게시'}
                            </button>
                            <button
                              onClick={() => handleDelete(article)}
                              disabled={processing !== null || editingId !== null || replacingId !== null}
                              className="px-3 py-2 border border-red-300 text-red-600 text-sm rounded font-semibold hover:bg-red-50 disabled:opacity-50 whitespace-nowrap"
                            >
                              {processing === article.id ? '처리 중...' : '삭제'}
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

function GenerateTab() {
  const [clusterId, setClusterId] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<GenerateResult | null>(null)

  const handleGenerate = async () => {
    if (!clusterId) return
    setIsLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusterIds: [clusterId] }),
      })
      const data = await res.json()
      setResult(data.results[0])
    } catch {
      setResult({ success: false, error: '오류가 발생했습니다.' })
    }
    setIsLoading(false)
  }

  return (
    <div>
      <p className="text-gray-600 mb-6">클러스터 ID를 입력하면 한국어 종합 기사를 생성합니다.</p>
      <input
        className="w-full p-3 border rounded mb-4"
        placeholder="클러스터 ID (UUID)"
        value={clusterId}
        onChange={(e) => setClusterId(e.target.value)}
      />
      <button
        onClick={handleGenerate}
        disabled={isLoading}
        className="px-6 py-3 bg-black text-white rounded font-semibold disabled:opacity-50"
      >
        {isLoading ? '생성 중...' : '기사 생성'}
      </button>
      {result && (
        <div className={`mt-6 p-4 rounded border ${result.success ? 'border-green-400' : 'border-red-400'}`}>
          {result.success ? (
            <>
              <p className="font-bold text-lg">{result.article?.title}</p>
              <p className="text-gray-600 mt-2">{result.article?.content}</p>
            </>
          ) : (
            <p className="text-red-500">{result.error}</p>
          )}
        </div>
      )}
    </div>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
