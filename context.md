# EDM Star News Korea - 현재 프로젝트 컨텍스트

이 문서는 현재 프로젝트 상태를 빠르게 공유하기 위한 브리핑이다. 웹 Claude/ChatGPT와 논의할 때 이 파일을 붙여넣으면 전체 구조와 남은 의사결정을 이해할 수 있어야 한다.

## 1. 프로젝트 목적

영문 EDM/전자음악 매체의 RSS 또는 개별 URL을 수집하고, 관련 원문들을 묶어 로컬 LLM으로 한국어 종합 기사를 생성한 뒤 공개 뉴스 사이트에 게시한다.

핵심 흐름:

1. 원문 수집: RSS 또는 URL 직접 추가
2. 자동 토픽 제안 (2단계):
   - Stage 1: 코드가 `lib/edm-entities.json`(아티스트 500 + 페스티벌 140 + 레이블 117)을 사전으로 raw article에서 엔터티 매칭 → 후보 클러스터 생성 (단독 기사도 가능)
   - Stage 2: 후보마다 Ollama 모델(env-driven, 현재 `mistral-small3.2:24b`)에 "한국어 EDM 기사로 작성할 가치가 있는가?" 질의 → 승인된 것만 저장
3. 인간 검토: 제안 승인 또는 거절
4. 기사 생성: 승인된 토픽으로 한국어 기사 초안 생성
5. 인간 검토: 초안 수정/삭제/게시
6. 공개 배포: 게시된 기사만 Cloudflare Pages 정적 사이트에 반영

## 2. 현재 아키텍처

### 로컬 어드민/생성 환경

- `npm run dev`로 로컬 Next.js 서버 실행 (`--webpack` 강제)
- `/admin`에서 수집, 토픽 제안, 기사 생성, 검토, 게시 작업 수행
- Ollama 모델은 `OLLAMA_MODEL` 환경변수로 지정. 현재 `mistral-small3.2:24b`. suggest-clusters는 `SUGGEST_MODEL` 별도 오버라이드 가능.
- `OLLAMA_BASE_URL=http://localhost:11434` — 운용 환경에 맞게 사용. WSL ↔ Windows Ollama 사용 시 게이트웨이 IP(예: `172.x.x.1`) 필요.
- Supabase에 raw article, cluster, generated article 저장
- `/admin/*`은 `proxy.ts`(Next.js 16에서 middleware의 새 이름)와 HMAC 쿠키 세션으로 보호

### 공개 사이트

- `edmstarnews.com`
- Cloudflare Pages 정적 export
- 공개 사이트는 Supabase의 `articles.published = true` 기사만 빌드 타임에 읽어 정적 HTML로 생성
- 배포본은 Ollama를 사용하지 않음
- 배포본에는 API routes가 없음

### 중요한 현재 결정

- 기사 생성과 관리는 로컬에서 한다.
- 공개 사이트는 정적 뉴스 사이트로만 사용한다.
- 배포본에 `/admin`을 포함할지 여부는 아직 보안상 의사결정이 필요하다.
  - 현재 `scripts/build-static.mjs`는 `app/admin`, `app/api`, `proxy.ts` 셋 다 정적 빌드 전에 stash로 제외한다. 즉 배포본에는 `/admin`이 없다.
  - 정적 배포에 `/admin`을 다시 포함하고 진짜 인증을 원하면 Cloudflare Access 같은 외부 보호가 필요하다.
  - 클라이언트 비밀번호 화면은 우회 가능하므로 진짜 보안으로 보지 않는다.

## 3. 기술 스택

- Next.js 16.2.6 App Router
- React 19
- Supabase PostgreSQL
- Ollama (모델은 `OLLAMA_MODEL` env-driven, 현재 `mistral-small3.2:24b`. 폴백 하드코딩 default는 `qwen3:14b`)
- Cloudflare Pages static export
- Tailwind CSS

Next.js 16 관련 주의:

- Next.js 16에서 `middleware.ts`가 `proxy.ts`로 이름이 바뀌었다(함수명도 `middleware` → `proxy`). 이 프로젝트는 `proxy.ts`를 사용한다.
- 동적 route handler의 `params`는 Promise로 처리한다.
- 정적 export에서는 proxy/API routes가 실행되지 않는다.
- Turbopack은 `output:'export'`를 silently 무시한다. 정적 빌드는 `next build --webpack`을 강제한다. `npm run dev`도 `--webpack`을 사용하도록 설정돼 있다.

## 4. 주요 DB 테이블

### `rss_sources`

RSS 소스 목록.

### `raw_articles`

수집된 원문 기사.

주요 컬럼:

- `id`
- `title`
- `content`
- `url`
- `image_url`
- `source_id`
- `author`
- `published_at`

### `article_clusters`

토픽별 원문 기사 묶음.

주요 컬럼:

- `id`
- `topic`
- `keywords`

### `cluster_articles`

클러스터와 raw article 연결.

주요 컬럼:

- `cluster_id`
- `raw_article_id`

### `articles`

생성된 한국어 기사.

주요 컬럼:

- `id`
- `title`
- `content`
- `cluster_id`
- `published`
- `published_at`
- `updated_at` (게시 후 수정 시점 추적용. 초기 NULL, PATCH 호출마다 now())
- `created_at`
- `slug` (URL 슬러그. 영문 소문자+하이픈, 30자 이내. 충돌 시 `-2`, `-3` 등 suffix)
- `category` (페스티벌/아티스트/릴리즈/뉴스/인터뷰 중 하나)
- `genre` (house, techno, trance 등 영문 소문자. 미상이면 `edm`)
- `tags` (미사용)
- `embed_url`, `source_platform` (미사용 / 향후 임베드용)

현재 공개 사이트는 `published=true` 기사만 보여준다.

### `suggested_clusters`

자동 토픽 제안 저장 테이블.

현재 코드가 사용하는 컬럼:

- `id`
- `topic`
- `keywords`
- `article_ids`
- `status`
- `cluster_id`
- `created_at`

`status` 의미:

- `pending`: 검토 전
- `approved`: 승인 처리 중간 상태
- `rejected`: 거절됨
- `published`: 제안 승인 후 기사 생성까지 완료됨

주의: 여기서 `published`는 공개 사이트 게시가 아니다. 공개 게시 여부는 `articles.published`가 결정한다.

## 5. 주요 파일과 역할

```txt
proxy.ts
  Next.js 16 proxy(구 middleware). 로컬 /admin/* 보호. HMAC admin_session 쿠키 검증.

lib/admin-session.ts
  HMAC-SHA256 기반 admin_session 쿠키 sign/verify (Web Crypto).

next.config.ts
  BUILD_STATIC=1일 때 output:'export', trailingSlash, images.unoptimized 설정.

scripts/build-static.mjs
  Cloudflare Pages 정적 빌드 스크립트.
  app/admin, app/api, proxy.ts를 .cf-build-stash로 임시 이동 → next build --webpack → 복원.
  현재 app/admin도 stash 대상이라 배포본에는 어드민 UI 자체가 없다.

app/layout.tsx
  사이트 공통 헤더와 네비게이션 (홈|페스티벌|아티스트|릴리즈|뉴스|인터뷰|장르별 ▾,
  현재 모두 더미 링크). Google Search Console verification 메타 태그를 metadata
  API의 verification.google 필드로 박아둠.

app/page.tsx
  공개 홈. published 기사 최대 20개를 published_at desc로 표시.
  기사 링크는 slug 우선(`slug ?? id`).
  썸네일은 cluster -> raw article image_url에서 가져온다.

app/articles/[slug]/page.tsx
  공개 기사 상세. params는 단일 [slug] 세그먼트지만 slug가 일치하지 않으면
  UUID 패턴일 때 한해 id로 fallback 조회. generateStaticParams는 published
  기사마다 slug ?? id 하나씩 emit. updated_at이 published_at과 다르면
  "수정됨" 라벨 표시.

app/robots.ts
  /robots.txt. 모든 경로 허용 + sitemap URL 명시.

app/admin/page.tsx
  로컬 어드민 UI. 6개 탭. RSS 수집 탭은 is_active=true인 소스 수를 클라이언트에서
  Supabase로 직접 조회해 동적으로 표시.

app/admin/login/page.tsx
  어드민 로그인 폼.

app/api/admin/login/route.ts
  ADMIN_PASSWORD 검증, 쿠키 발급, IP 기반 실패 제한(5회 / 15분, in-memory).

app/api/collect/route.ts
  RSS 수집과 URL 직접 추가. 제목/본문/이미지 추출.

app/api/suggest-clusters/route.ts
  자동 토픽 제안 생성/조회. 2단계 구조(엔터티 매칭 → LLM 가치 평가).
  entity dict 로드 실패 시 단일 LLM 경로로 fallback.

app/api/suggest-clusters/[id]/route.ts
  토픽 제안 status/cluster_id PATCH.

app/api/cluster/route.ts
  articleIds 또는 keywords 기반 클러스터 생성. matchMode or/and 지원.

app/api/generate/route.ts
  한국어 기사 생성. 클러스터 원문을 정제 후 OLLAMA_MODEL(default qwen3:14b)
  에 전달. LLM 응답에서 title/content/slug/category/genre 추출. slug는
  normalize + DB 중복 검사 후 -2, -3 suffix로 유일화. articles에 INSERT.

app/api/articles/route.ts
  생성 기사 목록 조회. published 필터 지원.

app/api/articles/[id]/route.ts
  기사 PATCH 수정 / DELETE 삭제. PATCH는 published 여부 무관하게 허용
  (게시 후 수정 가능). PATCH 시 updated_at=now() 세팅. published=true 기사
  PATCH 성공 시 CLOUDFLARE_DEPLOY_HOOK_URL fire-and-forget POST. DELETE는
  여전히 published=true 차단.

app/api/articles/[id]/publish/route.ts
  published=true, published_at=now() 업데이트 후 CLOUDFLARE_DEPLOY_HOOK_URL로
  fire-and-forget POST.

app/api/raw-articles/backfill-titles/route.ts
  과거 URL형 title 데이터를 재추출/보정하기 위한 backfill API.

lib/article-extraction.ts
  HTML 제목/본문/이미지 추출과 텍스트 정제(cleanArticleText).

lib/prompts.ts
  SYSTEM_PROMPT_A — 기사 생성 시스템 프롬프트. 상대 날짜 표현 금지 + 고유명사
  표기 규칙(영문 기본, 한국 정착 표기만 예외, 임의 한글 음역 절대 금지) 포함.
  SYSTEM_PROMPT_B — 미작성.

lib/edm-entities.json
  EDM 엔터티 사전. artists_top500_relevance_2024_2025(500),
  major_edm_festivals_worldwide(140), edm_labels_key_artists(117).
  실제 파일명은 'lib/ edm-entities.json'(선행 공백). suggest-clusters 코드가 여러
  후보 경로를 시도한다.
```

## 6. 어드민 UI 탭

1. **RSS 수집**
   - 등록 RSS 소스에서 새 기사 수집
   - is_active=true인 소스 수를 실시간 조회해 "N개 RSS 소스에서 ..." 표기
   - 실패 소스 표시

2. **URL 직접 추가**
   - URL을 줄 단위로 넣어 원문 수집

3. **자동 토픽 제안**
   - 최근 raw article(published_at desc, 최대 500개)에서 엔터티 사전 매칭
   - 매칭된 엔터티 가중치 합 >= 0.6인 후보 클러스터 생성(단독 기사 포함)
   - 각 후보를 LLM에 가치 질의 → 승인된 것만 저장
   - 승인 시 인간이 다시 "승인 & 기사 생성" 또는 "거절"
   - "승인 & 기사 생성" 클릭하면 클러스터 생성 + 기사 생성까지 자동 진행

4. **생성 기사 검토**
   - 생성된 초안 + 게시본 모두 목록 표시 (서브탭: 게시 대기 / 게시됨)
   - 수정 버튼은 두 서브탭 모두에서 활성 (게시 후 수정 가능)
   - 게시/삭제 버튼은 초안 전용
   - 게시 버튼은 published=true + published_at=now() + Cloudflare 재빌드 트리거
   - 게시본 수정 시에도 updated_at 세팅 + Cloudflare 재빌드 트리거

5. **클러스터 수동 생성**
   - 토픽/키워드로 수동 클러스터 생성

6. **기사 수동 생성**
   - 클러스터 ID를 직접 넣어 기사 생성

## 7. 자동 토픽 제안 정책

목표는 "한국어 EDM 뉴스 기사로 작성할 가치가 있는 raw article 후보를 찾는 것". 단독 기사여도 구체적 사건/릴리즈/행사/인물/제품을 다루면 통과한다.

### 2단계 구조

**Stage 1 — 코드 기반 후보 클러스터 생성 (`buildCandidateClusters`):**

- `lib/edm-entities.json` 로드: 아티스트(weight 1.0, name+aliases), 페스티벌(weight 1.0, name), 레이블(weight 0.6, name).
- 각 raw article에 대해 title + content 첫 200자 lowercase에서 entity surface를 word-boundary로 매칭.
- 역인덱스 (entity → article ids) 구축 후 같은 entity를 공유하는 기사 묶음을 후보 클러스터로 생성. 단독 기사도 후보가 된다.
- 동일 articleIds 집합은 dedupe.
- 필터: 후보의 shared entity weight sum >= 0.6 (단일 아티스트=1.0, 단일 페스티벌=1.0, 단일 레이블=0.6 모두 통과).
- ~~기사 수 < 2 필터~~, ~~도메인 다양성 필터~~, ~~72시간 freshness 필터~~ — 모두 제거됨.

**Stage 2 — 후보별 LLM 가치 평가 (`approveCandidateWithLlm`):**

- 후보 1개당 Ollama 호출 1회 (순차 처리).
- 모델 선택 순서: `SUGGEST_MODEL` → `OLLAMA_MODEL` → 하드코딩 default `qwen3:14b`.
- system prompt(`SUGGEST_SYSTEM`)가 카테고리/매체명/연도/인터뷰 패턴 거부 규칙을 강제.
- user prompt는 "이 기사가 한국어 EDM 뉴스 기사로 작성할 만한 가치가 있는가? yes면 topic과 keywords 반환, no면 approved: false 반환".
- Ollama `format` 파라미터로 `{approved, topic?, keywords?, reason?}` 스키마 강제.
- approved=true만 `normalizeSuggestion`에 전달.

**`normalizeSuggestion` 후검증:**

- 빈 topic 거절. topic이 URL/도메인/매체-시리즈명/low-signal 패턴이면 거절.
- articleIds 수 >= 1이어야 통과 (단독 기사 허용).
- Stage 2 승인 후보는 cohesionScore=50을 강제 부여 (MIN_COHESION_SCORE=20 통과).
- keywords와 commonEntities가 모두 비면 거절.

**Fallback:** entity dict 로드 실패 시 `runLlmOnlyPath`로 빠짐. 기존 단일 LLM 호출(`{suggestions:[...]}` 다건 반환) 흐름 유지. 응답에 `source: 'llm'`.

### 정책 상수

- DEFAULT_ANALYSIS_LIMIT = MAX_ANALYSIS_LIMIT = 500 (Supabase에서 가져오는 raw article 상한)
- MIN_COHESION_SCORE = 20 (normalize 후검증)
- MIN_ENTITY_WEIGHT_SUM = 0.6 (Stage 1 통과 기준)
- STAGE2_DEFAULT_COHESION = 50 (Stage 2 승인 시 강제 부여)

### 거절 규칙(시스템 프롬프트로 강제)

- 카테고리 단어만으로는 절대 승인 금지: festival, synth, preview, release, new music, house, techno, club, lineup 등
- 매체명/사이트명/시리즈명 묶음 금지
- 연도 단독(2025, 2026 등) 묶음 금지
- 인터뷰 형식 표현(catches up with, chats to, talks to 등) 묶음 금지
- 연말 결산/차트/베스트 목록 묶음 금지
- 모든 소스를 동등하게 취급

### 현재 미구현/주의

- raw article의 사용 여부(is_used 같은 컬럼)는 없다. 같은 article이 여러 번 Stage 1 후보로 반복될 수 있다. 향후 `suggested_clusters.article_ids`에 이미 들어간 raw article을 제외하는 dedupe가 필요할 수 있다.

## 8. 기사 생성 정책

`/api/generate`는 클러스터에 묶인 원문들을 정제해서 Ollama 모델(env-driven, 현재 mistral-small3.2:24b)에 전달한다.

LLM 입력에 포함되는 정보:

- 매체명
- 발행일 (한국어 'YYYY년 M월 D일' 포맷으로 정규화 후 주입)
- 원문 제목
- 원문 URL
- 정제된 원문 내용

LLM이 반환해야 하는 JSON 5개 필드: `title`, `content`, `slug`, `category`, `genre`.

- `slug`: 영문 소문자+하이픈만, 30자 이내. 핵심 키워드 기반. 정규화 후 DB 중복 검사 → `-2`, `-3` 식 suffix로 유일화. 빈 값/실패 시 `article-{timestamp}` fallback.
- `category`: `페스티벌`/`아티스트`/`릴리즈`/`뉴스`/`인터뷰` enum. enum 외 값은 default `뉴스`.
- `genre`: 영문 소문자, EDM 장르(house, techno, trance, drum-and-bass, dubstep, ambient, experimental, hardstyle, future-bass, big-room 등) 중 하나. 미상 시 `edm`.

검증 정책:

- 생성 결과가 너무 짧으면 실패
- 한국어 비율이 낮으면 실패
- Login, Search, Share, Previous article 등 원문 페이지 잡음이 남아 있으면 실패
- 실패 시 한 번 재시도

프롬프트 정책 (`lib/prompts.ts` SYSTEM_PROMPT_A):

- 한국어 기사 작성
- 원문 그대로 복사 금지
- `오늘`, `어제`, `최근`, `며칠 전` 같은 상대 날짜 표현 금지
- 날짜가 필요하면 원문의 구체 날짜를 사용
- 발표/공개/발매 시점 언급 시에는 소스 발행일을 본문에 자연스럽게 녹임 (예: "2026년 3월 12일 신곡 'XYZ'를 공개했다")
- 소스 발행일이 없거나 불명확하면 시점 표현 자체를 생략 (추측 날짜 금지)

고유명사 표기 규칙(엄격 강화됨):

- 기본 원칙: 영어 아티스트명/곡명/앨범명/EP명/레이블명/페스티벌명/클럽명/믹스명/행사명은 영문 원문 그대로 표기.
- 아티스트/곡/앨범/레이블 예외: 한국에서 이미 정착된 표기에 한해 한국어 사용 가능. 예: Martin Garrix → 마틴 게릭스, Calvin Harris → 칼빈 해리스, David Guetta → 데이비드 게타, Skrillex → 스크릴렉스, deadmau5 → 데드마우스, Tomorrowland → 투모로우랜드, Ultra → 울트라, Coachella → 코첼라.
- 도시명/국가명 예외: 본문에서 단독 지칭 시 한국어 표기. Dublin → 더블린, Amsterdam → 암스테르담, Berlin → 베를린, London → 런던, Paris → 파리, New York → 뉴욕, Ibiza → 이비자, Chicago → 시카고, Tokyo → 도쿄, Seoul → 서울. 단, 도시명이 고유명사의 일부일 때(예: 'GU49: Dublin', 'Boiler Room Berlin', 'ADE Amsterdam')는 영문 그대로 유지.
- 절대 금지: 임의로 한글 발음을 만들어 붙이는 행위. Anyma→아니마, John Summit→존 서밋, Dom Dolla→돔 돌라, Anjunabeats→안준비츠, KSHMR→캐슈머, Fred again..→프레드 어게인, Deep Dish→디프 디시, Moderat→모더랫, GU49: Dublin→GU49: 더블린 등 새 음역 금지.
- 곡명/앨범명/EP명/믹스명은 작은따옴표로 감싼 원문 그대로 표기. 예: 'Animals', 'A State of Trance 2026', 'GU49: Dublin'.
- 영문/한글 병기(예: "Martin Garrix(마틴 게릭스)") 금지. 둘 중 하나만 사용.
- 애매하면 영문 사용 (안전판).
- `app/api/generate/route.ts`의 user prompt에도 SYSTEM_PROMPT_A를 따르라는 cross-reference를 박아 system/user 양쪽에서 동일 규칙이 전달되도록 정렬.

## 9. Cloudflare Pages 배포

### 빌드

Cloudflare Pages 설정:

- Build command: `npm run build:static`
- Build output directory: `out`
- Environment variables:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Cloudflare에는 넣지 않아도 되는 것:

- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`
- `SUGGEST_MODEL`
- `ADMIN_PASSWORD`
- `CLOUDFLARE_DEPLOY_HOOK_URL`
- `BUILD_STATIC`

### 자동 재빌드

다음 두 경로 모두 Cloudflare Pages 재빌드를 fire-and-forget 트리거한다:

1. **최초 게시:** `/api/articles/[id]/publish` (PATCH)가 Supabase에 `published=true`, `published_at=now()` 업데이트 → `CLOUDFLARE_DEPLOY_HOOK_URL`로 POST.
2. **게시 후 수정:** `/api/articles/[id]` (PATCH)가 기존 `published=true` 기사에 적용되면, `title/content/updated_at=now()` 업데이트 후 동일 deploy hook 트리거.

Cloudflare Pages는 매 호출마다 새 빌드를 실행한다. 짧은 시간에 여러 번 수정하면 빌드가 누적되니 주의.

### 어드민 배포 관련 현재 판단

정적 export 사이트에 `/admin`을 포함하면 proxy 인증이 적용되지 않는다. 그래서 아무나 `/admin` HTML을 볼 수 있다.

현재 상태: `scripts/build-static.mjs`의 stash 목록에 `app/admin`이 포함돼 있어 배포본에는 `/admin`이 존재하지 않는다.

가능한 다른 선택지:

- 배포본에 `/admin` UI를 포함하고 싶다면 Cloudflare Access로 `/admin*` 보호
- 클라이언트 비밀번호 화면은 실수 방지용일 뿐 진짜 보안은 아님
- 배포본에서 실제 어드민 기능까지 동작시키려면 SSG만으로는 부족하고, Cloudflare Functions/Workers 또는 별도 API 서버가 필요

## 10. 환경 변수

### 로컬 `.env.local`

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `OLLAMA_BASE_URL=http://localhost:11434` (운용 환경에 따라 변경. WSL에서 Windows Ollama 사용 시 WSL 게이트웨이 IP 필요)
- `OLLAMA_MODEL=mistral-small3.2:24b` (생성/제안 공용 기본 모델. 미설정 시 `qwen3:14b`)
- `ADMIN_PASSWORD`
- `CLOUDFLARE_DEPLOY_HOOK_URL`
- `SUGGEST_MODEL` 선택. suggest-clusters 전용 모델 오버라이드. 미설정 시 `OLLAMA_MODEL`에 폴백, 그 다음 `qwen3:14b`.
- `CRON_SECRET` 선택

### Cloudflare Pages

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 11. 남은 주요 의사결정 / 다음 작업

### 배포/보안

- Cloudflare 배포본에서 `/admin`을 완전히 제외할지, Cloudflare Access로 보호하며 포함할지 결정
- 현재처럼 로컬 어드민만 사용할 경우, 공개 헤더에서 어드민 링크는 숨기는 것이 맞다.

### URL 구조 (구현 완료)

- `app/articles/[slug]/page.tsx` 라우팅 적용. slug 우선 조회, UUID 패턴이면 id로 fallback.
- 기사 생성 시 LLM이 slug 산출 → DB 중복 검사 후 unique suffix.
- 공개 홈(`app/page.tsx`)의 기사 링크는 `slug ?? id`. 어드민의 검토 링크는 UUID 그대로 (UUID fallback으로 동작).
- 단, 정적 export 빌드본에서는 slug가 있는 기사의 UUID URL은 prerender되지 않아 404. dev 모드에서만 fallback 동작.

### 카테고리/네비게이션

- 네비게이션: 홈 | 페스티벌 | 아티스트 | 릴리즈 | 뉴스 | 인터뷰 | 장르별 ▾. 현재 모두 더미 링크(`href: "#"`). 실제 카테고리 페이지/필터링은 미구현.
- 기사 생성 시 `category` (5-way enum)와 `genre` (영문 소문자) 자동 태깅 완료.
- 남은 작업: `/category/[slug]`, `/genre/[slug]` 같은 카테고리/장르별 페이지 라우트 + 필터링 UI.
- `tags` 컬럼 미사용 — 향후 활용 여지.

### 기사 수정 (구현 완료)

- 게시 전 수정/삭제 구현됨.
- 게시 후 수정도 구현됨. `updated_at` 컬럼 활용. 수정 시 자동 재빌드 트리거. DELETE는 여전히 게시본 차단.

### 데이터 정리

- 과거 `raw_articles.title`이 URL 형태로 저장된 데이터는 backfill API로 재추출 가능
- 테스트로 생성된 기사/클러스터/제안 데이터 정리 필요

### SQL 정리

- `supabase-planned-migrations.sql`은 현재 스키마 방향에 맞춰 적용 전 정리 필요
- 최소 확인 대상:
  - `articles.published_at`
  - 향후 `slug/category/genre/tags`
  - `suggested_clusters` RLS policy

## 12. 알려진 이슈

- Cloudflare 정적 export에서는 proxy/API가 실행되지 않는다.
- 정적 배포에 `/admin`이 포함되면 인증 없이 HTML이 노출된다 (현재 stash로 제외 중).
- `npm run dev`와 `npm run build:static` 둘 다 `--webpack` 강제. Next 16.2 Turbopack은 `output:'export'`를 silently 무시해 `out/`이 생성되지 않는다.
- `app/api/admin/login`의 rate limit은 in-memory라 dev 서버 재시작 시 초기화된다.
- 일부 RSS 소스는 계속 실패할 수 있다. Beatportal/Resident Advisor는 수동 URL ingest가 더 현실적이다.
- JS 렌더링 의존 사이트는 본문 추출 품질이 낮을 수 있다.
- `OLLAMA_MODEL`로 지정된 모델이 Ollama 인스턴스에 pull돼 있지 않으면 generate/suggest-clusters 양쪽 모두 첫 호출에서 `model not found` 에러. fallback 안 함. 모델 교체 시 `ollama pull <model>` 먼저.
- 현재 `rss_sources` 행 수 = 42. 직전 16개 신규 소스 INSERT SQL 중 일부만 적용된 상태(이전 35 + 신규 7). 나머지 9개는 url unique 충돌이거나 SQL 실행이 부분 적용으로 끝난 것으로 추정.
- suggest-clusters에 raw article 중복 처리 방지 로직이 없다. 같은 article이 매번 후보로 다시 잡힐 수 있다.
- 게시 후 수정 시 Cloudflare deploy hook이 매번 트리거된다. 짧은 시간에 여러 번 수정하면 빌드 큐가 누적될 수 있다. debounce 미구현.
- 정적 export 빌드본에서 slug-있는 기사의 UUID URL은 prerender되지 않아 404. 옛 UUID 외부 링크를 유지해야 한다면 redirect 로직이 별도 필요.
- `slug` 컬럼은 한 번 생성된 후 PATCH로 변경되지 않는다. 한국어 토픽이 바뀌어도 URL은 고정. 의도된 동작.
