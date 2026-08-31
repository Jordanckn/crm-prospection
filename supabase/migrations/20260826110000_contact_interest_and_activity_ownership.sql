/* Statut d'interet durable sur les contacts, synchronise depuis les interactions. */

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS interet text NOT NULL DEFAULT '';

ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_interet_check;
ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_interet_check
  CHECK (interet IN ('', 'Intéressé', 'Non intéressé'));

-- Reprend le dernier resultat decisif existant pour initialiser les contacts actuels.
UPDATE public.contacts c
SET interet = latest.resultat,
    updated_at = now()
FROM (
  SELECT DISTINCT ON (contact_id) contact_id, resultat
  FROM public.interactions
  WHERE resultat IN ('Intéressé', 'Non intéressé')
  ORDER BY contact_id, date_heure DESC, created_at DESC
) latest
WHERE latest.contact_id = c.id
  AND c.interet = '';

CREATE OR REPLACE FUNCTION public.refresh_contact_interest(p_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.contacts c
  SET interet = COALESCE((
        SELECT i.resultat
        FROM public.interactions i
        WHERE i.contact_id = p_contact_id
          AND i.resultat IN ('Intéressé', 'Non intéressé')
        ORDER BY i.date_heure DESC, i.created_at DESC
        LIMIT 1
      ), ''),
      updated_at = now()
  WHERE c.id = p_contact_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_contact_interest_from_interaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_contact_interest(OLD.contact_id);
    RETURN OLD;
  END IF;

  PERFORM public.refresh_contact_interest(NEW.contact_id);
  IF TG_OP = 'UPDATE' AND OLD.contact_id IS DISTINCT FROM NEW.contact_id THEN
    PERFORM public.refresh_contact_interest(OLD.contact_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_contact_interest_after_interaction ON public.interactions;
CREATE TRIGGER sync_contact_interest_after_interaction
  AFTER INSERT OR UPDATE OF resultat, contact_id OR DELETE ON public.interactions
  FOR EACH ROW EXECUTE FUNCTION public.sync_contact_interest_from_interaction();

REVOKE ALL ON FUNCTION public.refresh_contact_interest(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_contact_interest_from_interaction() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_contact_interest(uuid) TO service_role;

