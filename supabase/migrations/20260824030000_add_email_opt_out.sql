/* Opposition email geree depuis la fiche contact. */
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS email_opted_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_opt_out_reason text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_contacts_brand_email_opt_out
  ON public.contacts(brand_id, lower(email), email_opted_out_at);

-- L'application ne necessite aucun acces anonyme aux donnees metier.
REVOKE ALL ON TABLE
  public.contacts, public.interactions, public.taches, public.objectifs,
  public.sessions_travail, public.recaps_journaliers, public.liste_appels,
  public.app_settings, public.relances, public.contact_documents,
  public.email_sequences, public.email_sequence_enrollments,
  public.ai_enrichments, public.templates, public.scripts_phoning,
  public.api_clients, public.agent_audit_logs, public.agent_idempotency,
  public.brands, public.profile_brands
FROM anon;
