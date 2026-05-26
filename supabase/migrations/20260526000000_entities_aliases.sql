ALTER TABLE public.entities
ADD COLUMN IF NOT EXISTS aliases text[] DEFAULT '{}';
