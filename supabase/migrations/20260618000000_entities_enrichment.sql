-- 아티스트 프로필 보강(enrichment) 데이터 저장용 컬럼.
-- scripts/enrich-artists.mjs 가 Wikipedia / Last.fm / MusicBrainz / Ollama 결과를
-- 이 컬럼들에 upsert 한다. (name,type 기준 conflict)
ALTER TABLE public.entities
  -- Last.fm tags 기반 장르 목록 (예: {'pop','synth-pop'})
  ADD COLUMN IF NOT EXISTS genres text[],
  -- 활동 시대 태그 (예: {'2010s','2020s'})
  ADD COLUMN IF NOT EXISTS active_period text[],
  -- 한국어로 재구성된 소개 텍스트
  ADD COLUMN IF NOT EXISTS bio text,
  -- bio 생성에 사용한 소스 기록 (예: 'wikipedia+lastfm via ollama')
  ADD COLUMN IF NOT EXISTS bio_source text,
  -- 관련 아티스트 [{"name":"...","common_tags":["pop","2010s"]}, ...]
  ADD COLUMN IF NOT EXISTS related_artists jsonb,
  -- 외부 링크 {"spotify":"...","instagram":"...","twitter":"..."}
  ADD COLUMN IF NOT EXISTS external_links jsonb,
  -- 수상 이력 (MusicBrainz 등에서 수집)
  ADD COLUMN IF NOT EXISTS awards jsonb,
  -- 마지막 보강 처리 시각
  ADD COLUMN IF NOT EXISTS last_enriched_at timestamptz;
