# 투아라 이미지 시스템 설계

## 목적
- 기사당 다중 이미지 삽입 (텍스트보다 이미지 중심의 콘텐츠)
- 아티스트/셀럽 엔티티 페이지에 이미지 갤러리
- 인스타그램 카드뉴스 등 2차 활용 소재 확보

## 이미지 저장소
- Cloudflare R2 버킷: todayartistlife-images
- 환경변수: CLOUDFLARE_R2_ENDPOINT, CLOUDFLARE_R2_ACCESS_KEY_ID(User API), CLOUDFLARE_R2_SECRET_ACCESS_KEY, CLOUDFLARE_R2_BUCKET_NAME, CLOUDFLARE_R2_PUBLIC_URL

## 이미지 소스 종류
- rss: RSS 기사 수집 시 자동 추출
- search: DuckDuckGo 등 외부 이미지 검색 API
- ai: AI 생성 이미지 (캡션에 'AI 생성' 표기)
- manual: 어드민에서 수동 업로드

## DB 스키마

### images 테이블
- id, r2_key, public_url, width, height, alt_text, source_url, source_type(rss/search/ai/manual), is_ai_generated, created_at

### article_images 테이블 (기사-이미지 다대다)
- article_id, image_id, position(순서), is_thumbnail(대표이미지)

### entity_images 테이블 (엔티티-이미지 다대다)
- entity_id, image_id, is_primary(대표 프로필)

## 이미지-엔티티 관계 원칙
- 이미지 하나에 여러 엔티티 태깅 가능 (예: A+B 합사진 → 엔티티 A, B 모두 연결)
- 아티스트 페이지에서는 해당 엔티티가 태깅된 모든 이미지 표시
- 기사 이미지는 자동 추천(기사 엔티티 기준) + 수동 수정 가능

## 이미지 메타데이터
- 연도, 장소 등 태그/캡션으로 관리
- AI 생성 이미지는 is_ai_generated=true + alt_text에 'AI 생성' 명시

## 구현 단계
- 1단계: RSS 수집 시 이미지 자동으로 R2 저장 + DB 기록
- 2단계: 기사-이미지 연결 UI, 어드민에서 수동 수정
- 3단계: 엔티티-이미지 연결, 아티스트 페이지 갤러리
- 4단계: DuckDuckGo 검색 연동, AI 이미지 생성 파이프라인