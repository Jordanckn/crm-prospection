-- Moteur autonome, observable et anti-doublon pour les sequences email.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

ALTER TABLE public.email_sequence_enrollments
  ADD COLUMN IF NOT EXISTS execution_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS enrolled_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_step integer,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS sent_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_message_id text;

UPDATE public.email_sequence_enrollments
SET
  enrolled_at = COALESCE(enrolled_at, created_at, now()),
  execution_status = CASE
    WHEN statut = 'completed' THEN 'completed'
    WHEN statut = 'cancelled' THEN 'cancelled'
    WHEN derniere_execution IS NOT NULL THEN 'sent'
    ELSE 'pending'
  END
WHERE enrolled_at IS NULL OR execution_status = 'pending';

ALTER TABLE public.email_sequence_enrollments
  ALTER COLUMN enrolled_at SET DEFAULT now(),
  ALTER COLUMN enrolled_at SET NOT NULL;

ALTER TABLE public.email_sequence_enrollments
  DROP CONSTRAINT IF EXISTS email_sequence_enrollments_execution_status_check;
ALTER TABLE public.email_sequence_enrollments
  ADD CONSTRAINT email_sequence_enrollments_execution_status_check
  CHECK (execution_status IN ('pending', 'processing', 'sent', 'error', 'completed', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_engine_due
  ON public.email_sequence_enrollments(execution_status, prochaine_execution)
  WHERE statut = 'active';

CREATE TABLE IF NOT EXISTS public.email_sequence_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('cron', 'manual')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  processed_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  error text,
  triggered_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.email_sequence_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.email_sequence_runs(id) ON DELETE SET NULL,
  enrollment_id uuid NOT NULL REFERENCES public.email_sequence_enrollments(id) ON DELETE CASCADE,
  sequence_id uuid NOT NULL REFERENCES public.email_sequences(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  step_index integer NOT NULL,
  scheduled_for timestamptz,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'sent', 'error')),
  provider text,
  provider_message_id text,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sequence_runs_brand_started
  ON public.email_sequence_runs(brand_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sequence_attempts_enrollment_started
  ON public.email_sequence_attempts(enrollment_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sequence_attempts_one_sent_step
  ON public.email_sequence_attempts(enrollment_id, step_index)
  WHERE status = 'sent';

ALTER TABLE public.email_sequence_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sequence_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view sequence runs" ON public.email_sequence_runs;
CREATE POLICY "Admins view sequence runs" ON public.email_sequence_runs
  FOR SELECT TO authenticated
  USING (public.is_admin() AND (brand_id IS NULL OR brand_id = public.current_brand_id()));

DROP POLICY IF EXISTS "Admins view sequence attempts" ON public.email_sequence_attempts;
CREATE POLICY "Admins view sequence attempts" ON public.email_sequence_attempts
  FOR SELECT TO authenticated
  USING (public.is_admin() AND brand_id = public.current_brand_id());

GRANT SELECT ON public.email_sequence_runs, public.email_sequence_attempts TO authenticated;
GRANT ALL ON public.email_sequence_runs, public.email_sequence_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.begin_email_sequence_run(
  p_source text,
  p_brand_id uuid DEFAULT NULL,
  p_triggered_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('email-sequence-engine'));
  IF p_source = 'cron' AND EXISTS (
    SELECT 1 FROM public.email_sequence_runs
    WHERE source = 'cron' AND started_at > now() - interval '45 seconds'
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.email_sequence_runs(brand_id, source, triggered_by)
  VALUES (p_brand_id, p_source, p_triggered_by)
  RETURNING id INTO v_run_id;
  RETURN v_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_email_sequence_enrollment(
  p_sequence_id uuid DEFAULT NULL,
  p_enrollment_id uuid DEFAULT NULL,
  p_force boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  WITH candidate AS (
    SELECT e.id
    FROM public.email_sequence_enrollments e
    JOIN public.email_sequences s ON s.id = e.sequence_id
    WHERE e.statut = 'active'
      AND s.actif = true
      AND (p_sequence_id IS NULL OR e.sequence_id = p_sequence_id)
      AND (p_enrollment_id IS NULL OR e.id = p_enrollment_id)
      AND (
        (p_force AND e.execution_status IN ('pending', 'sent', 'error', 'processing'))
        OR (
          NOT p_force
          AND e.execution_status IN ('pending', 'sent')
          AND e.prochaine_execution IS NOT NULL
          AND e.prochaine_execution <= now()
        )
      )
    ORDER BY e.prochaine_execution NULLS FIRST, e.created_at
    LIMIT 1
    FOR UPDATE OF e SKIP LOCKED
  )
  UPDATE public.email_sequence_enrollments e
  SET
    execution_status = 'processing',
    processing_started_at = now(),
    processing_step = e.etape_courante,
    last_attempt_at = now(),
    last_error = NULL,
    updated_at = now()
  FROM candidate
  WHERE e.id = candidate.id
  RETURNING e.id INTO v_id;
  RETURN v_id;
END;
$$;

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
    v_contact.id, v_contact.assigned_to, 'Email', now(), 0, '',
    '[Sequence auto] ' || v_sequence.titre || ' - Etape ' || (v_enrollment.etape_courante + 1) || ': ' || p_subject,
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
      finished_at = now(), error = NULL
  WHERE id = p_attempt_id;

  RETURN jsonb_build_object('completed', v_completed, 'next_execution', v_next_execution);
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_email_sequence_step(
  p_enrollment_id uuid,
  p_attempt_id uuid,
  p_error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.email_sequence_enrollments
  SET execution_status = 'error', last_error = left(p_error, 2000),
      error_count = error_count + 1, processing_started_at = NULL, processing_step = NULL,
      updated_at = now()
  WHERE id = p_enrollment_id;
  UPDATE public.email_sequence_attempts
  SET status = 'error', error = left(p_error, 2000), finished_at = now()
  WHERE id = p_attempt_id;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_email_sequence_run(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_email_sequence_enrollment(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_email_sequence_step(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_email_sequence_step(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_email_sequence_run(text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_email_sequence_enrollment(uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_email_sequence_step(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_email_sequence_step(uuid, uuid, text) TO service_role;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'process-email-sequences-every-minute';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
  PERFORM cron.schedule(
    'process-email-sequences-every-minute',
    '* * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://yibkdhmamtatyzsrqhia.supabase.co/functions/v1/process-sequences',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := '{"source":"cron"}'::jsonb,
        timeout_milliseconds := 50000
      );
    $cron$
  );
END $$;
