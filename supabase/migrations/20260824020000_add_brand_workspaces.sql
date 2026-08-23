/*
  # Espaces de marque WebFitYou / Epiderme AI

  Toutes les donnees existantes sont rattachees a WebFitYou. Les nouvelles
  donnees utilisent l'espace actif du profil. Une politique restrictive
  complete les politiques de roles existantes afin d'empecher tout melange.
*/

CREATE TABLE IF NOT EXISTS public.brands (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_]+$'),
  name text NOT NULL,
  logo_url text NOT NULL DEFAULT '',
  accent_color text NOT NULL DEFAULT '#2563eb',
  email_provider text NOT NULL CHECK (email_provider IN ('gmail', 'resend')),
  from_name text NOT NULL,
  from_email text NOT NULL,
  reply_to text,
  unsubscribe_email text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.brands (
  id, code, name, logo_url, accent_color, email_provider,
  from_name, from_email, reply_to, unsubscribe_email
) VALUES
  (
    '11111111-1111-4111-8111-111111111111', 'webfityou', 'WebFitYou',
    'https://ptzpnswtgevfxfeosjfj.supabase.co/storage/v1/object/public/Images/Webfityou-logo-seo-siteweb-ia-complet.png',
    '#2563eb', 'gmail', 'WebFitYou', 'contact@webfityou.com',
    'contact@webfityou.com', 'contact@webfityou.com'
  ),
  (
    '22222222-2222-4222-8222-222222222222', 'epiderme_ai', 'Epiderme AI',
    'https://ongcadzzheyyigickvfu.supabase.co/storage/v1/object/public/images%20site%20web/Epiderme-AI%20(2).png',
    '#2563eb', 'resend', 'Epiderme AI', 'noreply@epiderme-ai.com',
    NULL, 'nb.epidermai@gmail.com'
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  logo_url = EXCLUDED.logo_url,
  accent_color = EXCLUDED.accent_color,
  email_provider = EXCLUDED.email_provider,
  from_name = EXCLUDED.from_name,
  from_email = EXCLUDED.from_email,
  reply_to = EXCLUDED.reply_to,
  unsubscribe_email = EXCLUDED.unsubscribe_email,
  active = true,
  updated_at = now();

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_brand_id uuid REFERENCES public.brands(id);
UPDATE public.profiles
SET active_brand_id = '11111111-1111-4111-8111-111111111111'
WHERE active_brand_id IS NULL;
ALTER TABLE public.profiles
  ALTER COLUMN active_brand_id SET DEFAULT '11111111-1111-4111-8111-111111111111',
  ALTER COLUMN active_brand_id SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.profile_brands (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, brand_id)
);

-- Tous les utilisateurs existants conservent WebFitYou. L'administrateur
-- principal dispose en plus de l'espace Epiderme AI.
INSERT INTO public.profile_brands (profile_id, brand_id)
SELECT id, '11111111-1111-4111-8111-111111111111' FROM public.profiles
ON CONFLICT DO NOTHING;
INSERT INTO public.profile_brands (profile_id, brand_id)
SELECT id, '22222222-2222-4222-8222-222222222222'
FROM public.profiles
WHERE lower(email) = 'contact@webfityou.com'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.current_brand_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT active_brand_id FROM public.profiles WHERE id = auth.uid() AND active = true),
    '11111111-1111-4111-8111-111111111111'::uuid
  );
$$;

CREATE OR REPLACE FUNCTION public.has_brand_access(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profile_brands pb
    JOIN public.profiles p ON p.id = pb.profile_id
    WHERE pb.profile_id = auth.uid()
      AND pb.brand_id = p_brand_id
      AND p.active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.switch_active_brand(p_brand_code text)
RETURNS public.brands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand public.brands;
BEGIN
  SELECT b.* INTO v_brand
  FROM public.brands b
  JOIN public.profile_brands pb ON pb.brand_id = b.id
  WHERE pb.profile_id = auth.uid()
    AND b.code = p_brand_code
    AND b.active = true;

  IF v_brand.id IS NULL THEN
    RAISE EXCEPTION 'Espace inaccessible';
  END IF;

  UPDATE public.profiles
  SET active_brand_id = v_brand.id, updated_at = now()
  WHERE id = auth.uid() AND active = true;
  RETURN v_brand;
END;
$$;

REVOKE ALL ON FUNCTION public.current_brand_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_brand_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.switch_active_brand(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_brand_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_brand_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.switch_active_brand(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.grant_default_brand_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profile_brands(profile_id, brand_id)
  VALUES (NEW.id, '11111111-1111-4111-8111-111111111111')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS grant_default_brand_on_profile ON public.profiles;
CREATE TRIGGER grant_default_brand_on_profile
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.grant_default_brand_access();

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_brands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view accessible brands" ON public.brands;
CREATE POLICY "Users view accessible brands" ON public.brands
  FOR SELECT TO authenticated
  USING (active AND public.has_brand_access(id));
DROP POLICY IF EXISTS "Users view own brand memberships" ON public.profile_brands;
CREATE POLICY "Users view own brand memberships" ON public.profile_brands
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.is_admin());

GRANT SELECT ON public.brands, public.profile_brands TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brands, public.profile_brands TO service_role;

-- Ajout mecanique de brand_id a toutes les donnees fonctionnelles.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'contacts', 'interactions', 'taches', 'objectifs', 'sessions_travail',
    'recaps_journaliers', 'liste_appels', 'app_settings', 'relances',
    'contact_documents', 'email_sequences', 'email_sequence_enrollments',
    'ai_enrichments', 'templates', 'scripts_phoning', 'api_clients',
    'agent_audit_logs'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES public.brands(id)',
      table_name
    );
    EXECUTE format(
      'UPDATE public.%I SET brand_id = $1 WHERE brand_id IS NULL',
      table_name
    ) USING '11111111-1111-4111-8111-111111111111'::uuid;
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN brand_id SET DEFAULT public.current_brand_id()',
      table_name
    );
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN brand_id SET NOT NULL',
      table_name
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I(brand_id)',
      'idx_' || table_name || '_brand_id', table_name
    );
  END LOOP;
END $$;

-- Les journaux d'idempotence heritent de la marque de leur cle API.
ALTER TABLE public.agent_idempotency
  ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES public.brands(id);
UPDATE public.agent_idempotency i
SET brand_id = c.brand_id
FROM public.api_clients c
WHERE i.client_id = c.id AND i.brand_id IS NULL;
UPDATE public.agent_idempotency
SET brand_id = '11111111-1111-4111-8111-111111111111'
WHERE brand_id IS NULL;
ALTER TABLE public.agent_idempotency ALTER COLUMN brand_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_idempotency_brand_id ON public.agent_idempotency(brand_id);

ALTER TABLE public.objectifs DROP CONSTRAINT IF EXISTS objectifs_user_date_key;
ALTER TABLE public.objectifs
  ADD CONSTRAINT objectifs_brand_user_date_key UNIQUE (brand_id, user_id, date);

-- Une politique RESTRICTIVE s'ajoute avec AND aux droits existants.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'contacts', 'interactions', 'taches', 'objectifs', 'sessions_travail',
    'recaps_journaliers', 'liste_appels', 'app_settings', 'relances',
    'contact_documents', 'email_sequences', 'email_sequence_enrollments',
    'ai_enrichments', 'templates', 'scripts_phoning', 'api_clients',
    'agent_audit_logs'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Brand workspace isolation" ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY "Brand workspace isolation" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (brand_id = public.current_brand_id() AND public.has_brand_access(brand_id)) WITH CHECK (brand_id = public.current_brand_id() AND public.has_brand_access(brand_id))',
      table_name
    );
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS update_brands_updated_at ON public.brands;
CREATE TRIGGER update_brands_updated_at
  BEFORE UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Version marque-aware de l'operation transactionnelle utilisee par OpenClaw.
CREATE OR REPLACE FUNCTION public.crm_agent_record_followup(
  p_contact_id uuid,
  p_contact jsonb,
  p_interaction jsonb,
  p_task jsonb,
  p_assigned_to uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_id uuid := p_contact_id;
  v_assigned_to uuid := p_assigned_to;
  v_brand_id uuid := NULLIF(p_contact->>'_brand_id', '')::uuid;
  v_interaction_id uuid;
  v_task_id uuid;
  v_email text := lower(trim(COALESCE(p_contact->>'email', '')));
  v_phone text := regexp_replace(COALESCE(p_contact->>'telephone', ''), '[^0-9+]', '', 'g');
  v_type text := COALESCE(NULLIF(p_interaction->>'type', ''), 'Appel');
  v_result text := COALESCE(p_interaction->>'resultat', '');
BEGIN
  IF v_brand_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.brands WHERE id = v_brand_id AND active) THEN
    RAISE EXCEPTION 'Espace de marque invalide';
  END IF;
  IF v_assigned_to IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.profile_brands pb ON pb.profile_id = p.id
    WHERE p.id = v_assigned_to AND p.active AND pb.brand_id = v_brand_id
  ) THEN
    RAISE EXCEPTION 'Un utilisateur actif de cet espace doit etre indique pour le suivi';
  END IF;

  IF v_contact_id IS NULL AND v_email <> '' THEN
    SELECT id INTO v_contact_id FROM public.contacts
    WHERE brand_id = v_brand_id AND lower(email) = v_email ORDER BY created_at LIMIT 1;
  END IF;
  IF v_contact_id IS NULL AND v_phone <> '' THEN
    SELECT id INTO v_contact_id FROM public.contacts
    WHERE brand_id = v_brand_id
      AND regexp_replace(COALESCE(telephone, ''), '[^0-9+]', '', 'g') = v_phone
    ORDER BY created_at LIMIT 1;
  END IF;

  IF v_contact_id IS NULL THEN
    INSERT INTO public.contacts (
      prenom, nom, email, telephone, entreprise, statut, pays,
      secteur_activite, notes_entreprise, tags, assigned_to, created_by, brand_id
    ) VALUES (
      COALESCE(p_contact->>'prenom', ''), COALESCE(p_contact->>'nom', ''),
      COALESCE(p_contact->>'email', ''), COALESCE(p_contact->>'telephone', ''),
      COALESCE(p_contact->>'entreprise', ''),
      CASE WHEN p_contact->>'statut' IN ('Nouveau', 'En cours', 'Converti', 'Perdu')
        THEN p_contact->>'statut' ELSE 'Nouveau' END,
      COALESCE(NULLIF(p_contact->>'pays', ''), 'France'),
      COALESCE(p_contact->>'secteur_activite', ''),
      COALESCE(p_contact->>'notes_entreprise', ''),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_contact->'tags', '[]'::jsonb))),
      v_assigned_to, v_assigned_to, v_brand_id
    ) RETURNING id INTO v_contact_id;
  ELSE
    UPDATE public.contacts SET
      assigned_to = v_assigned_to,
      statut = CASE WHEN p_contact->>'statut' IN ('Nouveau', 'En cours', 'Converti', 'Perdu')
        THEN p_contact->>'statut' ELSE statut END,
      updated_at = now()
    WHERE id = v_contact_id AND brand_id = v_brand_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Contact introuvable dans cet espace'; END IF;
  END IF;

  IF v_type NOT IN ('Appel', 'Email', 'WhatsApp', 'SMS', 'Facebook', 'Instagram') THEN
    RAISE EXCEPTION 'Type d''interaction invalide';
  END IF;

  INSERT INTO public.interactions (
    contact_id, user_id, type, date_heure, duree, resultat, notes, brand_id
  ) VALUES (
    v_contact_id, v_assigned_to, v_type,
    COALESCE(NULLIF(p_interaction->>'date_heure', '')::timestamptz, now()),
    GREATEST(0, COALESCE((p_interaction->>'duree')::integer, 0)),
    v_result, COALESCE(p_interaction->>'notes', ''), v_brand_id
  ) RETURNING id INTO v_interaction_id;

  IF p_task IS NOT NULL AND COALESCE(trim(p_task->>'titre'), '') <> '' THEN
    INSERT INTO public.taches (
      contact_id, titre, description, date_echeance, statut, assigned_to, created_by, brand_id
    ) VALUES (
      v_contact_id, trim(p_task->>'titre'), COALESCE(p_task->>'description', ''),
      NULLIF(p_task->>'date_echeance', '')::timestamptz,
      'En attente', v_assigned_to, v_assigned_to, v_brand_id
    ) RETURNING id INTO v_task_id;
  END IF;

  RETURN jsonb_build_object(
    'brand_id', v_brand_id,
    'contact_id', v_contact_id,
    'interaction_id', v_interaction_id,
    'task_id', v_task_id
  );
END;
$$;
