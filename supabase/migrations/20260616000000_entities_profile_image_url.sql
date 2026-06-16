-- 아티스트 프로필 이미지 URL 저장용 컬럼.
-- scripts/fetch-artist-images.mjs 가 Wikipedia REST summary API 의
-- thumbnail.source 를 이 컬럼에 upsert 한다.
ALTER TABLE public.entities
ADD COLUMN IF NOT EXISTS profile_image_url text;
