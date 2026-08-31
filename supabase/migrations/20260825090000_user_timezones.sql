/* Fuseau horaire individuel pour l'affichage et le calcul des journees de travail. */

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Europe/Paris';

UPDATE public.profiles
SET timezone = 'Asia/Jerusalem', updated_at = now()
WHERE lower(full_name) LIKE '%liron%'
   OR lower(full_name) LIKE '%meitav%'
   OR lower(email) LIKE '%liron%'
   OR lower(email) LIKE '%meitav%';

COMMENT ON COLUMN public.profiles.timezone IS
  'Identifiant IANA utilise pour afficher les horaires propres a chaque utilisateur.';
