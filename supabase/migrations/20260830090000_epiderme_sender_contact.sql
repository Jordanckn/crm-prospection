-- Une identite humaine et stable est preferable a une adresse noreply.
-- Les reponses restent redirigees vers la boite Gmail configuree.
UPDATE public.brands
SET
  from_name = 'Epiderme AI',
  from_email = 'contact@epiderme-ai.com',
  reply_to = 'nb.epidermai@gmail.com',
  updated_at = now()
WHERE code = 'epiderme_ai';
