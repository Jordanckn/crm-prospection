/*
  # Trois niveaux d'accès CRM

  - admin: lecture, ajout, modification, suppression et administration
  - editor: lecture, ajout et modification, sans suppression ni administration
  - contributor: lecture et ajout uniquement, sans modification, suppression ni administration
*/

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
UPDATE public.profiles SET role = 'contributor' WHERE role = 'commercial';
ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'contributor';
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'editor', 'contributor'));

UPDATE public.profiles
SET role = 'admin', active = true, updated_at = now()
WHERE lower(email) = 'contact@webfityou.com';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_role text;
BEGIN
  requested_role := CASE
    WHEN NEW.raw_user_meta_data->>'role' IN ('admin', 'editor', 'contributor')
      THEN NEW.raw_user_meta_data->>'role'
    ELSE 'contributor'
  END;

  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    CASE WHEN lower(COALESCE(NEW.email, '')) = 'contact@webfityou.com' THEN 'admin' ELSE requested_role END
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), profiles.full_name),
        role = CASE WHEN lower(EXCLUDED.email) = 'contact@webfityou.com' THEN 'admin' ELSE profiles.role END,
        active = CASE WHEN lower(EXCLUDED.email) = 'contact@webfityou.com' THEN true ELSE profiles.active END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_modify()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND active = true AND role IN ('admin', 'editor')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_delete()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin();
$$;

REVOKE ALL ON FUNCTION public.can_modify() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_delete() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_modify() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_delete() TO authenticated;

CREATE OR REPLACE FUNCTION public.protect_primary_admin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF lower(OLD.email) = 'contact@webfityou.com' THEN
    NEW.email := OLD.email;
    NEW.role := 'admin';
    NEW.active := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_primary_admin_profile ON public.profiles;
CREATE TRIGGER protect_primary_admin_profile
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_primary_admin();

-- Retire toutes les anciennes politiques UPDATE/DELETE (y compris FOR ALL)
-- des tables métier avant de recréer les droits explicites.
DO $$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'contacts', 'interactions', 'taches', 'objectifs',
        'sessions_travail', 'recaps_journaliers', 'liste_appels',
        'contact_documents', 'relances', 'email_sequence_enrollments',
        'ai_enrichments', 'templates', 'scripts_phoning', 'email_sequences',
        'app_settings'
      )
      AND cmd IN ('UPDATE', 'DELETE', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
      policy_record.policyname, policy_record.schemaname, policy_record.tablename);
  END LOOP;
END $$;

-- Données affectées : un éditeur modifie uniquement son périmètre ; seul un admin supprime.
CREATE POLICY "Editors update assigned contacts"
  ON public.contacts FOR UPDATE TO authenticated
  USING (public.can_modify() AND (assigned_to = auth.uid() OR public.is_admin()))
  WITH CHECK (public.can_modify() AND (assigned_to = auth.uid() OR public.is_admin()));
CREATE POLICY "Admins delete contacts"
  ON public.contacts FOR DELETE TO authenticated USING (public.can_delete());

CREATE POLICY "Editors update own interactions"
  ON public.interactions FOR UPDATE TO authenticated
  USING (
    public.can_modify() AND (
      public.is_admin() OR (
        user_id = auth.uid() AND EXISTS (
          SELECT 1 FROM public.contacts c WHERE c.id = contact_id AND c.assigned_to = auth.uid()
        )
      )
    )
  )
  WITH CHECK (
    public.can_modify() AND (
      public.is_admin() OR (
        user_id = auth.uid() AND EXISTS (
          SELECT 1 FROM public.contacts c WHERE c.id = contact_id AND c.assigned_to = auth.uid()
        )
      )
    )
  );
CREATE POLICY "Admins delete interactions"
  ON public.interactions FOR DELETE TO authenticated USING (public.can_delete());

CREATE POLICY "Editors update assigned tasks"
  ON public.taches FOR UPDATE TO authenticated
  USING (public.can_modify() AND (assigned_to = auth.uid() OR public.is_admin()))
  WITH CHECK (public.can_modify() AND (assigned_to = auth.uid() OR public.is_admin()));
CREATE POLICY "Admins delete tasks"
  ON public.taches FOR DELETE TO authenticated USING (public.can_delete());

CREATE POLICY "Editors update own goals"
  ON public.objectifs FOR UPDATE TO authenticated
  USING (public.can_modify() AND (user_id = auth.uid() OR public.is_admin()))
  WITH CHECK (public.can_modify() AND (user_id = auth.uid() OR public.is_admin()));
CREATE POLICY "Admins delete goals"
  ON public.objectifs FOR DELETE TO authenticated USING (public.can_delete());

CREATE POLICY "Editors update own sessions"
  ON public.sessions_travail FOR UPDATE TO authenticated
  USING (public.can_modify() AND (user_id = auth.uid() OR public.is_admin()))
  WITH CHECK (public.can_modify() AND (user_id = auth.uid() OR public.is_admin()));
CREATE POLICY "Admins delete sessions"
  ON public.sessions_travail FOR DELETE TO authenticated USING (public.can_delete());

CREATE POLICY "Editors update own recaps"
  ON public.recaps_journaliers FOR UPDATE TO authenticated
  USING (public.can_modify() AND (user_id = auth.uid() OR public.is_admin()))
  WITH CHECK (public.can_modify() AND (user_id = auth.uid() OR public.is_admin()));
CREATE POLICY "Admins delete recaps"
  ON public.recaps_journaliers FOR DELETE TO authenticated USING (public.can_delete());

CREATE POLICY "Editors update own call lists"
  ON public.liste_appels FOR UPDATE TO authenticated
  USING (public.can_modify() AND (user_id = auth.uid() OR public.is_admin()))
  WITH CHECK (
    public.can_modify() AND (user_id = auth.uid() OR public.is_admin())
    AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_id AND (c.assigned_to = public.liste_appels.user_id OR public.is_admin())
    )
  );
CREATE POLICY "Admins delete call lists"
  ON public.liste_appels FOR DELETE TO authenticated USING (public.can_delete());

CREATE POLICY "Admins delete contact documents"
  ON public.contact_documents FOR DELETE TO authenticated USING (public.can_delete());

CREATE POLICY "Editors update assigned reminders"
  ON public.relances FOR UPDATE TO authenticated
  USING (
    public.can_modify() AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_id AND (c.assigned_to = auth.uid() OR public.is_admin())
    )
  )
  WITH CHECK (
    public.can_modify() AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_id AND (c.assigned_to = auth.uid() OR public.is_admin())
    )
  );
CREATE POLICY "Admins delete reminders"
  ON public.relances FOR DELETE TO authenticated USING (public.can_delete());

CREATE POLICY "Editors update assigned enrollments"
  ON public.email_sequence_enrollments FOR UPDATE TO authenticated
  USING (
    public.can_modify() AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_id AND (c.assigned_to = auth.uid() OR public.is_admin())
    )
  )
  WITH CHECK (
    public.can_modify() AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_id AND (c.assigned_to = auth.uid() OR public.is_admin())
    )
  );
CREATE POLICY "Admins delete enrollments"
  ON public.email_sequence_enrollments FOR DELETE TO authenticated USING (public.can_delete());

CREATE POLICY "Admins delete enrichments"
  ON public.ai_enrichments FOR DELETE TO authenticated USING (public.can_delete());

-- Contenus partagés : tous les actifs peuvent ajouter, les éditeurs modifier,
-- et seuls les administrateurs supprimer.
CREATE POLICY "Active users add templates"
  ON public.templates FOR INSERT TO authenticated WITH CHECK (public.is_active_user());
CREATE POLICY "Editors update templates"
  ON public.templates FOR UPDATE TO authenticated
  USING (public.can_modify()) WITH CHECK (public.can_modify());
CREATE POLICY "Admins delete templates"
  ON public.templates FOR DELETE TO authenticated USING (public.can_delete());

CREATE POLICY "Active users add scripts"
  ON public.scripts_phoning FOR INSERT TO authenticated WITH CHECK (public.is_active_user());
CREATE POLICY "Editors update scripts"
  ON public.scripts_phoning FOR UPDATE TO authenticated
  USING (public.can_modify()) WITH CHECK (public.can_modify());
CREATE POLICY "Admins delete scripts"
  ON public.scripts_phoning FOR DELETE TO authenticated USING (public.can_delete());

CREATE POLICY "Active users add sequences"
  ON public.email_sequences FOR INSERT TO authenticated WITH CHECK (public.is_active_user());
CREATE POLICY "Editors update sequences"
  ON public.email_sequences FOR UPDATE TO authenticated
  USING (public.can_modify()) WITH CHECK (public.can_modify());
CREATE POLICY "Admins delete sequences"
  ON public.email_sequences FOR DELETE TO authenticated USING (public.can_delete());

CREATE POLICY "Editors update own settings"
  ON public.app_settings FOR UPDATE TO authenticated
  USING (public.can_modify() AND (user_id = auth.uid() OR public.is_admin()))
  WITH CHECK (public.can_modify() AND (user_id = auth.uid() OR public.is_admin()));
CREATE POLICY "Admins delete settings"
  ON public.app_settings FOR DELETE TO authenticated USING (public.can_delete());

-- Les fichiers sont lisibles/ajoutables selon le contact, mais supprimables
-- uniquement par un administrateur.
DO $$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd IN ('DELETE', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', policy_record.policyname);
  END LOOP;
END $$;

CREATE POLICY "Admins delete stored contact documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'contact-documents' AND public.can_delete());

