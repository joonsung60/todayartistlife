# EDM Star News Korea - 현재 프로젝트 컨텍스트

이 문서는 현재 프로젝트 상태를 빠르게 공유하기 위한 브리핑이다. 웹 Claude/ChatGPT와 논의할 때 이 파일을 붙여넣으면 전체 구조와 남은 의사결정을 이해할 수 있어야 한다.

## 1. 프로젝트 목적

영문 EDM/전자음악 매체의 RSS 또는 개별 URL을 수집하고, 관련 원문들을 묶어 로컬 LLM으로 한국어 종합 기사를 생성한 뒤 공개 뉴스 사이트에 게시한다.

핵심 흐름:

1. 원문 수집: RSS 또는 URL 직접 추가
2. 자동 토픽 제안: 여러 raw article 중 같은 사건/릴리즈/행사/인물/제품으로 묶을 후보를 LLM이 제안
3. 인간 검토: 제안 승인 또는 거절
4. 기사 생성: 승인된 토픽으로 한국어 기사 초안 생성
5. 인간 검토: 초안 수정/삭제/게시
6. 공개 배포: 게시된 기사만 Cloudflare Pages 정적 사이트에 반영

## 2. 현재 아키텍처

### 로컬 어드민/생성 환경

- `npm run dev`로 로컬 Next.js 서버 실행
- `/admin`에서 수집, 토픽 제안, 기사 생성, 검토, 게시 작업 수행
- Ollama `qwen3:14b` 사용
- Windows Ollama를 WSL에서 `OLLAMA_BASE_URL=http://172.25.224.1:11434`로 호출
- Supabase에 raw article, cluster, generated article 저장
- `/admin/*`은 `middleware.ts`와 쿠키 세션으로 보호

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
  - 현재 안전 조치로 `scripts/build-static.mjs`는 `app/admin`, `app/api`, `middleware.ts/proxy.ts`를 정적 빌드에서 제외하는 방향이어야 한다.
  - 정적 배포에서 `/admin`을 포함하고 진짜 인증을 원하면 Cloudflare Access 같은 외부 보호가 필요하다.
  - 클라이언트 비밀번호 화면은 우회 가능하므로 진짜 보안으로 보지 않는다.

## 3. 기술 스택

- Next.js 16.2.6 App Router
- React 19
- Supabase PostgreSQL
- Ollama `qwen3:14b`
- Cloudflare Pages static export
- Tailwind CSS

Next.js 16 관련 주의:

- 현재 프로젝트는 `middleware.ts`를 사용한다.
- 동적 route handler의 `params`는 Promise로 처리한다.
- 정적 export에서는 middleware/API routes가 실행되지 않는다.

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
- `created_at`

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
middleware.ts
  로컬 /admin/* 보호. ADMIN_PASSWORD 기반 쿠키 세션 확인.

lib/admin-session.ts
  HMAC 기반 admin_session 쿠키 sign/verify.

next.config.ts
  BUILD_STATIC=1일 때 output:'export', trailingSlash, images.unoptimized 설정.

scripts/build-static.mjs
  Cloudflare Pages 정적 빌드 스크립트.
  정적 export와 충돌하는 admin/api/middleware 계층을 임시 stash한 뒤 next build --webpack 실행.

app/layout.tsx
  사이트 공통 헤더와 네비게이션. 정적 빌드에서는 어드민 링크를 숨기는 방향이 안전하다.

app/page.tsx
  공개 홈. published 기사 최대 20개를 published_at desc로 표시.
  썸네일은 cluster -> raw article image_url에서 가져온다.

app/articles/[id]/page.tsx
  공개 기사 상세. generateStaticParams로 published 기사만 정적 생성.

app/admin/page.tsx
  로컬 어드민 UI. 6개 탭.

app/admin/login/page.tsx
  어드민 로그인 폼.

app/api/admin/login/route.ts
  ADMIN_PASSWORD 검증, 쿠키 발급, IP 기반 실패 제한.

app/api/collect/route.ts
  RSS 수집과 URL 직접 추가.

app/api/suggest-clusters/route.ts
  자동 토픽 제안 생성/조회.

app/api/suggest-clusters/[id]/route.ts
  토픽 제안 상태 업데이트.

app/api/cluster/route.ts
  클러스터 생성.

app/api/generate/route.ts
  한국어 기사 생성.

app/api/articles/route.ts
  생성 기사 목록 조회.

app/api/articles/[id]/route.ts
  게시 전 기사 초안 수정/삭제.

app/api/articles/[id]/publish/route.ts
  기사 게시 처리. published=true, published_at=now() 업데이트 후 Cloudflare deploy hook 호출.

app/api/raw-articles/backfill-titles/route.ts
  과거 URL형 title 데이터를 재추출/보정하기 위한 backfill API.

lib/article-extraction.ts
  HTML 제목/본문/이미지 추출과 텍스트 정제.

lib/prompts.ts
  기사 생성 시스템 프롬프트. 상대 날짜 표현 금지 규칙 포함.

lib/edm-entities.json
  EDM 관련 entity/키워드 사전 데이터.
```

## 6. 어드민 UI 탭

1. **RSS 수집**
   - 등록 RSS 소스에서 새 기사 수집
   - 실패 소스 표시

2. **URL 직접 추가**
   - URL을 줄 단위로 넣어 원문 수집

3. **자동 토픽 제안**
   - 최근 미사용 raw article을 LLM이 분석
   - 같은 사건/릴리즈/행사/인물/제품 후보만 제안
   - 승인 시 클러스터 생성과 기사 생성까지 이어짐
   - 거절 가능

4. **생성 기사 검토**
   - 생성된 초안 목록 확인
   - 게시 전 제목/본문 수정 가능
   - 게시 전 삭제 가능
   - 게시 버튼을 누르면 공개 사이트 반영 대상이 됨

5. **클러스터 수동 생성**
   - 토픽/키워드로 수동 클러스터 생성

6. **기사 수동 생성**
   - 클러스터 ID를 직접 넣어 기사 생성

## 7. 자동 토픽 제안 정책

현재 목표는 "같은 단어가 있는 기사 묶음"이 아니라 "하나의 한국어 기사로 합칠 수 있는 같은 사건/릴리즈/행사/인물/제품 후보"를 찾는 것이다.

현재 반영된 정책:

- 넓은 카테고리 단어만 공유하는 묶음 금지
  - 예: festival, techno, house, release, new music
- 매체명/사이트명/연도 단독/시리즈명으로 묶는 것 금지
  - 예: 909originals, IA MIX, 2025 관련 소식
- 인터뷰 형식 문구로 묶는 것 금지
  - 예: catches up with, chats to
- 후보 발굴 단계라 너무 보수적이면 안 됨
- 기본 분석 기사 수는 100개
- 최대 분석 기사 수는 150개
- 응집도 최소 기준은 현재 20
- 모든 소스를 동등하게 취급한다.

## 8. 기사 생성 정책

`/api/generate`는 클러스터에 묶인 원문들을 정제해서 Qwen3에 전달한다.

LLM 입력에 포함되는 정보:

- 매체명
- 발행일
- 원문 제목
- 원문 URL
- 정제된 원문 내용

검증 정책:

- 생성 결과가 너무 짧으면 실패
- 한국어 비율이 낮으면 실패
- Login, Search, Share, Previous article 등 원문 페이지 잡음이 남아 있으면 실패
- 실패 시 한 번 재시도

프롬프트 정책:

- 한국어 기사 작성
- 원문 그대로 복사 금지
- `오늘`, `어제`, `최근`, `며칠 전` 같은 상대 날짜 표현 금지
- 날짜가 필요하면 원문의 구체 날짜를 사용
- 날짜가 불명확하면 날짜 언급 생략

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
- `ADMIN_PASSWORD`
- `CLOUDFLARE_DEPLOY_HOOK_URL`
- `BUILD_STATIC`

### 자동 재빌드

로컬 어드민에서 기사를 게시하면:

1. `/api/articles/[id]/publish`가 Supabase에서 `published=true`, `published_at=now()` 업데이트
2. 같은 API가 `CLOUDFLARE_DEPLOY_HOOK_URL`로 POST
3. Cloudflare Pages가 다시 빌드
4. 새 published 기사들이 정적 HTML에 반영됨

### 어드민 배포 관련 현재 판단

정적 export 사이트에 `/admin`을 포함하면 middleware 인증이 적용되지 않는다. 그래서 아무나 `/admin` HTML을 볼 수 있다.

가능한 선택지:

- 안전 우선: 배포본에서 `/admin` 제외
- 배포본에 `/admin` UI를 포함하고 싶다면 Cloudflare Access로 `/admin*` 보호
- 클라이언트 비밀번호 화면은 실수 방지용일 뿐 진짜 보안은 아님
- 배포본에서 실제 어드민 기능까지 동작시키려면 SSG만으로는 부족하고, Cloudflare Functions/Workers 또는 별도 API 서버가 필요

현재 권장: 공개 배포본에서는 `/admin` 제외, 실제 운영은 로컬 어드민에서 수행.

## 10. 환경 변수

### 로컬 `.env.local`

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `OLLAMA_BASE_URL=http://172.25.224.1:11434`
- `ADMIN_PASSWORD`
- `CLOUDFLARE_DEPLOY_HOOK_URL`
- `CRON_SECRET` 선택

### Cloudflare Pages

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 11. 남은 주요 의사결정 / 다음 작업

### 배포/보안

- Cloudflare 배포본에서 `/admin`을 완전히 제외할지, Cloudflare Access로 보호하며 포함할지 결정
- 현재처럼 로컬 어드민만 사용할 경우, 공개 헤더에서 어드민 링크는 숨기는 것이 맞다.

### URL 구조

- 현재: `/articles/[uuid]`
- 목표 후보: `/articles/[slug]`
- 필요 작업:
  - `articles.slug` 컬럼 추가
  - 기사 생성 시 slug 생성
  - uuid/slug 병행 또는 slug 전환 결정

### 카테고리/네비게이션

- 현재 네비게이션은 더미
- 기사 20~30개 누적 후 카테고리 체계 결정
- 후보 컬럼:
  - `category`
  - `genre`
  - `tags`

### 기사 수정

- 게시 전 수정/삭제는 구현됨
- 게시 후 수정은 아직 미구현

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

- Cloudflare 정적 export에서는 middleware/API가 실행되지 않는다.
- 정적 배포에 `/admin`이 포함되면 인증 없이 HTML이 노출된다.
- 현재 `middleware.ts`가 존재하지만 `scripts/build-static.mjs`의 stash 대상은 `proxy.ts`로 남아 있다. 정적 빌드 전에 `middleware.ts`도 제외 대상인지 확인해야 한다.
- `npm run build:static`은 `--webpack`을 강제한다. Next 16.2 Turbopack은 `output:'export'`에서 `out/` 생성 문제가 있었다.
- `app/api/admin/login`의 rate limit은 in-memory라 dev 서버 재시작 시 초기화된다.
- 일부 RSS 소스는 계속 실패할 수 있다. Beatportal/Resident Advisor는 수동 URL ingest가 더 현실적이다.
- JS 렌더링 의존 사이트는 본문 추출 품질이 낮을 수 있다.
- Ollama가 꺼져 있거나 `qwen3:14b` 모델이 없으면 기사 생성/토픽 제안이 실패한다.
