-- Identite d'envoi Epiderme AI utilisee exclusivement par Resend.
UPDATE public.brands
SET
  from_name = 'Epiderme AI',
  from_email = 'noreply@epiderme-ai.com',
  reply_to = 'nb.epidermai@gmail.com',
  unsubscribe_email = 'nb.epidermai@gmail.com',
  logo_url = 'https://ongcadzzheyyigickvfu.supabase.co/storage/v1/object/public/images%20site%20web/Epiderme-AI%20(2).png',
  updated_at = now()
WHERE code = 'epiderme_ai';
