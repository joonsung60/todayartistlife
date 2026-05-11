# EDM Star News Korea - 프로젝트 컨텍스트

## 프로젝트 개요
EDM 관련 영문 매체(Mixmag, RA, DJ Mag 등)의 RSS 피드를 자동 수집하고,
여러 기사를 클러스터링해 로컬 LLM으로 한국어 종합 기사를 자동 생성하는 뉴스 사이트.

## 기술 스택
- Frontend/Backend: Next.js 16 (App Router, Server Components 기본)
- DB: Supabase (PostgreSQL)
- LLM: Ollama + Qwen3:14b (Windows에서 실행, WSL에서 http://172.25.224.1:11434 로 접근)
- 멀티모달: qwen2.5vl:7b (이미지 분석용, 추후 활용)
- Hosting: 로컬 개발 중 (추후 Vercel + Supabase 배포)

## DB 테이블 구조
- rss_sources: RSS 피드 소스 목록 (32개)
- raw_articles: 수집된 원문 기사 (id, title, content, url, image_url, source_id, author, published_at, is_used)
- article_clusters: 토픽별 기사 묶음 (id, topic, keywords)
- cluster_articles: 클러스터-기사 연결 테이블 (cluster_id, raw_article_id)
- articles: 생성된 한국어 종합 기사 (id, title, content, cluster_id, published, published_at, created_at)
- suggested_clusters: LLM/휴리스틱이 제안한 클러스터 후보
  - 현재 코드가 실제로 사용하는 DB 컬럼: id, topic, keywords, article_ids, status, cluster_id, created_at
  - status: pending | approved | rejected | published
  - 주의: reason, common_entities, cohesion_score, article_id는 현재 DB 저장 컬럼으로 쓰지 않는다. UI 표시용 reason/commonEntities/cohesionScore는 GET hydrate 단계에서 keywords/article_ids 기반으로 일부 재구성한다.

## 주요 파일 구조
```
app/
  page.tsx                        # 기사 목록 (Server Component, 발행 정렬)
  layout.tsx                      # 루트 레이아웃
  articles/[id]/page.tsx          # 기사 상세 (한국어 문장 단위로 <p> 분리)
  admin/page.tsx                  # 어드민 UI (5개 탭)
  api/
    collect/route.ts              # RSS 수집 + URL 직접 추가 (failures 리포팅)
    cluster/route.ts              # 키워드/articleIds 기반 클러스터 생성 (matchMode: or/and)
    generate/route.ts             # 한국어 기사 생성 (Ollama Qwen3:14b)
    suggest-clusters/route.ts     # POST: LLM/휴리스틱 토픽 제안 → DB 저장 / GET: 상태별 조회
    suggest-clusters/[id]/route.ts # PATCH: 제안 status/cluster_id 업데이트
    articles/[id]/publish/route.ts # PATCH: 기사 published=true + published_at 세팅
    cron/route.ts                 # 스케줄러용 엔드포인트 (CRON_SECRET 인증)
lib/
  supabase.ts                     # Supabase 클라이언트
  article-extraction.ts           # HTML 본문 추출 + 정제 (extractArticleText, extractImageUrl, cleanArticleText)
  prompts.ts                      # LLM 시스템 프롬프트 (A 작성됨, B는 dummy)
```

## 어드민 워크플로우 (5개 탭)
1. **① RSS 수집** — 32개 소스에서 새 기사 수집, 실패한 소스 리스트 표시
2. **② URL 직접 추가** — 리서치 중 발견한 URL 수동 등록
3. **③ 자동 토픽 제안** (메인 워크플로우)
   - "토픽 제안 받기" → LLM이 미사용 raw_articles를 분석해 그룹 제안 → suggested_clusters에 status='pending'으로 저장
   - 서브탭: 미처리 / 발행됨 / 거절됨
   - 카드별 액션: "승인 & 기사 생성" (PATCH approved → /api/cluster → /api/generate → PATCH published) / "거절" (PATCH rejected)
   - 중간 단계 실패 시 자동으로 status='pending' 롤백
4. **④ 클러스터 (수동)** — 토픽+키워드 직접 입력해 클러스터 생성 (백업 워크플로우)
5. **⑤ 기사 생성 (수동)** — 클러스터 ID 입력해 기사 생성 (백업 워크플로우)

## 자동 토픽 제안 동작 원리
- LLM이 카테고리성 클러스터(festival, techno 등)를 만드는 걸 막기 위해 시스템 프롬프트에 "같은 사건/릴리즈/행사/인물/제품 단위" 명시
- 응답 후처리: `CATEGORY_KEYWORDS` 필터 + 응집도 점수(cohesionScore) 계산 + 부분집합 제거(removeSubsetSuggestions) + 동일 article 묶음 dedupe
- LLM이 유효 결과를 못 내면 fallback: 제목에서 entity 추출(extractTitleEntities, knownEntityPatterns 매칭) → entity별 그룹 생성 → 응집도 ≥ 60만 통과
- POST 응답에 `source: 'llm' | 'fallback'`로 어떤 경로였는지 표시
- 저장 시에는 현재 DB 스키마에 맞춰 topic/keywords/article_ids/status만 insert한다. reason/commonEntities/cohesionScore는 저장하지 않는다.

## 현재 상태
- RSS 수집: 작동 중 (실패 소스는 어드민 UI에서 확인 가능)
- 본문 추출: lib/article-extraction.ts로 분리됨 (article/main/section 후보 + 메타 설명 + 잡음 제거)
- 자동 토픽 제안: 작동 중 (LLM + entity fallback 2-stage, DB pending 저장)
- 승인 → 자동 클러스터/기사 생성 파이프라인: 작동 중. 발행 완료 상태에는 cluster_id만 저장한다.
- 기사 목록/상세 페이지: 구현 완료 (목록은 발행일 우선, 없으면 생성일 / 상세는 한국어 문장 단위 단락 분리)
- 기사 발행 (published=true, published_at=now) 엔드포인트: 구현됨 (UI 트리거는 추후)
- 스케줄러 엔드포인트: /api/cron 구현됨 (Vercel Cron 또는 외부 스케줄러용)

## 환경 변수
- NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
- OLLAMA_BASE_URL (기본 http://localhost:11434, WSL에서는 http://172.25.224.1:11434)
- CRON_SECRET (선택, /api/cron Authorization: Bearer 검증용)

## 알려진 이슈
- RSS 실패 후보
  - DJ Mag: RSS 자체는 정상. `BST` 날짜 파싱은 collect/route.ts에서 보정함.
  - FAZEmag, The Nocturnal Times: RSS 자체는 정상 확인. 다음 수집에서 성공 가능성이 높음.
  - 6AM Group, Dubstep FBI, Resident Advisor: 현재 등록 URL 404. RA의 `https://ra.co/xml/news.xml`도 직접 확인 결과 404.
  - Beatportal: `/feed/`가 RSS가 아니라 HTML을 반환.
  - Magnetic Magazine: 403 Forbidden.
  - Your EDM: 503 또는 타임아웃.
  - Stoney Roads: 타임아웃.
- EDM Identity: JavaScript 렌더링 필요해서 본문 수집 품질이 낮을 수 있음
- 과거 raw_articles content에는 HTML 네비게이션 찌꺼기가 섞여 있을 수 있음. generate 단계에서 cleanArticleText로 재정화한다.
- Ollama OLLAMA_HOST=0.0.0.0 설정 필요 (WSL ↔ Windows 통신)
- suggested_clusters는 RLS policy가 필요하다. anon key 기반 서버 API를 쓰고 있으므로 select/insert/update policy가 없으면 저장/상태 변경이 실패한다.
- suggested_clusters에 article_id 컬럼은 현재 없다. 기사 링크까지 저장하려면 `article_id uuid references articles(id)` 컬럼을 별도 추가해야 한다.

## 다음 작업 목록
- [ ] 어드민에서 기사 발행(publish) 버튼 노출
- [ ] suggested_clusters 중복 방지 (이미 pending/published인 동일 article_ids set 재제안 방지)
- [ ] suggested_clusters.article_id 컬럼 추가 여부 결정 (발행됨 탭에서 기사 바로가기 복구용)
- [ ] 실패 RSS 소스 정리: 404/403/타임아웃 소스를 비활성화하거나 별도 스크래퍼로 분리
- [ ] Vercel Cron 설정 (vercel.json에 schedule 등록, 하루 2회)
- [ ] 시스템 프롬프트 B 작성 (심층 기사용, 현재 dummy)
- [ ] 어드민 인증 (현재 무방비)
