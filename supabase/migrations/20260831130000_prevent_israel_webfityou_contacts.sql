-- Regle metier : les contacts Israel appartiennent exclusivement a Epiderme AI.
-- La remise en conformite est sans effet actuellement (aucune ligne concernee),
-- mais protege aussi une restauration ou un import ancien.
UPDATE public.contacts
SET brand_id = '22222222-2222-4222-8222-222222222222', updated_at = now()
WHERE brand_id = '11111111-1111-4111-8111-111111111111'
  AND pays = 'Israël';

ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_israel_epiderme_only;
ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_israel_epiderme_only
  CHECK (
    pays <> 'Israël'
    OR brand_id = '22222222-2222-4222-8222-222222222222'
  );
