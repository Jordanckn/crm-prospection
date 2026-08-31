-- Respecte la cadence minimale de chaque sequence, y compris pour les anciens lots en retard.
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
        p_force
        OR NOT EXISTS (
          SELECT 1
          FROM public.email_sequence_attempts recent
          WHERE recent.sequence_id = e.sequence_id
            AND recent.status = 'sent'
            AND recent.finished_at > now() - make_interval(mins => GREATEST(COALESCE(s.delai_base_minutes, 3), 1))
        )
      )
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

REVOKE ALL ON FUNCTION public.claim_email_sequence_enrollment(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_email_sequence_enrollment(uuid, uuid, boolean) TO service_role;
