-- Donnees lisibles pour le journal administratif des emails.
ALTER TABLE public.email_sequence_attempts
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recipient_email text,
  ADD COLUMN IF NOT EXISTS subject text;

CREATE INDEX IF NOT EXISTS idx_sequence_attempts_brand_finished
  ON public.email_sequence_attempts(brand_id, finished_at DESC);

CREATE OR REPLACE FUNCTION public.complete_email_sequence_step(
  p_enrollment_id uuid,
  p_attempt_id uuid,
  p_provider text,
  p_provider_message_id text,
  p_subject text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enrollment public.email_sequence_enrollments%ROWTYPE;
  v_sequence public.email_sequences%ROWTYPE;
  v_contact public.contacts%ROWTYPE;
  v_steps jsonb;
  v_next_step integer;
  v_next_delay numeric;
  v_next_execution timestamptz;
  v_completed boolean;
BEGIN
  SELECT * INTO v_enrollment FROM public.email_sequence_enrollments
  WHERE id = p_enrollment_id FOR UPDATE;
  IF NOT FOUND OR v_enrollment.execution_status <> 'processing' THEN
    RAISE EXCEPTION 'Inscription non verrouillee ou introuvable';
  END IF;

  SELECT * INTO v_sequence FROM public.email_sequences WHERE id = v_enrollment.sequence_id;
  SELECT * INTO v_contact FROM public.contacts WHERE id = v_enrollment.contact_id;
  v_steps := COALESCE(v_sequence.etapes, '[]'::jsonb);
  v_next_step := v_enrollment.etape_courante + 1;
  v_completed := v_next_step >= jsonb_array_length(v_steps);

  INSERT INTO public.interactions(contact_id, user_id, type, date_heure, duree, resultat, notes, brand_id)
  VALUES (
    v_contact.id, v_contact.assigned_to, 'Email', now(), 0, 'Envoyé',
    '[Sequence automatique] ' || v_sequence.titre || ' - Etape ' || (v_enrollment.etape_courante + 1) ||
    ' : ' || p_subject || ' - ' || upper(p_provider) || ' #' || p_provider_message_id,
    v_enrollment.brand_id
  );
  UPDATE public.contacts SET derniere_interaction = now() WHERE id = v_contact.id;

  IF v_completed THEN
    UPDATE public.email_sequence_enrollments
    SET statut = 'completed', execution_status = 'completed', etape_courante = v_next_step,
        derniere_execution = now(), processing_started_at = NULL, processing_step = NULL,
        provider_message_id = p_provider_message_id, sent_count = sent_count + 1, updated_at = now()
    WHERE id = p_enrollment_id;
  ELSE
    v_next_delay := COALESCE((v_steps -> v_next_step ->> 'delay_days')::numeric, 0);
    v_next_execution := v_enrollment.enrolled_at + make_interval(secs => (v_next_delay * 86400)::double precision);
    IF v_next_execution <= now() THEN v_next_execution := now() + interval '1 minute'; END IF;
    UPDATE public.email_sequence_enrollments
    SET execution_status = 'sent', etape_courante = v_next_step,
        prochaine_execution = v_next_execution, derniere_execution = now(),
        processing_started_at = NULL, processing_step = NULL,
        provider_message_id = p_provider_message_id, sent_count = sent_count + 1, updated_at = now()
    WHERE id = p_enrollment_id;
  END IF;

  UPDATE public.email_sequence_attempts
  SET status = 'sent', provider = p_provider, provider_message_id = p_provider_message_id,
      subject = p_subject, recipient_email = v_contact.email,
      finished_at = now(), error = NULL
  WHERE id = p_attempt_id;

  RETURN jsonb_build_object('completed', v_completed, 'next_execution', v_next_execution);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_email_sequence_step(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_email_sequence_step(uuid, uuid, text, text, text) TO service_role;
