# 투아라 (Today Artist Life) - 현재 프로젝트 컨텍스트

이 문서는 프로젝트 상태를 웹 Claude/ChatGPT와 공유하기 위한 브리핑이다. 세부 구현을 전부 설명하기보다, 현재 구조와 중요한 판단을 빠르게 이해하는 것이 목적이다.

최종 갱신: 2026-05-27.

## 1. 프로젝트 목적

해외 아티스트/셀럽 전반(팝, 케이팝, 힙합, 영화/TV, 패션, 라이프스타일 등) 관련 소스(RSS, 개별 URL, SNS/포스터 이미지)를 바탕으로 한국어 아티스트/가십 뉴스 기사를 생성하고, 사람이 검토한 뒤 `todayartistlife.com`에 게시한다.

현재 기사 생성 경로는 세 가지다.

1. **RSS/URL 기반**
   - RSS 또는 URL로 원문 기사 수집
   - 자동 토픽 제안 또는 수동 클러스터 생성
   - 클러스터 기반 한국어 기사 초안 생성
   - 사람이 수정/삭제/게시

2. **이미지/SNS 기반**
   - SNS 캡처/포스터 이미지 1개 업로드
   - Vision LLM이 원본 전체 이미지를 분석
   - 분석 결과 확인
   - 선택적으로 기사 이미지 영역 크롭
   - 이미지 1개를 근거로 기사 초안 1개 생성
   - 사람이 수정/삭제/게시

3. **인터뷰 번역 기반**
   - `raw_articles` 중 인터뷰/피처로 추정되는 원문 후보 발굴
   - Claude API로 한국어 인터뷰 번역 기사 초안 생성
   - 사람이 수정/삭제/게시

## 2. 현재 아키텍처

### 로컬 어드민

- `npm run dev`로 로컬 Next.js 실행
- Next.js 16.2.6이며 dev/build 모두 webpack 사용
- `/admin`에서 수집, 분석, 기사 생성, 검토, 게시 수행
- Ollama는 로컬에서만 사용
- Supabase에 원문, 이미지 소스, 기사 초안, 게시 기사 저장
- `/admin/*`은 로컬에서 `proxy.ts`와 쿠키 세션으로 보호

### 공개 사이트

- `todayartistlife.com`
- Cloudflare Pages static export
- 공개 사이트는 Supabase에서 `articles.published = true` 기사만 빌드 타임에 읽어 정적 HTML로 생성
- 배포본에는 Ollama, API routes, proxy, admin UI가 없다
- 현재 `scripts/build-static.mjs`가 정적 빌드 전에 `app/admin`, `app/api`, `proxy.ts`를 stash로 제외한다

## 3. 기술 스택

- Next.js 16.2.6 App Router (`next dev --webpack`, `next build --webpack`)
- React 19.2.4
- Tailwind CSS 4
- Supabase PostgreSQL + Storage (`@supabase/supabase-js`)
- Ollama (로컬 LLM)
- Anthropic Claude API (인터뷰 번역)
- Cloudflare Pages static export
- `react-image-crop` 11 (어드민 이미지 크롭 UI)
- `rss-parser` 3 (RSS 수집)
- `bot/`은 별도의 mini Node 프로젝트로 `grammy` 기반 텔레그램 봇이 들어 있다. `tsx index.ts`로 실행. 메인 Next.js 앱과는 의존성 분리.

주의:

- Next.js 16에서는 `middleware.ts` 대신 `proxy.ts`를 사용한다.
- 동적 route handler의 `params`는 Promise다.
- 정적 export에서는 API route/proxy가 실행되지 않는다.
- Turbopack은 이 프로젝트의 static export에서 문제가 있어 dev/build 모두 `--webpack`을 강제한다.
- `app/admin`, `app/api`, `proxy.ts`는 정적 빌드에서 stash로 제거한 뒤 빌드된다.

## 4. 환경 변수

로컬 `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `OLLAMA_BASE_URL` (미설정 시 `http://localhost:11434`)
- `OLLAMA_MODEL` (일반 기사 생성 기본 모델. 미설정 시 코드 default는 `qwen3:14b`)
- `OLLAMA_GENERATE_MODEL` (RSS/URL 기사 생성 전용. 미설정 시 `OLLAMA_MODEL`로 폴백)
- `OLLAMA_SUGGEST_MODEL` (자동 토픽 제안 전용. 미설정 시 `OLLAMA_MODEL`로 폴백)
- `OLLAMA_VISION_MODEL` (이미지 분석 전용. 미설정 시 `OLLAMA_MODEL`, 그 다음 `mistral-small3.2:24b`로 폴백)
- `OLLAMA_INTERVIEW_MODEL` (AGENTS.md에 남아 있으나 현재 인터뷰 route는 Claude API 사용)
- `CLAUDE_API` (인터뷰 번역용 Anthropic API key)
- `ADMIN_PASSWORD` (proxy.ts에서 필수. 미설정 시 /admin/* 접근 시 500)
- `CLOUDFLARE_DEPLOY_HOOK_URL`
- `CRON_SECRET` (선택. 설정 시 `/api/cron`에 `Authorization: Bearer` 필수)

Cloudflare Pages:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Cloudflare 배포본에는 `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `ADMIN_PASSWORD`가 필요 없다.

## 5. 주요 DB/Storage

### `rss_sources`

RSS 소스 목록.

### `raw_articles`

RSS/URL로 수집된 원문 기사.

주요 컬럼:

- `id`
- `title`
- `content`
- `url`
- `image_url`
- `source_id`
- `published_at`
- `suggestion_state`: 원문 기사의 처리 상태 및 라이프사이클
  - `null` / `new`: 신규 수집되었거나, 제안/초안 단계에서 삭제(거절)되어 후보로 다시 돌아온 상태 (제안 및 인터뷰 발굴 대상)
  - `suggested`: 자동 토픽 제안(클러스터)에 묶여 승인 대기 중인 상태
  - `used`: 기사가 생성되고 최종적으로 '게시(publish)' 처리되어 소비가 완료된 상태
  - `rejected`: 인터뷰 후보 등에서 사용자가 명시적으로 '기각'하여 버린 상태
  - `ignored`: 어드민 제안 목록 등에서 사용자가 명시적으로 무시/숨김 처리하여 기사화 후보에서 제외된 상태

### `article_clusters` / `cluster_articles`

RSS/URL 기사들을 토픽별로 묶는 클러스터 구조.

### `suggested_clusters`

자동 토픽 제안 저장 테이블.

`status`:

- `pending`: 검토 전
- `approved`: 승인 처리 중
- `rejected`: 거절
- `published`: 제안 승인 후 기사 초안 생성 완료

주의: 여기서 `published`는 공개 게시가 아니다. 공개 게시 여부는 `articles.published`.

### `articles`

생성된 한국어 기사.

주요 컬럼:

- `id`
- `title`
- `content`
- `cluster_id`
- `image_url`
- `published`
- `published_at`
- `updated_at`
- `created_at`
- `slug`
- `category`
- `genre`

이미지 우선순위:

1. `articles.image_url`
2. 없으면 `cluster_id → cluster_articles → raw_articles.image_url`
3. 없으면 본문 markdown 이미지

이미지/SNS 기반 기사는 `articles.image_url`에 직접 이미지가 저장된다.

인터뷰 번역 기반 기사는 `cluster_id` 없이 생성되며, 원문 `raw_articles.image_url`을 `articles.image_url`로 복사한다. 신규/수정 코드에서는 최신 taxonomy(`news`/`event`/`artist`)와 투아라의 아티스트/셀럽 종합 미디어 방향에 맞춰 저장값을 유지해야 한다.

### `image_sources`

이미지/SNS 기반 기사 생성을 위한 소스 테이블.

주요 컬럼:

- `id`
- `image_url`
- `image_path`
- `source_memo`
- `source_date`
- `extracted_text`
- `generated_article_id`
- `status`
- `created_at`

`generated_article_id`는 `articles.id`를 참조한다. 기사 삭제 시 참조를 `null`로 풀어야 전제된다. DB FK는 가능하면 `on delete set null` 권장.

### Supabase Storage

Bucket:

- `image-sources`

용도:

- 이미지/SNS 원본 저장
- 크롭된 기사용 이미지 저장
- 기사 이미지 교체용 이미지 저장

### `entities` / `article_entities`

아티스트/셀럽 엔터티 사전 및 기사-엔터티 연결 테이블.

- 로컬 JSON: `lib/entities/artists.json`, `lib/entities/celebrities.json`
- 동기화 스크립트: `npm run sync-entities`
- `entities.aliases text[]` 컬럼은 `supabase/migrations/20260526000000_entities_aliases.sql`에 추가됨
- RSS/URL 기사 생성 시 LLM이 반환한 `entities` 또는 본문 fallback 매칭을 이용해 `article_entities`에 연결
- 기사 상세 페이지는 `article_entities → entities`를 읽어 아티스트/셀럽 태그를 표시

### `system_settings`

현재 Cloudflare Deploy Hook 디바운스 상태 저장에 사용된다.

- key: `deploy_hook_last_sent`
- `lib/deploy-hook.ts`가 마지막 발송 시각 기준 3분 이내 중복 훅을 스킵한다.

## 6. 주요 파일

### 공개 사이트 및 코어 로직

```txt
app/layout.tsx
  헤더/네비게이션/푸터 공통 레이아웃. CATEGORY_NAV로 네비 구성.
  BUILD_STATIC=1일 때 헤더의 "어드민" 링크를 숨긴다.

app/page.tsx
  공개 홈. published 기사 목록과 인기 기사(상위 5) 사이드바.

app/articles/[slug]/page.tsx
  기사 상세. slug 우선 조회, UUID fallback.

lib/articles.ts
  published 기사 로딩, 카테고리/장르 필터, 이미지 fallback 처리.

lib/taxonomy.ts
  CATEGORY_NAV 정의. slug ↔ label ↔ alias 매핑.

lib/display-names.json
  아티스트들의 고유명사 한글화/영문 유지 매핑 규칙 데이터 (Top 200 수준).
  LLM 생성 시 프롬프트 주입 및 사후 치환(Post-processing) 기준으로 사용됨.

lib/entities/artists.json
lib/entities/celebrities.json
  아티스트/셀럽 엔터티 사전. name, korean_name, type, aliases 구조.

lib/deploy-hook.ts
  CLOUDFLARE_DEPLOY_HOOK_URL 호출. system_settings 기반 3분 디바운스 적용.
```

### 어드민

```txt
app/admin/page.tsx
  로컬 어드민 UI (단일 파일, RSS/이미지/인터뷰 그룹 탭).

app/api/admin/login/route.ts
  ADMIN_PASSWORD 검증, 쿠키 발급.

proxy.ts
  Next.js 16 proxy. 로컬 /admin 보호.
```

### 기사 수집 및 생성 파이프라인

```txt
app/api/collect/route.ts
  RSS 수집과 URL 직접 추가.

app/api/suggest-clusters/route.ts
  자동 토픽 제안. 엔터티 매칭 + LLM 가치 평가 구조.

app/api/cluster/route.ts
  수동/자동 클러스터 생성.

app/api/generate/route.ts
  클러스터 기반 한국어 기사 생성.
  *최근 업데이트*: lib/entities JSON을 읽어 표기 규칙을 주입하고, LLM 응답에 대해 applyDisplayNameMapping 함수로 사후 교정(치환) 수행.
  생성 후 entities/article_entities 연결까지 수행.
```

### 이미지/SNS 파이프라인

```txt
app/api/image-sources/analyze/route.ts
  이미지 원본을 Storage에 저장하고 Vision LLM으로 전체 이미지 분석.

app/api/image-sources/[id]/generate/route.ts
  image_sources.extracted_text 기반 기사 초안 생성.
```

### 인터뷰 번역 파이프라인

```txt
app/api/interview/translate/route.ts
  raw_articles 원문을 가져와 Claude API로 한국어 인터뷰 번역 초안 생성.
  content가 수집 단계에서 잘렸을 가능성이 있으면 원 URL을 재fetch.
  display-names.json 기반 사후 치환 및 원문 출처 disclaimer 추가.

app/api/raw-articles/[id]/route.ts
  인터뷰 후보 기각 시 suggestion_state 업데이트.
```

## 7. 어드민 UI 현재 구조

`app/admin/page.tsx` 한 파일에 모든 탭이 있다. 최상단 토글로 그룹 선택 → 그룹별 TabBar.

### 그룹 1: RSS 및 URL 기반 기사 생성

1. RSS 수집
2. URL 직접 추가
3. 자동 토픽 제안
4. 생성 기사 검토
5. 클러스터 (수동)
6. 기사 생성 (수동)

### 그룹 2: 이미지 소스 및 SNS 기반 기사 생성

1. 이미지 소스 추가 (업로드 → Vision 분석 → 크롭 → 기사 생성)
2. 생성 기사 검토 (수정/게시/이미지 교체)

### 그룹 3: 인터뷰 번역

1. 인터뷰 후보 발굴 (`raw_articles`에서 interview/feature/talks 패턴 검색)
2. 생성 기사 검토

## 8. Vision 분석 프롬프트

위치: `app/api/image-sources/analyze/route.ts`

- 제외 대상: 상태바, 좋아요, 팔로우 등 SNS UI 잡음
- 추출 대상: 아티스트명, 날짜, 장소, 라인업 등 팩트
- 정책: 분석은 크롭하지 않은 원본 전체로, 기사용 이미지만 크롭

## 9. 기사 생성 정책

### 공통 프롬프트 정책 (`lib/prompts.ts` 및 자동 주입 규칙)

- 한국어 기사체, 5~10문장
- 상대 날짜 표현 금지
- **고유명사 표기 규칙**:
  - 영어 인물명/아티스트명은 기본적으로 영문 유지. 임의 한글 음역 절대 금지.
  - 예외적으로 `lib/display-names.json`에 정의된 정착된 표기만 한글화.
  - 도시명 단독 등장 시 한글 표기, 그 외 고유명사 일부일 땐 영문 유지.
  - RSS/URL 경로는 매칭된 `lib/entities` 항목을 프롬프트에 주입하고, 생성 완료 후 텍스트에도 사후 치환(Post-processing)을 적용함.
  - 인터뷰 경로는 `lib/display-names.json`을 프롬프트에 주입하고 사후 치환을 적용함.
- **분류 규칙**:
  - 최신 taxonomy 기준 category slug는 `news` / `event` / `artist`
  - 표시 라벨은 `뉴스` / `공연` / `아티스트`
  - 현재 공개 카테고리 라우트는 `/category/[category]`만 사용하며 genre 라우트는 제거됨

### RSS/URL 기반 (`app/api/generate/route.ts`)

- `validateKoreanArticle`로 길이, 한글 비율(30% 이상), 원문 잡음 패턴(Login/Share 등) 검증.
- 실패 시 1회 재시도 로직 포함.

### 이미지/SNS 기반 (`app/api/image-sources/[id]/generate/route.ts`)

- 단일 소스 → 단일 기사 (클러스터 없음)
- Ollama `format: 'json'` 모드 사용.

### 인터뷰 번역 기반 (`app/api/interview/translate/route.ts`)

- raw article 1개 → 번역 기사 초안 1개
- 현재 Anthropic SDK로 `claude-sonnet-4-20250514` 모델을 직접 호출한다.
- `SYSTEM_PROMPT_B`는 현재 빈 문자열이다.
- 번역문 말미에 원문 매체/발행일/URL disclaimer를 추가한다.

## 10. 자동 토픽 제안 정책

코드 기반 후보 생성(엔터티 사전 매칭) 후 LLM(Ollama)이 기사 가치를 평가해 승인/거절을 판단한다. 중복 기사 필터링 및 수동 추가된 차단 키워드(blocklist) 필터를 거친다.

## 11. Cloudflare 배포

정적 사이트(HTML/CSS/JS)만 빌드하여 배포. `articles.published = true`인 데이터만 가져온다.
배포본에는 어드민이나 API가 제외된다. 기사 게시/수정/이미지 교체 시 로컬 API에서 `CLOUDFLARE_DEPLOY_HOOK_URL`로 훅을 날려 재빌드를 유발한다. 현재 `lib/deploy-hook.ts`에 3분 디바운스가 적용되어 있다.

## 12. 현재 완료된 것

- RSS/URL 파이프라인 (수집 → 제안 → 클러스터 → 기사 생성)
- 이미지/SNS 파이프라인 (Vision 분석 → 기사 생성)
- 인터뷰 번역 파이프라인 (후보 발굴 → Claude 번역 → 기사 초안)
- 생성 기사 관리 (검토, 게시, 수정, 이미지 크롭/교체)
- 정적 배포 및 Deploy Hook 연동/디바운스
- SEO (slug URL, sitemap, llms.txt 등)
- 텔레그램 봇 기반 원격 어드민 제어 (grammy)
- **아티스트 고유명사 한글/영문 매핑 (`lib/display-names.json`) 사전 프롬프트 주입 및 사후 교정(Post-processing) 적용**
- **투아라 브랜딩 및 Taxonomy 적용** (아티스트/셀럽 라이프·가십 종합 미디어 기준)
- **엔터티 사전/alias 동기화 및 article_entities 연결**

## 13. 남은 작업 / 주의점

- **보안**: `bot/index.ts`에 텔레그램 토큰이 하드코딩되어 있음 (환경변수 분리 필요).
- **보안**: `app/api/interview/translate/route.ts`는 `CLAUDE_API` 누락 시 명확한 사전 에러 없이 SDK 호출 단계에서 실패할 수 있음.
- **보안**: `proxy.ts`는 `/api/*` 경로를 보호하지 않음 (로컬 환경 가정).
- 기사 생성 시 동일 raw article 중복 사용 추적(`is_used`) 부재.
- Vision 프롬프트 품질 고도화 및 생성 결과에 대한 `validateKoreanArticle` 수준의 검증 부재.
- 사용하지 않는 이미지 원본/크롭 파일들의 주기적인 Storage 정리 정책 부재.
- 투아라 전환 후 남은 레거시 브랜딩/분류 문자열은 발견 시 투아라 기준으로 정리한다.
  - `app/articles/[slug]/page.tsx` metadata fallback/title/description
  - `scripts/generate-static-files.mjs`의 기본 SITE_URL, `CATEGORY_SLUGS`, `llms.txt` 문구
  - 인터뷰 번역 생성값이 최신 taxonomy(`news`/`event`/`artist`)와 맞는지 확인
  - 기사 상세 카테고리 배지 상수와 표시 라벨이 투아라 taxonomy와 맞는지 확인

## 14. API 시그니처 (간략 요약)

- `POST /api/admin/login`: 어드민 로그인 및 세션 쿠키 발급
- `GET/PATCH/DELETE /api/articles`: 게시물 목록/수정/삭제 (`PATCH .../publish`, `PATCH .../image` 등 배포 훅 유발)
- `POST /api/collect`, `POST /api/cluster`, `POST /api/generate`: RSS/URL 수집 및 생성 파이프라인
- `GET/POST/PATCH /api/suggest-clusters`, `GET/POST/PATCH/DELETE /api/topic-suggestion-blocklist`: 토픽 제안 및 관리
- `POST /api/image-sources/analyze`, `POST /api/image-sources/[id]/generate`: 이미지/SNS 파이프라인
- `POST /api/interview/translate`: 인터뷰 원문 번역 기사 초안 생성
- `PATCH /api/raw-articles/[id]`: raw article 처리 상태 변경
- `GET/POST /api/cron`: 스케줄러 기반 자동 수집 트리거

## 15. 명령어
```bash
npm run dev
npx tsc --noEmit
npx eslint [수정한 코드 파일]
npm run build:static
npm run sync-entities
```

터미널 1: npm run dev:all (Next.js + Worker)
터미널 2: cd bot && npm start (텔레그램 봇)