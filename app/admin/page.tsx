'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type Tab = 'collect' | 'add-urls' | 'suggest' | 'articles' | 'cluster' | 'generate'

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('collect')

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-8">EDM Star News 어드민</h1>

      {/* 탭 */}
      <div className="flex gap-2 mb-8 border-b">
        {[
          { id: 'collect', label: '① RSS 수집' },
          { id: 'add-urls', label: '② URL 직접 추가' },
          { id: 'suggest', label: '③ 자동 토픽 제안' },
          { id: 'articles', label: '④ 생성 기사 검토' },
          { id: 'cluster', label: '⑤ 클러스터 (수동)' },
          { id: 'generate', label: '⑥ 기사 생성 (수동)' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as Tab)}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-black text-black'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 탭 컨텐츠 */}
      {activeTab === 'collect' && <CollectTab />}
      {activeTab === 'add-urls' && <AddUrlsTab />}
      {activeTab === 'suggest' && <SuggestTab />}
      {activeTab === 'articles' && <ArticlesReviewTab />}
      {activeTab === 'cluster' && <ClusterTab />}
      {activeTab === 'generate' && <GenerateTab />}
    </div>
  )
}

function CollectTab() {
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<string>('')
  const [failures, setFailures] = useState<{ source: string; url: string; error: string }[]>([])

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

  return (
    <div>
      <p className="text-gray-600 mb-6">32개 RSS 소스에서 새 기사를 수집합니다.</p>
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
  articles: { id: string; title: string; url: string }[]
  status: SuggestionStatus
  clusterId: string | null
  articleId: string | null
  createdAt: string
}

type ProcessingState = { state: 'pending' | 'success' | 'error'; message: string }

type AdminArticle = {
  id: string
  title: string
  content: string
  published: boolean
  published_at: string | null
  created_at: string
  cluster_id: string | null
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
  const [results, setResults] = useState<Record<string, ProcessingState>>({})
  const [lastGenSummary, setLastGenSummary] = useState('')

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

  useEffect(() => {
    load(subTab)
  }, [subTab, load])

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

  const handleReject = async (s: PersistedSuggestion) => {
    setProcessing(s.id)
    try {
      const data = await patchStatus(s.id, { status: 'rejected' })
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

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="px-6 py-3 bg-black text-white rounded font-semibold disabled:opacity-50"
        >
          {isGenerating ? '분석 중...' : '토픽 제안 받기'}
        </button>
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
                      {s.commonEntities && s.commonEntities.length > 0 && (
                        <span>공통 근거: {s.commonEntities.join(', ')}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {s.keywords.map((k) => (
                        <span key={k} className="px-2 py-0.5 text-xs bg-gray-100 rounded">
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>

                  {subTab === 'pending' && (
                    <div className="flex gap-2 whitespace-nowrap">
                      <button
                        onClick={() => handleApprove(s)}
                        disabled={processing !== null}
                        className="px-3 py-2 bg-black text-white text-sm rounded font-semibold disabled:opacity-50"
                      >
                        {isProcessing ? '처리 중...' : '승인 & 기사 생성'}
                      </button>
                      <button
                        onClick={() => handleReject(s)}
                        disabled={processing !== null}
                        className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded font-semibold hover:bg-gray-50 disabled:opacity-50"
                      >
                        거절
                      </button>
                    </div>
                  )}

                  {subTab === 'published' && s.clusterId && (
                    <span className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded whitespace-nowrap">
                      기사 초안 생성됨
                    </span>
                  )}
                </div>

                {s.reason && <p className="mb-3 text-sm text-gray-600">{s.reason}</p>}

                <details className="mt-2">
                  <summary className="text-sm text-gray-500 cursor-pointer">
                    매칭된 기사 {s.articles.length}개
                  </summary>
                  <ul className="mt-2 text-sm text-gray-600 space-y-1">
                    {s.articles.map((a) => (
                      <li key={a.id} className="truncate">
                        ・{' '}
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline"
                        >
                          {a.title}
                        </a>
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
    setError('')
    setMessage('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditTitle('')
    setEditContent('')
  }

  const handleSaveEdit = async (article: AdminArticle) => {
    setProcessing(article.id)
    setError('')
    setMessage('')

    try {
      const res = await fetch(`/api/articles/${article.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle, content: editContent }),
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

  const emptyMessage =
    subTab === 'draft'
      ? '게시 대기 중인 기사 초안이 없습니다.'
      : '게시된 기사가 아직 없습니다.'

  return (
    <div>
      <p className="text-gray-600 mb-6">
        자동 토픽 제안에서 생성된 기사 초안을 검토한 뒤, 공개 뉴스 사이트에 노출할 기사를 게시합니다.
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
            return (
              <article key={article.id} className="border rounded p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span>{article.published ? '게시일' : '생성일'} {formatDate(article.published_at ?? article.created_at)}</span>
                      {article.cluster_id && <span>cluster {article.cluster_id}</span>}
                    </div>

                    {isEditing ? (
                      <div className="space-y-3">
                        <input
                          className="w-full rounded border p-3 text-lg font-semibold"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                        />
                        <textarea
                          className="h-72 w-full rounded border p-3 text-sm leading-6"
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                        />
                      </div>
                    ) : (
                      <>
                        <h3 className="text-lg font-semibold leading-snug">{article.title}</h3>
                        <p className="mt-2 text-sm text-gray-600 line-clamp-3">{article.content}</p>
                      </>
                    )}
                  </div>

                  <div className="flex shrink-0 gap-2">
                    {isEditing ? (
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
                        <Link
                          href={`/articles/${article.id}`}
                          target="_blank"
                          className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded font-semibold hover:bg-gray-50 whitespace-nowrap"
                        >
                          검토
                        </Link>
                        {subTab === 'draft' && (
                          <>
                            <button
                              onClick={() => startEdit(article)}
                              disabled={processing !== null || editingId !== null}
                              className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded font-semibold hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                            >
                              수정
                            </button>
                            <button
                              onClick={() => handlePublish(article)}
                              disabled={processing !== null || editingId !== null}
                              className="px-3 py-2 bg-black text-white text-sm rounded font-semibold disabled:opacity-50 whitespace-nowrap"
                            >
                              {processing === article.id ? '게시 중...' : '게시'}
                            </button>
                            <button
                              onClick={() => handleDelete(article)}
                              disabled={processing !== null || editingId !== null}
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
