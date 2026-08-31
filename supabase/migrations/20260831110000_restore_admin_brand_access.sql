-- Repare et perennise l'acces des administrateurs aux deux espaces de marque.
UPDATE public.brands
SET active = true, updated_at = now()
WHERE code IN ('webfityou', 'epiderme_ai');

-- Tout administrateur actif doit pouvoir piloter les deux espaces.
INSERT INTO public.profile_brands(profile_id, brand_id)
SELECT p.id, b.id
FROM public.profiles p
CROSS JOIN public.brands b
WHERE p.active = true
  AND p.role = 'admin'
  AND b.code IN ('webfityou', 'epiderme_ai')
ON CONFLICT (profile_id, brand_id) DO NOTHING;

-- Un profil ne doit jamais rester positionne sur une marque a laquelle il
-- n'a plus acces. WebFitYou sert uniquement de repli dans ce cas precis.
UPDATE public.profiles p
SET active_brand_id = '11111111-1111-4111-8111-111111111111', updated_at = now()
WHERE p.active = true
  AND NOT EXISTS (
    SELECT 1
    FROM public.profile_brands pb
    WHERE pb.profile_id = p.id
      AND pb.brand_id = p.active_brand_id
  );

CREATE OR REPLACE FUNCTION public.grant_default_brand_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profile_brands(profile_id, brand_id)
  VALUES (NEW.id, '11111111-1111-4111-8111-111111111111')
  ON CONFLICT DO NOTHING;

  IF NEW.role = 'admin' AND NEW.active = true THEN
    INSERT INTO public.profile_brands(profile_id, brand_id)
    VALUES (NEW.id, '22222222-2222-4222-8222-222222222222')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS grant_default_brand_on_profile ON public.profiles;
CREATE TRIGGER grant_default_brand_on_profile
  AFTER INSERT OR UPDATE OF role, active ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.grant_default_brand_access();

REVOKE ALL ON FUNCTION public.grant_default_brand_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_default_brand_access() TO service_role;
