-- Normalise the legacy sector label so contacts match the CRM's canonical filter.
DO $$
DECLARE
  updated_contacts integer;
BEGIN
  UPDATE public.contacts
  SET secteur_activite = 'Plombier'
  WHERE lower(btrim(coalesce(secteur_activite, ''))) = 'plomberie';

  GET DIAGNOSTICS updated_contacts = ROW_COUNT;
  RAISE NOTICE '% contact(s) normalisé(s) de Plomberie vers Plombier.', updated_contacts;
END
$$;
