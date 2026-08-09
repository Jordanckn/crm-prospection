/*
  # Intégrations API et agents

  Identités techniques à privilèges explicites, journal d'audit immuable,
  protection contre les doublons et opération transactionnelle de suivi.
*/

CREATE TABLE IF NOT EXISTS public.api_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_clients_permissions_array CHECK (jsonb_typeof(permissions) = 'array')
);

CREATE TABLE IF NOT EXISTS public.agent_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL,
  client_id uuid REFERENCES public.api_clients(id) ON DELETE SET NULL,
  admin_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL DEFAULT '',
  entity_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.api_clients(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  action text NOT NULL,
  request_hash text NOT NULL,
  state text NOT NULL DEFAULT 'processing' CHECK (state IN ('processing', 'completed', 'failed')),
  status_code integer,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  UNIQUE (client_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_audit_created_at ON public.agent_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_audit_client ON public.agent_audit_logs(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_idempotency_expiry ON public.agent_idempotency(expires_at);

ALTER TABLE public.api_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_idempotency ENABLE ROW LEVEL SECURITY;

-- Grants explicites, compatibles avec les nouveaux projets Supabase qui
-- n'exposent plus automatiquement les tables créées par migration.
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.profiles,
  public.contacts,
  public.interactions,
  public.taches,
  public.objectifs,
  public.sessions_travail,
  public.recaps_journaliers,
  public.liste_appels,
  public.app_settings,
  public.relances,
  public.contact_documents,
  public.email_sequences,
  public.email_sequence_enrollments,
  public.ai_enrichments,
  public.templates,
  public.scripts_phoning
TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.api_clients,
  public.agent_audit_logs,
  public.agent_idempotency
TO service_role;
GRANT SELECT ON TABLE public.api_clients, public.agent_audit_logs TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

CREATE POLICY "Admins view API clients"
  ON public.api_clients FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY "Admins view agent audit logs"
  ON public.agent_audit_logs FOR SELECT TO authenticated
  USING (public.is_admin());

-- Les mutations passent exclusivement par l'Edge Function avec la service role.
REVOKE INSERT, UPDATE, DELETE ON public.api_clients FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.agent_audit_logs FROM authenticated, anon;
REVOKE ALL ON public.agent_idempotency FROM authenticated, anon;

DROP TRIGGER IF EXISTS update_api_clients_updated_at ON public.api_clients;
CREATE TRIGGER update_api_clients_updated_at
  BEFORE UPDATE ON public.api_clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enregistre un suivi complet dans une seule transaction : contact, interaction et tâche.
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
  v_interaction_id uuid;
  v_task_id uuid;
  v_email text := lower(trim(COALESCE(p_contact->>'email', '')));
  v_phone text := regexp_replace(COALESCE(p_contact->>'telephone', ''), '[^0-9+]', '', 'g');
  v_type text := COALESCE(NULLIF(p_interaction->>'type', ''), 'Appel');
  v_result text := COALESCE(p_interaction->>'resultat', '');
BEGIN
  IF v_assigned_to IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = v_assigned_to AND active = true
  ) THEN
    RAISE EXCEPTION 'Un utilisateur actif doit être indiqué pour le suivi';
  END IF;

  IF v_contact_id IS NULL AND v_email <> '' THEN
    SELECT id INTO v_contact_id FROM public.contacts
    WHERE lower(email) = v_email ORDER BY created_at LIMIT 1;
  END IF;
  IF v_contact_id IS NULL AND v_phone <> '' THEN
    SELECT id INTO v_contact_id FROM public.contacts
    WHERE regexp_replace(COALESCE(telephone, ''), '[^0-9+]', '', 'g') = v_phone
    ORDER BY created_at LIMIT 1;
  END IF;

  IF v_contact_id IS NULL THEN
    INSERT INTO public.contacts (
      prenom, nom, email, telephone, entreprise, statut, pays,
      secteur_activite, notes_entreprise, tags, assigned_to, created_by
    ) VALUES (
      COALESCE(p_contact->>'prenom', ''),
      COALESCE(p_contact->>'nom', ''),
      COALESCE(p_contact->>'email', ''),
      COALESCE(p_contact->>'telephone', ''),
      COALESCE(p_contact->>'entreprise', ''),
      CASE WHEN p_contact->>'statut' IN ('Nouveau', 'En cours', 'Converti', 'Perdu')
        THEN p_contact->>'statut' ELSE 'Nouveau' END,
      COALESCE(NULLIF(p_contact->>'pays', ''), 'France'),
      COALESCE(p_contact->>'secteur_activite', ''),
      COALESCE(p_contact->>'notes_entreprise', ''),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_contact->'tags', '[]'::jsonb))),
      v_assigned_to,
      v_assigned_to
    ) RETURNING id INTO v_contact_id;
  ELSE
    UPDATE public.contacts SET
      assigned_to = v_assigned_to,
      statut = CASE WHEN p_contact->>'statut' IN ('Nouveau', 'En cours', 'Converti', 'Perdu')
        THEN p_contact->>'statut' ELSE statut END,
      updated_at = now()
    WHERE id = v_contact_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Contact introuvable'; END IF;
  END IF;

  IF v_type NOT IN ('Appel', 'Email', 'WhatsApp', 'SMS', 'Facebook', 'Instagram') THEN
    RAISE EXCEPTION 'Type d''interaction invalide';
  END IF;

  INSERT INTO public.interactions (
    contact_id, user_id, type, date_heure, duree, resultat, notes
  ) VALUES (
    v_contact_id,
    v_assigned_to,
    v_type,
    COALESCE(NULLIF(p_interaction->>'date_heure', '')::timestamptz, now()),
    GREATEST(0, COALESCE((p_interaction->>'duree')::integer, 0)),
    v_result,
    COALESCE(p_interaction->>'notes', '')
  ) RETURNING id INTO v_interaction_id;

  IF p_task IS NOT NULL AND COALESCE(trim(p_task->>'titre'), '') <> '' THEN
    INSERT INTO public.taches (
      contact_id, titre, description, date_echeance, statut, assigned_to, created_by
    ) VALUES (
      v_contact_id,
      trim(p_task->>'titre'),
      COALESCE(p_task->>'description', ''),
      NULLIF(p_task->>'date_echeance', '')::timestamptz,
      'En attente',
      v_assigned_to,
      v_assigned_to
    ) RETURNING id INTO v_task_id;
  END IF;

  RETURN jsonb_build_object(
    'contact_id', v_contact_id,
    'interaction_id', v_interaction_id,
    'task_id', v_task_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.crm_agent_record_followup(uuid, jsonb, jsonb, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_agent_record_followup(uuid, jsonb, jsonb, jsonb, uuid) TO service_role;
