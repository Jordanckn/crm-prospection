-- Current imports stored company names in the contact name fields.
-- Backfill only rows that do not already have a company; future rows are unaffected.
UPDATE public.contacts
SET entreprise = btrim(concat_ws(' ', prenom, nom))
WHERE btrim(coalesce(entreprise, '')) = ''
  AND btrim(concat_ws(' ', prenom, nom)) <> '';
