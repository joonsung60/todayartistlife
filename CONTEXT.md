# 투아라 (Today Artist Life) - 현재 프로젝트 컨텍스트

이 문서는 프로젝트 상태를 웹 Claude/ChatGPT 및 CLI 에이전트와 공유하기 위한 브리핑이다. 세부 구현을 전부 설명하기보다, 현재 구조와 중요한 판단, 그리고 마이그레이션 과도기 상태를 빠르게 이해하는 것이 목적이다.

최종 갱신: 2026-06-14.

## 1. 프로젝트 목적

해외 아티스트/셀럽 전반(팝, 케이팝, 힙합, 영화/TV, 패션, 라이프스타일 등) 관련 소스(RSS, 개별 URL, SNS/포스터 이미지)를 바탕으로 한국어 아티스트/가십 뉴스 기사를 생성하고, 사람이 검토한 뒤 `todayartistlife.com`에 게시한다.
*참고: 과거 "EDM Star News"에서 "투아라 (Today Artist Life)" 종합 미디어로 피벗(Pivot)하였으며, 코드베이스 곳곳에 레거시 네이밍이 남아있어 점진적 전환을 진행 중이다.*

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
- Next.js 16.2.6이며 dev/build 모두 webpack 사용 (Turbopack 금지)
- `/admin`에서 수집, 분석, 기사 생성, 검토, 게시 수행
- Ollama는 로컬에서만 사용
- 원문, 기사 초안, 게시 기사 데이터는 Supabase에 저장
- 이미지 저장소는 Supabase Storage에서 **Cloudflare R2**로 마이그레이션 진행 중
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
- Cloudflare R2 (이미지 스토리지 전환 중, `@aws-sdk/client-s3`)
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

- **Supabase**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_ACCESS_TOKEN` (에이전트용)
- **Ollama**: `OLLAMA_BASE_URL` (기본 `http://localhost:11434`), `OLLAMA_MODEL`, `OLLAMA_GENERATE_MODEL`, `OLLAMA_SUGGEST_MODEL`, `OLLAMA_VISION_MODEL`
- **Claude**: `CLAUDE_API` (인터뷰 번역용 Anthropic API key)
- **Cloudflare R2**: `CLOUDFLARE_R2_ENDPOINT`, `CLOUDFLARE_USER_R2_ACCESS_KEY_ID`, `CLOUDFLARE_USER_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET_NAME`, `CLOUDFLARE_R2_PUBLIC_URL`
- **Admin & Deploy**: `ADMIN_PASSWORD` (proxy.ts 필수), `CLOUDFLARE_DEPLOY_HOOK_URL`, `CRON_SECRET`

Cloudflare Pages 환경 변수:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- (배포본에는 OLLAMA_*, ADMIN_PASSWORD, R2 키 등이 필요 없다)

## 5. 주요 DB/Storage

### `rss_sources` & `raw_articles`
- `rss_sources`: RSS 소스 목록. (최근 tier, source_type, language, region 등 신뢰도 기반 컬럼 확장 및 데이터 정비 계획 있음)
- `raw_articles`: 수집된 원문 기사 (`suggestion_state`: null/new, suggested, used, rejected, ignored 라이프사이클 관리)

### `article_clusters`, `cluster_articles`, `suggested_clusters`
- RSS/URL 기사들을 토픽별로 묶는 클러스터 관리
- `suggested_clusters.status`: pending, approved, rejected, published (공개 게시가 아닌, 초안 생성 완료를 의미)

### `articles`
생성된 한국어 기사.
- 상태 및 URL: `published`, `slug`
- 분류 (신규 Taxonomy): `category` (news / event / artist)
- 이미지 폴백: `articles.image_url` → `cluster_articles` 원문 이미지 → 마크다운 첫 이미지

### `entities` / `article_entities`
아티스트/셀럽 엔터티 사전 및 기사-엔터티 연결 테이블.
- `lib/entities/*.json` 사전을 기반으로 `npm run sync-entities`로 DB 동기화
- `entities.aliases` 컬럼을 활용하여 기사 생성 프롬프트 주입 및 매칭 강화
- 상세 페이지에서 기사에 등장하는 아티스트 태그 표시

### 이미지 스토리지: R2 마이그레이션
- **기존 (Supabase Storage)**: `image-sources` 버킷. (이미지 분석/크롭 결과 저장)
- **신규 (Cloudflare R2)**: `todayartistlife-images` 버킷. `lib/r2.ts`를 통해 연동.
- **향후 계획 (`image-system.md`)**: 다중 이미지, 외부 API(DuckDuckGo 등) 검색 연동, AI 생성 이미지 등을 포괄하기 위해 `images`, `article_images`, `entity_images` 스키마로 확장 예정.

## 6. 주요 파일

### 공개 사이트 및 코어 로직
- `app/layout.tsx`: 공통 레이아웃. CATEGORY_NAV로 네비 구성.
- `app/page.tsx`: 공개 홈. 레거시 뱃지(`페스티벌`, `릴리즈`) 코드가 남아있어 향후 투아라 분류(`공연`, `뉴스`)로 교체 필요.
- `app/articles/[slug]/page.tsx`: 기사 상세 (slug 우선, UUID fallback).
- `lib/articles.ts`: 기사 로딩, 폴백, R2/Supabase 이미지 URL 처리.
- `lib/taxonomy.ts`: **신규 Taxonomy 단일 진실원**. slug(news/event/artist) ↔ label ↔ alias 매핑 관리.
- `lib/display-names.json`: 아티스트 고유명사 한글화/영문 유지 매핑 규칙 데이터. 프롬프트 주입 및 사후 교정에 사용.
- `lib/r2.ts`: Cloudflare R2 연동 로직. (RSS 이미지 저장 등 처리)
- `lib/deploy-hook.ts`: `system_settings` 활용하여 3분 디바운스 적용된 Cloudflare 배포 훅.

### 수집/분석/생성 파이프라인 API (`app/api/*`)
- `/api/collect`, `/api/suggest-clusters`, `/api/cluster`, `/api/generate`: RSS 수집, 제안, 클러스터 기반 기사 생성. (`display-names.json` 사후 치환 포함)
- `/api/image-sources/*`: 이미지 원본 R2/Supabase 저장, Vision LLM 분석 및 텍스트 추출 기반 생성.
- `/api/interview/translate`: Claude API(`claude-sonnet-4-20250514`)를 통한 인터뷰 번역. Disclaimer 주입.

## 7. 어드민 UI
`/admin/page.tsx`의 단일 파일 기반 탭 구조.
- 그룹 1: RSS/URL 기사 수집, 토픽 제안, 클러스터링 및 생성
- 그룹 2: 이미지/SNS 캡처 원본 업로드, Vision 분석, 크롭 및 단일 기사 생성
- 그룹 3: 인터뷰 번역 (raw_articles 필터링, Claude 번역)

## 8. 기사 생성 및 프롬프트 정책
- 한국어 기사체, 5~10문장, 상대 날짜 사용 금지.
- **고유명사 규칙 (`display-names.json`)**: 영문 이름/아티스트명 영문 유지가 원칙이나, 확립된 한글 표기는 사전에서 찾아 프롬프트 주입 및 생성 후 치환.
- **분류 규칙**: `lib/taxonomy.ts`에 따라 `news` / `event` / `artist` 로만 분류.
- **검증**: `validateKoreanArticle` 함수로 길이, 한글 비율(30%), 노이즈 텍스트 포함 여부 검증 및 실패 시 재시도.
- **Vision 프롬프트 (`/api/image-sources/analyze/route.ts`)**: 전체 원본 분석으로 상태바/UI 잡음 배제하고 아티스트명, 팩트 중심 추출.

## 9. 현재 완료된 작업
- "Today Artist Life" 기반의 신규 분류(`taxonomy.ts`), 엔터티 사전 매핑, 고유명사 치환 파이프라인.
- RSS/이미지/인터뷰 3가지 기사 생성 및 검토 파이프라인 통합.
- R2(`lib/r2.ts`) 도입 및 RSS 이미지 페치 자동화 초기 단계.
- Cloudflare Pages 정적 배포 파이프라인 및 디바운스 배포 훅 연동.
- 텔레그램 봇 기반 원격 제어 (`bot/`).

## 10. 남은 작업 / 주의점
- **레거시 잔재 청산**: `package.json`의 프로젝트명, `app/page.tsx`의 뱃지 컬러 하드코딩(`페스티벌`, `릴리즈`), `DESIGN.md` 등 "EDM Star News" 시절의 명칭 정리 필요.
- **다중 이미지 시스템**: `image-system.md`에 기획된 `images`, `article_images` DB 마이그레이션 미실행. 수동 수정, 갤러리 UI 작업 등 구현 필요.
- **보안/환경변수**: `bot/index.ts` 하드코딩 토큰 분리 필요. Claude API 에러 핸들링 고도화 필요.
- Storage 정리: 사용되지 않거나 버려진 기사의 이미지 원본 주기적 삭제/정리 로직 부재.
- 중복 생성 방지: `raw_articles`의 재사용 여부를 엄격하게 막거나 트래킹할 수 있는 로직 강화.

## 11. 주요 명령어
```bash
npm install
npm run dev
npx tsc --noEmit
npx eslint [수정한 코드 파일]
npm run build:static
npm run sync-entities
```
(동시 실행 시 `npm run dev:all` 또는 터미널 분리하여 `npm run dev` 및 `cd bot && npm start` 실행)