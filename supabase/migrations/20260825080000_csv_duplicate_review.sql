/* Controle des doublons avant import CSV et resolution sans casser l'historique. */

CREATE TABLE IF NOT EXISTS public.csv_import_resolution_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('merge', 'replace')),
  contact_before jsonb NOT NULL,
  incoming_data jsonb NOT NULL,
  contact_after jsonb NOT NULL,
  resolved_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.csv_import_resolution_audit ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_csv_import_resolution_audit_brand_created
  ON public.csv_import_resolution_audit(brand_id, created_at DESC);
DROP POLICY IF EXISTS "Admins can view CSV resolution audit" ON public.csv_import_resolution_audit;
CREATE POLICY "Admins can view CSV resolution audit"
  ON public.csv_import_resolution_audit FOR SELECT TO authenticated
  USING (public.is_admin() AND brand_id = public.current_brand_id());
REVOKE ALL ON TABLE public.csv_import_resolution_audit FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.csv_import_resolution_audit TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.csv_import_resolution_audit TO service_role;

CREATE OR REPLACE FUNCTION public.find_csv_contact_duplicates(p_rows jsonb)
RETURNS TABLE (
  incoming_index integer,
  contact_id uuid,
  match_types text[],
  existing_contact jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.active = true
  ) THEN
    RAISE EXCEPTION 'Utilisateur non autorise';
  END IF;

  RETURN QUERY
  WITH incoming AS (
    SELECT
      (item->>'index')::integer AS row_index,
      item AS payload,
      regexp_replace(lower(trim(COALESCE(NULLIF(item->>'entreprise', ''), concat_ws(' ', item->>'prenom', item->>'nom')))), '[^[:alnum:]]+', '', 'g') AS company_key,
      regexp_replace(COALESCE(item->>'siren_siret', ''), '[^0-9]', '', 'g') AS siren_key,
      CASE WHEN length(regexp_replace(COALESCE(item->>'telephone', ''), '[^0-9]', '', 'g')) >= 9
        THEN right(regexp_replace(COALESCE(item->>'telephone', ''), '[^0-9]', '', 'g'), 9) ELSE '' END AS phone_key,
      regexp_replace(regexp_replace(lower(trim(COALESCE(item->>'site_web', ''))), '^https?://(www\.)?', ''), '[/#?].*$', '') AS website_key,
      lower(trim(COALESCE(item->>'email', ''))) AS email_key
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) item
  ), existing AS (
    SELECT
      c.*,
      regexp_replace(lower(trim(COALESCE(NULLIF(c.entreprise, ''), concat_ws(' ', c.prenom, c.nom)))), '[^[:alnum:]]+', '', 'g') AS company_key,
      regexp_replace(COALESCE(c.siren_siret, ''), '[^0-9]', '', 'g') AS siren_key,
      CASE WHEN length(regexp_replace(COALESCE(c.telephone, ''), '[^0-9]', '', 'g')) >= 9
        THEN right(regexp_replace(COALESCE(c.telephone, ''), '[^0-9]', '', 'g'), 9) ELSE '' END AS phone_key,
      regexp_replace(regexp_replace(lower(trim(COALESCE(c.site_web, ''))), '^https?://(www\.)?', ''), '[/#?].*$', '') AS website_key,
      lower(trim(COALESCE(c.email, ''))) AS email_key
    FROM public.contacts c
    WHERE c.brand_id = public.current_brand_id()
  ), matches AS (
    SELECT
      i.row_index,
      e.id,
      array_remove(ARRAY[
        CASE WHEN length(i.company_key) >= 4 AND i.company_key = e.company_key THEN 'entreprise' END,
        CASE WHEN length(i.siren_key) >= 9 AND i.siren_key = e.siren_key THEN 'siren_siret' END,
        CASE WHEN i.phone_key <> '' AND i.phone_key = e.phone_key THEN 'telephone' END,
        CASE WHEN length(i.website_key) >= 4
          AND i.website_key NOT IN ('facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'youtube.com', 'tiktok.com')
          AND i.website_key = e.website_key THEN 'site_web' END,
        CASE WHEN i.email_key ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
          AND i.email_key = e.email_key THEN 'email' END
      ], NULL)::text[] AS criteria,
      to_jsonb(e) - ARRAY['company_key', 'siren_key', 'phone_key', 'website_key', 'email_key'] AS contact
    FROM incoming i
    CROSS JOIN existing e
  )
  SELECT m.row_index, m.id, m.criteria, m.contact
  FROM matches m
  WHERE cardinality(m.criteria) > 0
  ORDER BY m.row_index, cardinality(m.criteria) DESC, m.id;
END;
$$;

REVOKE ALL ON FUNCTION public.find_csv_contact_duplicates(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_csv_contact_duplicates(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_csv_contact_duplicate(
  p_contact_id uuid,
  p_incoming jsonb,
  p_action text,
  p_mapped_fields text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_contact public.contacts%ROWTYPE;
  v_notes text;
  v_before jsonb;
  v_after jsonb;
BEGIN
  SELECT p.role INTO v_role FROM public.profiles p
  WHERE p.id = auth.uid() AND p.active = true;

  IF v_role NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'Votre role ne permet pas de modifier une fiche existante';
  END IF;
  IF p_action NOT IN ('merge', 'replace') THEN
    RAISE EXCEPTION 'Action CSV invalide';
  END IF;

  SELECT * INTO v_contact FROM public.contacts
  WHERE id = p_contact_id AND brand_id = public.current_brand_id()
  FOR UPDATE;
  IF v_contact.id IS NULL THEN RAISE EXCEPTION 'Contact introuvable dans cet espace'; END IF;
  v_before := to_jsonb(v_contact);

  IF p_action = 'merge' THEN
    SELECT string_agg(note, E'\n\n') INTO v_notes
    FROM (
      SELECT DISTINCT NULLIF(trim(note), '') AS note
      FROM (VALUES (v_contact.notes_entreprise), (p_incoming->>'notes_entreprise')) values_list(note)
    ) distinct_notes WHERE note IS NOT NULL;

    UPDATE public.contacts c SET
      prenom = COALESCE(NULLIF(trim(c.prenom), ''), NULLIF(trim(p_incoming->>'prenom'), ''), ''),
      nom = COALESCE(NULLIF(trim(c.nom), ''), NULLIF(trim(p_incoming->>'nom'), ''), ''),
      entreprise = COALESCE(NULLIF(trim(c.entreprise), ''), NULLIF(trim(p_incoming->>'entreprise'), ''), ''),
      email = COALESCE(NULLIF(trim(c.email), ''), NULLIF(trim(p_incoming->>'email'), ''), ''),
      telephone = COALESCE(NULLIF(trim(c.telephone), ''), NULLIF(trim(p_incoming->>'telephone'), ''), ''),
      pays = COALESCE(NULLIF(trim(c.pays), ''), NULLIF(trim(p_incoming->>'pays'), ''), 'France'),
      secteur_activite = COALESCE(NULLIF(trim(c.secteur_activite), ''), NULLIF(trim(p_incoming->>'secteur_activite'), ''), ''),
      statut = CASE WHEN c.statut = 'Nouveau' AND NULLIF(trim(p_incoming->>'statut'), '') IS NOT NULL THEN p_incoming->>'statut' ELSE c.statut END,
      adresse = COALESCE(NULLIF(trim(c.adresse), ''), NULLIF(trim(p_incoming->>'adresse'), ''), ''),
      ville = COALESCE(NULLIF(trim(c.ville), ''), NULLIF(trim(p_incoming->>'ville'), ''), ''),
      code_postal = COALESCE(NULLIF(trim(c.code_postal), ''), NULLIF(trim(p_incoming->>'code_postal'), ''), ''),
      site_web = COALESCE(NULLIF(trim(c.site_web), ''), NULLIF(trim(p_incoming->>'site_web'), ''), ''),
      siren_siret = COALESCE(NULLIF(trim(c.siren_siret), ''), NULLIF(trim(p_incoming->>'siren_siret'), ''), ''),
      notes_entreprise = COALESCE(v_notes, ''),
      linkedin = COALESCE(NULLIF(trim(c.linkedin), ''), NULLIF(trim(p_incoming->>'linkedin'), ''), ''),
      instagram = COALESCE(NULLIF(trim(c.instagram), ''), NULLIF(trim(p_incoming->>'instagram'), ''), ''),
      facebook = COALESCE(NULLIF(trim(c.facebook), ''), NULLIF(trim(p_incoming->>'facebook'), ''), ''),
      twitter = COALESCE(NULLIF(trim(c.twitter), ''), NULLIF(trim(p_incoming->>'twitter'), ''), '')
    WHERE c.id = p_contact_id;
  ELSE
    UPDATE public.contacts c SET
      prenom = CASE WHEN 'prenom' = ANY(p_mapped_fields) THEN COALESCE(p_incoming->>'prenom', '') ELSE c.prenom END,
      nom = CASE WHEN 'nom' = ANY(p_mapped_fields) THEN COALESCE(p_incoming->>'nom', '') ELSE c.nom END,
      entreprise = CASE WHEN 'entreprise' = ANY(p_mapped_fields) THEN COALESCE(p_incoming->>'entreprise', '') ELSE c.entreprise END,
      email = CASE WHEN 'email' = ANY(p_mapped_fields) THEN COALESCE(p_incoming->>'email', '') ELSE c.email END,
      telephone = CASE WHEN 'telephone' = ANY(p_mapped_fields) THEN COALESCE(p_incoming->>'telephone', '') ELSE c.telephone END,
      pays = CASE WHEN 'pays' = ANY(p_mapped_fields) THEN COALESCE(p_incoming->>'pays', 'France') ELSE c.pays END,
      secteur_activite = CASE WHEN 'secteur_activite' = ANY(p_mapped_fields) THEN COALESCE(p_incoming->>'secteur_activite', '') ELSE c.secteur_activite END,
      statut = CASE WHEN 'statut' = ANY(p_mapped_fields) THEN COALESCE(p_incoming->>'statut', 'Nouveau') ELSE c.statut END,
      adresse = CASE WHEN 'adresse' = ANY(p_mapped_fields) THEN COALESCE(p_incoming->>'adresse', '') ELSE c.adresse END,
      ville = CASE WHEN 'ville' = ANY(p_mapped_fields) THEN COALESCE(p_incoming->>'ville', '') ELSE c.ville END,
      code_postal = CASE WHEN 'code_postal' = ANY(p_mapped_fields) THEN COALESCE(p_incoming->>'code_postal', '') ELSE c.code_postal END,
      site_web = CASE WHEN 'site_web' = ANY(p_mapped_fields) THEN COALESCE(p_incoming->>'site_web', '') ELSE c.site_web END,
      siren_siret = CASE WHEN 'siren_siret' = ANY(p_mapped_fields) THEN COALESCE(p_incoming->>'siren_siret', '') ELSE c.siren_siret END,
      notes_entreprise = CASE WHEN 'notes_entreprise' = ANY(p_mapped_fields) THEN COALESCE(p_incoming->>'notes_entreprise', '') ELSE c.notes_entreprise END,
      linkedin = CASE WHEN 'linkedin' = ANY(p_mapped_fields) THEN COALESCE(p_incoming->>'linkedin', '') ELSE c.linkedin END,
      instagram = CASE WHEN 'instagram' = ANY(p_mapped_fields) THEN COALESCE(p_incoming->>'instagram', '') ELSE c.instagram END,
      facebook = CASE WHEN 'facebook' = ANY(p_mapped_fields) THEN COALESCE(p_incoming->>'facebook', '') ELSE c.facebook END,
      twitter = CASE WHEN 'twitter' = ANY(p_mapped_fields) THEN COALESCE(p_incoming->>'twitter', '') ELSE c.twitter END
    WHERE c.id = p_contact_id;
  END IF;

  SELECT to_jsonb(c) INTO v_after FROM public.contacts c WHERE c.id = p_contact_id;
  INSERT INTO public.csv_import_resolution_audit(
    brand_id, contact_id, action, contact_before, incoming_data, contact_after, resolved_by
  ) VALUES (
    public.current_brand_id(), p_contact_id, p_action, v_before, p_incoming, v_after, auth.uid()
  );

  RETURN jsonb_build_object('success', true, 'action', p_action, 'contact_id', p_contact_id);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_csv_contact_duplicate(uuid, jsonb, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_csv_contact_duplicate(uuid, jsonb, text, text[]) TO authenticated;
