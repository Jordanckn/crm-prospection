/* Enregistrement serveur des heures locales et correction auditable du passif Israel. */

CREATE TABLE IF NOT EXISTS public.interaction_timezone_correction_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id uuid NOT NULL UNIQUE REFERENCES public.interactions(id) ON DELETE CASCADE,
  previous_date_heure timestamptz NOT NULL,
  corrected_date_heure timestamptz NOT NULL,
  reason text NOT NULL,
  corrected_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.interaction_timezone_correction_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins view interaction timezone corrections" ON public.interaction_timezone_correction_audit;
CREATE POLICY "Admins view interaction timezone corrections"
  ON public.interaction_timezone_correction_audit FOR SELECT TO authenticated
  USING (public.is_admin());
REVOKE ALL ON TABLE public.interaction_timezone_correction_audit FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.interaction_timezone_correction_audit TO authenticated;
GRANT ALL ON TABLE public.interaction_timezone_correction_audit TO service_role;

INSERT INTO public.interaction_timezone_correction_audit(
  interaction_id, previous_date_heure, corrected_date_heure, reason
)
SELECT
  i.id,
  i.date_heure,
  i.date_heure - interval '3 hours',
  'Ancien formulaire: heure locale Israel enregistree comme UTC'
FROM public.interactions i
WHERE i.id = ANY(ARRAY[
  '3db26fe8-0ac5-4caf-b7b6-ccbebde4661b',
  '6e9c43d4-d134-49b7-aaf3-f2cafedc8e90',
  'b4a8ad9d-c3c3-4d90-be56-a397ef7b652b',
  '1cf74769-1fe7-4d5d-916b-c84245bf341f',
  '93c78901-b0b4-45b1-8b81-414899fc6a96',
  'e282f8c2-e94f-4971-a446-3ed15275a1a0',
  'bc567174-1c6b-4e11-b75d-a1461118425f',
  'fd5b9778-bd21-4406-a9d7-897da540fe9d',
  'f70a9d4e-d8a4-43e9-91c5-819b89cb08ae',
  '41f7b925-61bb-41a2-8eff-f6323452bccd',
  'dbc640d9-1bc8-45dc-86d2-a634d4690a1a',
  '7fb7ef79-e7b4-40eb-91c5-d34d89167546'
]::uuid[])
ON CONFLICT (interaction_id) DO NOTHING;

UPDATE public.interactions i
SET date_heure = audit.corrected_date_heure
FROM public.interaction_timezone_correction_audit audit
WHERE audit.interaction_id = i.id
  AND i.date_heure = audit.previous_date_heure;

UPDATE public.contacts c
SET derniere_interaction = latest.date_heure
FROM (
  SELECT i.contact_id, max(i.date_heure) AS date_heure
  FROM public.interactions i
  GROUP BY i.contact_id
) latest
WHERE c.id = latest.contact_id
  AND EXISTS (
    SELECT 1
    FROM public.interactions corrected
    JOIN public.interaction_timezone_correction_audit audit ON audit.interaction_id = corrected.id
    WHERE corrected.contact_id = c.id
  );

CREATE OR REPLACE FUNCTION public.save_interaction_local_time(
  p_interaction_id uuid,
  p_contact_id uuid,
  p_type text,
  p_local_datetime timestamp without time zone,
  p_timezone text,
  p_duree integer DEFAULT 0,
  p_resultat text DEFAULT '',
  p_notes text DEFAULT ''
)
RETURNS public.interactions
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_interaction public.interactions%ROWTYPE;
  v_datetime timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'Fuseau horaire invalide: %', p_timezone;
  END IF;
  IF p_local_datetime IS NULL THEN RAISE EXCEPTION 'Date et heure requises'; END IF;

  v_datetime := p_local_datetime AT TIME ZONE p_timezone;

  IF p_interaction_id IS NULL THEN
    INSERT INTO public.interactions(contact_id, type, date_heure, duree, resultat, notes)
    VALUES (p_contact_id, p_type, v_datetime, GREATEST(COALESCE(p_duree, 0), 0), COALESCE(p_resultat, ''), COALESCE(p_notes, ''))
    RETURNING * INTO v_interaction;
  ELSE
    UPDATE public.interactions SET
      contact_id = p_contact_id,
      type = p_type,
      date_heure = v_datetime,
      duree = GREATEST(COALESCE(p_duree, 0), 0),
      resultat = COALESCE(p_resultat, ''),
      notes = COALESCE(p_notes, '')
    WHERE id = p_interaction_id
    RETURNING * INTO v_interaction;
    IF v_interaction.id IS NULL THEN RAISE EXCEPTION 'Interaction introuvable ou inaccessible'; END IF;
  END IF;

  RETURN v_interaction;
END;
$$;

REVOKE ALL ON FUNCTION public.save_interaction_local_time(uuid, uuid, text, timestamp without time zone, text, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_interaction_local_time(uuid, uuid, text, timestamp without time zone, text, integer, text, text) TO authenticated;
