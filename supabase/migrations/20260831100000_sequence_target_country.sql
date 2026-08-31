-- Une sequence Epiderme peut etre reservee explicitement a la France ou a Israel.
-- NULL conserve le comportement historique : routage individuel selon le pays du contact.
ALTER TABLE public.email_sequences
  ADD COLUMN IF NOT EXISTS target_country text;

ALTER TABLE public.email_sequences
  DROP CONSTRAINT IF EXISTS email_sequences_target_country_check;
ALTER TABLE public.email_sequences
  ADD CONSTRAINT email_sequences_target_country_check
  CHECK (target_country IS NULL OR target_country IN ('France', 'Israël'));

CREATE OR REPLACE FUNCTION public.validate_sequence_contact_country()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_country text;
  v_contact_country text;
BEGIN
  SELECT target_country INTO v_target_country
  FROM public.email_sequences
  WHERE id = NEW.sequence_id;

  IF v_target_country IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pays INTO v_contact_country
  FROM public.contacts
  WHERE id = NEW.contact_id;

  IF v_contact_country IS DISTINCT FROM v_target_country THEN
    RAISE EXCEPTION 'Ce contact est rattache a %, mais cette sequence est reservee a %.',
      COALESCE(v_contact_country, 'un pays non defini'), v_target_country;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_sequence_contact_country_trigger
  ON public.email_sequence_enrollments;
CREATE TRIGGER validate_sequence_contact_country_trigger
  BEFORE INSERT OR UPDATE OF sequence_id, contact_id
  ON public.email_sequence_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.validate_sequence_contact_country();

REVOKE ALL ON FUNCTION public.validate_sequence_contact_country() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_sequence_contact_country() TO service_role;

CREATE INDEX IF NOT EXISTS idx_email_sequences_target_country
  ON public.email_sequences(brand_id, target_country);
