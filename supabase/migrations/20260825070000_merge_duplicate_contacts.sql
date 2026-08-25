/* Fusion auditable de contacts, exclusivement reservee aux administrateurs. */

CREATE TABLE IF NOT EXISTS public.contact_merge_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id),
  primary_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  duplicate_contact_ids uuid[] NOT NULL,
  primary_before jsonb NOT NULL,
  duplicates_before jsonb NOT NULL,
  related_before jsonb NOT NULL,
  merged_after jsonb NOT NULL,
  merged_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_merge_audit_brand_created
  ON public.contact_merge_audit(brand_id, created_at DESC);

ALTER TABLE public.contact_merge_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view contact merge audit" ON public.contact_merge_audit;
CREATE POLICY "Admins can view contact merge audit"
  ON public.contact_merge_audit FOR SELECT TO authenticated
  USING (public.is_admin() AND brand_id = public.current_brand_id());

REVOKE ALL ON TABLE public.contact_merge_audit FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.contact_merge_audit TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.contact_merge_audit TO service_role;

CREATE OR REPLACE FUNCTION public.admin_merge_contacts(
  p_primary_id uuid,
  p_duplicate_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand_id uuid := public.current_brand_id();
  v_duplicate_ids uuid[];
  v_all_ids uuid[];
  v_expected integer;
  v_found integer;
  v_primary_before jsonb;
  v_duplicates_before jsonb;
  v_related_before jsonb;
  v_merged_after jsonb;
  v_audit_id uuid;
  v_notes text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acces reserve aux administrateurs';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT duplicate_id), '{}'::uuid[])
  INTO v_duplicate_ids
  FROM unnest(COALESCE(p_duplicate_ids, '{}'::uuid[])) AS duplicate_id
  WHERE duplicate_id IS NOT NULL AND duplicate_id <> p_primary_id;

  v_expected := COALESCE(array_length(v_duplicate_ids, 1), 0);
  IF p_primary_id IS NULL OR v_expected = 0 THEN
    RAISE EXCEPTION 'Choisissez une fiche principale et au moins un doublon';
  END IF;

  v_all_ids := array_prepend(p_primary_id, v_duplicate_ids);

  -- Le verrou empeche une modification concurrente pendant la fusion.
  PERFORM 1 FROM public.contacts
  WHERE id = ANY(v_all_ids) AND brand_id = v_brand_id
  ORDER BY id
  FOR UPDATE;

  SELECT count(*) INTO v_found
  FROM public.contacts
  WHERE id = ANY(v_all_ids) AND brand_id = v_brand_id;

  IF v_found <> v_expected + 1 THEN
    RAISE EXCEPTION 'Une ou plusieurs fiches sont introuvables ou appartiennent a un autre espace';
  END IF;

  SELECT to_jsonb(c) INTO v_primary_before
  FROM public.contacts c WHERE c.id = p_primary_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.created_at, c.id), '[]'::jsonb)
  INTO v_duplicates_before
  FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids);

  SELECT jsonb_build_object(
    'interactions', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM public.interactions x WHERE x.contact_id = ANY(v_all_ids)), '[]'::jsonb),
    'taches', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM public.taches x WHERE x.contact_id = ANY(v_all_ids)), '[]'::jsonb),
    'relances', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM public.relances x WHERE x.contact_id = ANY(v_all_ids)), '[]'::jsonb),
    'documents', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM public.contact_documents x WHERE x.contact_id = ANY(v_all_ids)), '[]'::jsonb),
    'liste_appels', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM public.liste_appels x WHERE x.contact_id = ANY(v_all_ids)), '[]'::jsonb),
    'sequence_enrollments', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM public.email_sequence_enrollments x WHERE x.contact_id = ANY(v_all_ids)), '[]'::jsonb),
    'ai_enrichments', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM public.ai_enrichments x WHERE x.contact_id = ANY(v_all_ids)), '[]'::jsonb)
  ) INTO v_related_before;

  SELECT string_agg(note, E'\n\n') INTO v_notes
  FROM (
    SELECT DISTINCT NULLIF(trim(c.notes_entreprise), '') AS note
    FROM public.contacts c
    WHERE c.id = ANY(v_all_ids)
  ) notes
  WHERE note IS NOT NULL;

  UPDATE public.contacts p SET
    prenom = COALESCE(NULLIF(trim(p.prenom), ''), (SELECT NULLIF(trim(c.prenom), '') FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND NULLIF(trim(c.prenom), '') IS NOT NULL ORDER BY c.created_at LIMIT 1), ''),
    nom = COALESCE(NULLIF(trim(p.nom), ''), (SELECT NULLIF(trim(c.nom), '') FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND NULLIF(trim(c.nom), '') IS NOT NULL ORDER BY c.created_at LIMIT 1), ''),
    entreprise = COALESCE(NULLIF(trim(p.entreprise), ''), (SELECT NULLIF(trim(c.entreprise), '') FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND NULLIF(trim(c.entreprise), '') IS NOT NULL ORDER BY c.created_at LIMIT 1), ''),
    email = COALESCE(
      CASE WHEN trim(p.email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN trim(p.email) END,
      (SELECT trim(c.email) FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND trim(c.email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' ORDER BY c.created_at LIMIT 1),
      NULLIF(trim(p.email), ''),
      (SELECT NULLIF(trim(c.email), '') FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND NULLIF(trim(c.email), '') IS NOT NULL ORDER BY c.created_at LIMIT 1),
      ''
    ),
    telephone = COALESCE(NULLIF(trim(p.telephone), ''), (SELECT NULLIF(trim(c.telephone), '') FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND NULLIF(trim(c.telephone), '') IS NOT NULL ORDER BY c.created_at LIMIT 1), ''),
    tags = COALESCE((SELECT array_agg(DISTINCT tag ORDER BY tag) FROM public.contacts c CROSS JOIN LATERAL unnest(COALESCE(c.tags, '{}'::text[])) tag WHERE c.id = ANY(v_all_ids) AND NULLIF(trim(tag), '') IS NOT NULL), '{}'::text[]),
    pays = COALESCE(NULLIF(trim(p.pays), ''), (SELECT NULLIF(trim(c.pays), '') FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND NULLIF(trim(c.pays), '') IS NOT NULL ORDER BY c.created_at LIMIT 1), 'France'),
    secteur_activite = COALESCE(NULLIF(trim(p.secteur_activite), ''), (SELECT NULLIF(trim(c.secteur_activite), '') FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND NULLIF(trim(c.secteur_activite), '') IS NOT NULL ORDER BY c.created_at LIMIT 1), ''),
    adresse = COALESCE(NULLIF(trim(p.adresse), ''), (SELECT NULLIF(trim(c.adresse), '') FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND NULLIF(trim(c.adresse), '') IS NOT NULL ORDER BY c.created_at LIMIT 1), ''),
    ville = COALESCE(NULLIF(trim(p.ville), ''), (SELECT NULLIF(trim(c.ville), '') FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND NULLIF(trim(c.ville), '') IS NOT NULL ORDER BY c.created_at LIMIT 1), ''),
    code_postal = COALESCE(NULLIF(trim(p.code_postal), ''), (SELECT NULLIF(trim(c.code_postal), '') FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND NULLIF(trim(c.code_postal), '') IS NOT NULL ORDER BY c.created_at LIMIT 1), ''),
    latitude = COALESCE(p.latitude, (SELECT c.latitude FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND c.latitude IS NOT NULL ORDER BY c.created_at LIMIT 1)),
    longitude = COALESCE(p.longitude, (SELECT c.longitude FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND c.longitude IS NOT NULL ORDER BY c.created_at LIMIT 1)),
    instagram = COALESCE(NULLIF(trim(p.instagram), ''), (SELECT NULLIF(trim(c.instagram), '') FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND NULLIF(trim(c.instagram), '') IS NOT NULL ORDER BY c.created_at LIMIT 1), ''),
    facebook = COALESCE(NULLIF(trim(p.facebook), ''), (SELECT NULLIF(trim(c.facebook), '') FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND NULLIF(trim(c.facebook), '') IS NOT NULL ORDER BY c.created_at LIMIT 1), ''),
    linkedin = COALESCE(NULLIF(trim(p.linkedin), ''), (SELECT NULLIF(trim(c.linkedin), '') FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND NULLIF(trim(c.linkedin), '') IS NOT NULL ORDER BY c.created_at LIMIT 1), ''),
    twitter = COALESCE(NULLIF(trim(p.twitter), ''), (SELECT NULLIF(trim(c.twitter), '') FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND NULLIF(trim(c.twitter), '') IS NOT NULL ORDER BY c.created_at LIMIT 1), ''),
    siren_siret = COALESCE(NULLIF(trim(p.siren_siret), ''), (SELECT NULLIF(trim(c.siren_siret), '') FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND NULLIF(trim(c.siren_siret), '') IS NOT NULL ORDER BY c.created_at LIMIT 1), ''),
    notes_entreprise = COALESCE(v_notes, ''),
    site_web = COALESCE(NULLIF(trim(p.site_web), ''), (SELECT NULLIF(trim(c.site_web), '') FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND NULLIF(trim(c.site_web), '') IS NOT NULL ORDER BY c.created_at LIMIT 1), ''),
    pagespeed_mobile = COALESCE(p.pagespeed_mobile, (SELECT c.pagespeed_mobile FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND c.pagespeed_mobile IS NOT NULL ORDER BY c.pagespeed_checked_at DESC NULLS LAST LIMIT 1)),
    pagespeed_desktop = COALESCE(p.pagespeed_desktop, (SELECT c.pagespeed_desktop FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND c.pagespeed_desktop IS NOT NULL ORDER BY c.pagespeed_checked_at DESC NULLS LAST LIMIT 1)),
    pagespeed_checked_at = GREATEST(p.pagespeed_checked_at, (SELECT max(c.pagespeed_checked_at) FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids))),
    pagespeed_details = COALESCE(p.pagespeed_details, (SELECT c.pagespeed_details FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND c.pagespeed_details IS NOT NULL ORDER BY c.pagespeed_checked_at DESC NULLS LAST LIMIT 1)),
    derniere_interaction = (SELECT max(c.derniere_interaction) FROM public.contacts c WHERE c.id = ANY(v_all_ids)),
    created_at = (SELECT min(c.created_at) FROM public.contacts c WHERE c.id = ANY(v_all_ids)),
    email_opted_out_at = (SELECT min(c.email_opted_out_at) FROM public.contacts c WHERE c.id = ANY(v_all_ids)),
    email_opt_out_reason = COALESCE(NULLIF(trim(p.email_opt_out_reason), ''), (SELECT NULLIF(trim(c.email_opt_out_reason), '') FROM public.contacts c WHERE c.id = ANY(v_duplicate_ids) AND NULLIF(trim(c.email_opt_out_reason), '') IS NOT NULL ORDER BY c.created_at LIMIT 1), '')
  WHERE p.id = p_primary_id;

  -- Toutes les donnees liees sont rattachees a la fiche conservee avant suppression.
  UPDATE public.interactions SET contact_id = p_primary_id WHERE contact_id = ANY(v_duplicate_ids);
  UPDATE public.taches SET contact_id = p_primary_id WHERE contact_id = ANY(v_duplicate_ids);
  UPDATE public.relances SET contact_id = p_primary_id WHERE contact_id = ANY(v_duplicate_ids);
  UPDATE public.contact_documents SET contact_id = p_primary_id WHERE contact_id = ANY(v_duplicate_ids);
  UPDATE public.liste_appels SET contact_id = p_primary_id WHERE contact_id = ANY(v_duplicate_ids);
  UPDATE public.email_sequence_enrollments SET contact_id = p_primary_id WHERE contact_id = ANY(v_duplicate_ids);
  UPDATE public.ai_enrichments SET contact_id = p_primary_id WHERE contact_id = ANY(v_duplicate_ids);

  UPDATE public.contacts
  SET derniere_interaction = (SELECT max(i.date_heure) FROM public.interactions i WHERE i.contact_id = p_primary_id)
  WHERE id = p_primary_id;

  DELETE FROM public.contacts WHERE id = ANY(v_duplicate_ids);

  SELECT to_jsonb(c) INTO v_merged_after FROM public.contacts c WHERE c.id = p_primary_id;

  INSERT INTO public.contact_merge_audit(
    brand_id, primary_contact_id, duplicate_contact_ids, primary_before,
    duplicates_before, related_before, merged_after, merged_by
  ) VALUES (
    v_brand_id, p_primary_id, v_duplicate_ids, v_primary_before,
    v_duplicates_before, v_related_before, v_merged_after, auth.uid()
  ) RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'success', true,
    'primary_contact_id', p_primary_id,
    'merged_contact_count', v_expected,
    'audit_id', v_audit_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_merge_contacts(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_merge_contacts(uuid, uuid[]) TO authenticated;

/* Ignore les domaines sociaux generiques : deux pages Facebook ne sont pas le meme prospect. */
CREATE OR REPLACE FUNCTION public.admin_find_contact_duplicates()
RETURNS TABLE (
  match_type text,
  match_value text,
  contact_ids uuid[],
  contact_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acces reserve aux administrateurs';
  END IF;

  RETURN QUERY
  WITH normalized AS (
    SELECT
      c.id,
      regexp_replace(lower(trim(COALESCE(NULLIF(c.entreprise, ''), concat_ws(' ', c.prenom, c.nom)))), '[^[:alnum:]]+', '', 'g') AS company_key,
      regexp_replace(COALESCE(c.siren_siret, ''), '[^0-9]', '', 'g') AS siren_key,
      CASE WHEN length(regexp_replace(COALESCE(c.telephone, ''), '[^0-9]', '', 'g')) >= 9
        THEN right(regexp_replace(COALESCE(c.telephone, ''), '[^0-9]', '', 'g'), 9) ELSE '' END AS phone_key,
      regexp_replace(regexp_replace(lower(trim(COALESCE(c.site_web, ''))), '^https?://(www\.)?', ''), '[/#?].*$', '') AS website_key,
      lower(trim(COALESCE(c.email, ''))) AS email_key
    FROM public.contacts c
    WHERE c.brand_id = public.current_brand_id()
  ), duplicate_groups AS (
    SELECT 'entreprise'::text AS kind, company_key AS value, array_agg(id ORDER BY id) AS ids, count(*) AS total
    FROM normalized WHERE length(company_key) >= 4 GROUP BY company_key HAVING count(*) > 1
    UNION ALL
    SELECT 'siren_siret', siren_key, array_agg(id ORDER BY id), count(*)
    FROM normalized WHERE length(siren_key) >= 9 GROUP BY siren_key HAVING count(*) > 1
    UNION ALL
    SELECT 'telephone', phone_key, array_agg(id ORDER BY id), count(*)
    FROM normalized WHERE phone_key <> '' GROUP BY phone_key HAVING count(*) > 1
    UNION ALL
    SELECT 'site_web', website_key, array_agg(id ORDER BY id), count(*)
    FROM normalized
    WHERE length(website_key) >= 4
      AND website_key NOT IN ('facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'youtube.com', 'tiktok.com')
    GROUP BY website_key HAVING count(*) > 1
    UNION ALL
    SELECT 'email', email_key, array_agg(id ORDER BY id), count(*)
    FROM normalized
    WHERE email_key ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    GROUP BY email_key HAVING count(*) > 1
  )
  SELECT kind, value, ids, total
  FROM duplicate_groups
  ORDER BY total DESC, kind, value;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_find_contact_duplicates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_find_contact_duplicates() TO authenticated;
