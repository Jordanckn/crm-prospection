/*
  Suppression securisee d'un utilisateur dans un espace.
  L'activite est transferee a l'administrateur avant le retrait du compte.
*/

ALTER TABLE public.recaps_journaliers
  DROP CONSTRAINT IF EXISTS recaps_journaliers_user_id_jour_key;
ALTER TABLE public.recaps_journaliers
  ADD CONSTRAINT recaps_brand_user_jour_key UNIQUE (brand_id, user_id, jour);

ALTER TABLE public.app_settings
  DROP CONSTRAINT IF EXISTS app_settings_user_id_cle_key;
ALTER TABLE public.app_settings
  ADD CONSTRAINT app_settings_brand_user_cle_key UNIQUE (brand_id, user_id, cle);

CREATE OR REPLACE FUNCTION public.admin_remove_user_from_brand(
  p_target_user_id uuid,
  p_reassign_to_user_id uuid,
  p_brand_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membership_count integer;
  v_remaining_count integer;
  v_next_brand_id uuid;
BEGIN
  IF p_target_user_id = p_reassign_to_user_id THEN
    RAISE EXCEPTION 'Le compte cible ne peut pas etre le compte de reaffectation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profile_brands
    WHERE profile_id = p_target_user_id AND brand_id = p_brand_id
  ) THEN
    RAISE EXCEPTION 'Utilisateur absent de cet espace';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profile_brands pb
    JOIN public.profiles p ON p.id = pb.profile_id
    WHERE pb.profile_id = p_reassign_to_user_id
      AND pb.brand_id = p_brand_id AND p.active
  ) THEN
    RAISE EXCEPTION 'Administrateur de reaffectation invalide';
  END IF;

  SELECT count(*) INTO v_membership_count
  FROM public.profile_brands WHERE profile_id = p_target_user_id;

  UPDATE public.contacts SET assigned_to = p_reassign_to_user_id
    WHERE brand_id = p_brand_id AND assigned_to = p_target_user_id;
  UPDATE public.interactions SET user_id = p_reassign_to_user_id
    WHERE brand_id = p_brand_id AND user_id = p_target_user_id;
  UPDATE public.taches SET assigned_to = p_reassign_to_user_id
    WHERE brand_id = p_brand_id AND assigned_to = p_target_user_id;
  UPDATE public.sessions_travail SET user_id = p_reassign_to_user_id
    WHERE brand_id = p_brand_id AND user_id = p_target_user_id;
  UPDATE public.liste_appels SET user_id = p_reassign_to_user_id
    WHERE brand_id = p_brand_id AND user_id = p_target_user_id;
  UPDATE public.api_clients SET default_user_id = p_reassign_to_user_id
    WHERE brand_id = p_brand_id AND default_user_id = p_target_user_id;

  INSERT INTO public.recaps_journaliers (
    user_id, jour, minutes_travail, minutes_prospection, brand_id
  )
  SELECT p_reassign_to_user_id, jour, minutes_travail, minutes_prospection, p_brand_id
  FROM public.recaps_journaliers
  WHERE brand_id = p_brand_id AND user_id = p_target_user_id
  ON CONFLICT (brand_id, user_id, jour) DO UPDATE SET
    minutes_travail = public.recaps_journaliers.minutes_travail + EXCLUDED.minutes_travail,
    minutes_prospection = public.recaps_journaliers.minutes_prospection + EXCLUDED.minutes_prospection,
    updated_at = now();
  DELETE FROM public.recaps_journaliers
    WHERE brand_id = p_brand_id AND user_id = p_target_user_id;

  INSERT INTO public.objectifs (
    date, appels_objectif, messages_objectif, user_id, brand_id
  )
  SELECT date, appels_objectif, messages_objectif, p_reassign_to_user_id, p_brand_id
  FROM public.objectifs
  WHERE brand_id = p_brand_id AND user_id = p_target_user_id
  ON CONFLICT (brand_id, user_id, date) DO UPDATE SET
    appels_objectif = GREATEST(public.objectifs.appels_objectif, EXCLUDED.appels_objectif),
    messages_objectif = GREATEST(public.objectifs.messages_objectif, EXCLUDED.messages_objectif),
    updated_at = now();
  DELETE FROM public.objectifs
    WHERE brand_id = p_brand_id AND user_id = p_target_user_id;

  DELETE FROM public.app_settings
    WHERE brand_id = p_brand_id AND user_id = p_target_user_id;

  IF v_membership_count <= 1 THEN
    -- La suppression Auth qui suit supprimera le profil en cascade. En cas
    -- d'echec externe, le compte reste au minimum immediatement inutilisable.
    UPDATE public.profiles SET active = false, updated_at = now()
      WHERE id = p_target_user_id;
    RETURN 0;
  END IF;

  DELETE FROM public.profile_brands
    WHERE profile_id = p_target_user_id AND brand_id = p_brand_id;
  SELECT count(*) INTO v_remaining_count
    FROM public.profile_brands WHERE profile_id = p_target_user_id;

  SELECT brand_id INTO v_next_brand_id
  FROM public.profile_brands
  WHERE profile_id = p_target_user_id
  ORDER BY created_at LIMIT 1;
  UPDATE public.profiles SET active_brand_id = v_next_brand_id, updated_at = now()
    WHERE id = p_target_user_id AND active_brand_id = p_brand_id;

  RETURN v_remaining_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_remove_user_from_brand(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_remove_user_from_brand(uuid, uuid, uuid) TO service_role;
