-- 한국(K-POP) 아티스트 식별용 플래그.
-- lib/entities/artists.json 의 is_korean 필드를 DB로 반영하기 위한 컬럼.
ALTER TABLE public.entities
ADD COLUMN IF NOT EXISTS is_korean boolean NOT NULL DEFAULT false;

-- 기존 엔티티 중 한국 아티스트로 표시된 항목 초기 반영.
-- (이후로는 scripts/update-entity-weights.mjs 의 upsert 가 source of truth)
UPDATE public.entities AS e
SET is_korean = true
FROM (
  VALUES
    ('Peggy Gou','artist'),('BTS','artist'),('Jungkook','artist'),('Jimin','artist'),
    ('RM','artist'),('Suga','artist'),('J-Hope','artist'),('Jin','artist'),
    ('BLACKPINK','artist'),('Lisa','artist'),('Jisoo','artist'),('TWICE','artist'),
    ('Nayeon','artist'),('SEVENTEEN','artist'),('Stray Kids','artist'),('aespa','artist'),
    ('NewJeans','artist'),('IVE','artist'),('PSY','artist'),('Rain','artist'),
    ('Rosé','artist'),('Jennie','artist'),('EXO','artist'),('NCT 127','artist'),
    ('NCT Dream','artist'),('MONSTA X','artist'),('GOT7','artist'),('SHINee','artist'),
    ('MAMAMOO','artist'),('Red Velvet','artist'),('Girls'' Generation','artist'),('2NE1','artist'),
    ('BIGBANG','artist'),('G-Dragon','artist'),('TOMORROW X TOGETHER','artist'),('ENHYPEN','artist'),
    ('LE SSERAFIM','artist'),('(G)I-DLE','artist'),('ITZY','artist'),('IU','artist'),
    ('Taeyeon','artist'),('ZICO','artist'),('CL','artist'),('HyunA','artist'),
    ('BoA','artist'),('Jay Park','artist')
) AS k(name, type)
WHERE e.name = k.name AND e.type = k.type;
