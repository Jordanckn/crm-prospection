/* Conversion serveur des echeances saisies dans le fuseau de l'utilisateur. */

CREATE OR REPLACE FUNCTION public.save_task_local_time(
  p_task_id uuid,
  p_contact_id uuid,
  p_titre text,
  p_description text,
  p_local_datetime timestamp without time zone,
  p_timezone text,
  p_statut text
)
RETURNS public.taches
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_task public.taches%ROWTYPE;
  v_due_at timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'Fuseau horaire invalide: %', p_timezone;
  END IF;
  IF NULLIF(trim(COALESCE(p_titre, '')), '') IS NULL THEN RAISE EXCEPTION 'Titre requis'; END IF;

  v_due_at := CASE
    WHEN p_local_datetime IS NULL THEN NULL
    ELSE p_local_datetime AT TIME ZONE p_timezone
  END;

  IF p_task_id IS NULL THEN
    INSERT INTO public.taches(contact_id, titre, description, date_echeance, statut)
    VALUES (p_contact_id, trim(p_titre), COALESCE(p_description, ''), v_due_at, COALESCE(p_statut, 'En attente'))
    RETURNING * INTO v_task;
  ELSE
    UPDATE public.taches SET
      contact_id = p_contact_id,
      titre = trim(p_titre),
      description = COALESCE(p_description, ''),
      date_echeance = v_due_at,
      statut = COALESCE(p_statut, 'En attente')
    WHERE id = p_task_id
    RETURNING * INTO v_task;
    IF v_task.id IS NULL THEN RAISE EXCEPTION 'Tache introuvable ou inaccessible'; END IF;
  END IF;

  RETURN v_task;
END;
$$;

REVOKE ALL ON FUNCTION public.save_task_local_time(uuid, uuid, text, text, timestamp without time zone, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_task_local_time(uuid, uuid, text, text, timestamp without time zone, text, text) TO authenticated;
