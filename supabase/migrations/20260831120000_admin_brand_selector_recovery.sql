-- Le compte principal revient sur WebFitYou afin de retrouver immediatement ses
-- templates. Le selecteur permet ensuite de basculer librement vers Epiderme AI.
UPDATE public.profiles
SET active_brand_id = '11111111-1111-4111-8111-111111111111', updated_at = now()
WHERE lower(email) = 'contact@webfityou.com'
  AND role = 'admin'
  AND active = true;

-- Un administrateur voit toujours les espaces actifs. La fonction de changement
-- conserve en plus la verification de son rattachement profile_brands.
DROP POLICY IF EXISTS "Users view accessible brands" ON public.brands;
CREATE POLICY "Users view accessible brands" ON public.brands
  FOR SELECT TO authenticated
  USING (
    active
    AND (public.is_admin() OR public.has_brand_access(id))
  );
