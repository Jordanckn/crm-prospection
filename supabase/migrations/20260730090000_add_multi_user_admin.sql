/*
  # CRM multi-utilisateur et administration

  - Profils et rôles (admin / commercial)
  - Affectation des contacts, tâches, interactions et objectifs
  - Isolation stricte des données par commercial
  - Visibilité globale pour les administrateurs

  Le compte contact@webfityou.com devient administrateur. Les autres comptes
  restent commerciaux.
*/

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL DEFAULT '',
  full_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'commercial' CHECK (role IN ('admin', 'commercial')),
  active boolean NOT NULL DEFAULT true,
  manager_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.profiles (id, email, full_name, role)
SELECT
  u.id,
  COALESCE(u.email, ''),
  COALESCE(u.raw_user_meta_data->>'full_name', ''),
  CASE WHEN lower(COALESCE(u.email, '')) = 'contact@webfityou.com' THEN 'admin' ELSE 'commercial' END
FROM auth.users u
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  role = CASE
    WHEN lower(EXCLUDED.email) = 'contact@webfityou.com' THEN 'admin'
    ELSE profiles.role
  END;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    CASE WHEN lower(COALESCE(NEW.email, '')) = 'contact@webfityou.com' THEN 'admin' ELSE 'commercial' END
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), profiles.full_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE OF email, raw_user_meta_data ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Profiles are visible to owner and admins" ON public.profiles;
CREATE POLICY "Profiles are visible to owner and admins"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "Admins can update profiles" ON public.profiles;
CREATE POLICY "Admins can update profiles"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Propriété des données principales.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.taches
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.objectifs
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.contacts ALTER COLUMN assigned_to SET DEFAULT auth.uid();
ALTER TABLE public.contacts ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.interactions ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.taches ALTER COLUMN assigned_to SET DEFAULT auth.uid();
ALTER TABLE public.taches ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.objectifs ALTER COLUMN user_id SET DEFAULT auth.uid();

DO $$
DECLARE
  bootstrap_owner uuid;
BEGIN
  SELECT id INTO bootstrap_owner
  FROM public.profiles
  ORDER BY (lower(email) = 'contact@webfityou.com') DESC, created_at ASC
  LIMIT 1;
  UPDATE public.contacts SET assigned_to = bootstrap_owner WHERE assigned_to IS NULL;
  UPDATE public.contacts SET created_by = COALESCE(assigned_to, bootstrap_owner) WHERE created_by IS NULL;
  UPDATE public.interactions i
    SET user_id = COALESCE(c.assigned_to, bootstrap_owner)
    FROM public.contacts c
    WHERE i.contact_id = c.id AND i.user_id IS NULL;
  UPDATE public.taches t
    SET assigned_to = COALESCE(c.assigned_to, bootstrap_owner)
    FROM public.contacts c
    WHERE t.contact_id = c.id AND t.assigned_to IS NULL;
  UPDATE public.taches SET assigned_to = bootstrap_owner WHERE assigned_to IS NULL;
  UPDATE public.taches SET created_by = COALESCE(assigned_to, bootstrap_owner) WHERE created_by IS NULL;
  UPDATE public.objectifs SET user_id = bootstrap_owner WHERE user_id IS NULL;
END $$;

ALTER TABLE public.contacts ALTER COLUMN assigned_to SET NOT NULL;
ALTER TABLE public.interactions ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.taches ALTER COLUMN assigned_to SET NOT NULL;
ALTER TABLE public.objectifs ALTER COLUMN user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_assigned_to ON public.contacts(assigned_to);
CREATE INDEX IF NOT EXISTS idx_interactions_user_id ON public.interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_taches_assigned_to_echeance ON public.taches(assigned_to, date_echeance);
CREATE INDEX IF NOT EXISTS idx_objectifs_user_date ON public.objectifs(user_id, date);

ALTER TABLE public.objectifs DROP CONSTRAINT IF EXISTS objectifs_date_key;
ALTER TABLE public.objectifs DROP CONSTRAINT IF EXISTS objectifs_user_date_key;
ALTER TABLE public.objectifs ADD CONSTRAINT objectifs_user_date_key UNIQUE (user_id, date);

-- Remplacement des anciennes politiques permissives.
DROP POLICY IF EXISTS "Accès public aux contacts" ON public.contacts;
DROP POLICY IF EXISTS "Accès public aux interactions" ON public.interactions;
DROP POLICY IF EXISTS "Accès public aux tâches" ON public.taches;
DROP POLICY IF EXISTS "Accès public aux objectifs" ON public.objectifs;

CREATE POLICY "Users see assigned contacts"
  ON public.contacts FOR SELECT TO authenticated
  USING (public.is_active_user() AND (assigned_to = auth.uid() OR public.is_admin()));
CREATE POLICY "Users create assigned contacts"
  ON public.contacts FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_user()
    AND (assigned_to = auth.uid() OR public.is_admin())
    AND (created_by = auth.uid() OR public.is_admin())
  );
CREATE POLICY "Users update assigned contacts"
  ON public.contacts FOR UPDATE TO authenticated
  USING (public.is_active_user() AND (assigned_to = auth.uid() OR public.is_admin()))
  WITH CHECK (public.is_active_user() AND (assigned_to = auth.uid() OR public.is_admin()));
CREATE POLICY "Users delete assigned contacts"
  ON public.contacts FOR DELETE TO authenticated
  USING (public.is_active_user() AND (assigned_to = auth.uid() OR public.is_admin()));

CREATE POLICY "Users see own interactions"
  ON public.interactions FOR SELECT TO authenticated
  USING (
    public.is_active_user()
    AND (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.contacts c
        WHERE c.id = contact_id AND c.assigned_to = auth.uid()
      )
    )
  );
CREATE POLICY "Users create own interactions"
  ON public.interactions FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_user()
    AND (user_id = auth.uid() OR public.is_admin())
    AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_id AND (c.assigned_to = auth.uid() OR public.is_admin())
    )
  );
CREATE POLICY "Users update own interactions"
  ON public.interactions FOR UPDATE TO authenticated
  USING (
    public.is_active_user()
    AND (
      public.is_admin()
      OR (
        user_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM public.contacts c
          WHERE c.id = contact_id AND c.assigned_to = auth.uid()
        )
      )
    )
  )
  WITH CHECK (
    public.is_active_user()
    AND (
      public.is_admin()
      OR (
        user_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM public.contacts c
          WHERE c.id = contact_id AND c.assigned_to = auth.uid()
        )
      )
    )
  );
CREATE POLICY "Users delete own interactions"
  ON public.interactions FOR DELETE TO authenticated
  USING (
    public.is_active_user()
    AND (
      public.is_admin()
      OR (
        user_id = auth.uid()
        AND EXISTS (
          SELECT 1 FROM public.contacts c
          WHERE c.id = contact_id AND c.assigned_to = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Users see assigned tasks"
  ON public.taches FOR SELECT TO authenticated
  USING (public.is_active_user() AND (assigned_to = auth.uid() OR public.is_admin()));
CREATE POLICY "Users create assigned tasks"
  ON public.taches FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_user()
    AND (assigned_to = auth.uid() OR public.is_admin())
    AND (
      contact_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.contacts c
        WHERE c.id = contact_id AND (c.assigned_to = public.taches.assigned_to OR public.is_admin())
      )
    )
  );
CREATE POLICY "Users update assigned tasks"
  ON public.taches FOR UPDATE TO authenticated
  USING (public.is_active_user() AND (assigned_to = auth.uid() OR public.is_admin()))
  WITH CHECK (public.is_active_user() AND (assigned_to = auth.uid() OR public.is_admin()));
CREATE POLICY "Users delete assigned tasks"
  ON public.taches FOR DELETE TO authenticated
  USING (public.is_active_user() AND (assigned_to = auth.uid() OR public.is_admin()));

CREATE POLICY "Users see own goals"
  ON public.objectifs FOR SELECT TO authenticated
  USING (public.is_active_user() AND (user_id = auth.uid() OR public.is_admin()));
CREATE POLICY "Users create own goals"
  ON public.objectifs FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user() AND (user_id = auth.uid() OR public.is_admin()));
CREATE POLICY "Users update own goals"
  ON public.objectifs FOR UPDATE TO authenticated
  USING (public.is_active_user() AND (user_id = auth.uid() OR public.is_admin()))
  WITH CHECK (public.is_active_user() AND (user_id = auth.uid() OR public.is_admin()));
CREATE POLICY "Users delete own goals"
  ON public.objectifs FOR DELETE TO authenticated
  USING (public.is_active_user() AND (user_id = auth.uid() OR public.is_admin()));

-- Tables déjà isolées : l'admin peut maintenant les superviser.
DROP POLICY IF EXISTS "Users can select own sessions" ON public.sessions_travail;
CREATE POLICY "Users and admins select sessions"
  ON public.sessions_travail FOR SELECT TO authenticated
  USING (public.is_active_user() AND (user_id = auth.uid() OR public.is_admin()));
DROP POLICY IF EXISTS "Users can select own recaps" ON public.recaps_journaliers;
CREATE POLICY "Users and admins select recaps"
  ON public.recaps_journaliers FOR SELECT TO authenticated
  USING (public.is_active_user() AND (user_id = auth.uid() OR public.is_admin()));
DROP POLICY IF EXISTS "Users can select own liste_appels" ON public.liste_appels;
CREATE POLICY "Users and admins select call lists"
  ON public.liste_appels FOR SELECT TO authenticated
  USING (public.is_active_user() AND (user_id = auth.uid() OR public.is_admin()));
DROP POLICY IF EXISTS "Users can insert own liste_appels" ON public.liste_appels;
CREATE POLICY "Users and admins insert call lists"
  ON public.liste_appels FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_user()
    AND (user_id = auth.uid() OR public.is_admin())
    AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_id
        AND (c.assigned_to = public.liste_appels.user_id OR public.is_admin())
    )
  );
DROP POLICY IF EXISTS "Users can update own liste_appels" ON public.liste_appels;
CREATE POLICY "Users and admins update call lists"
  ON public.liste_appels FOR UPDATE TO authenticated
  USING (public.is_active_user() AND (user_id = auth.uid() OR public.is_admin()))
  WITH CHECK (
    public.is_active_user()
    AND (user_id = auth.uid() OR public.is_admin())
    AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_id
        AND (c.assigned_to = public.liste_appels.user_id OR public.is_admin())
    )
  );
DROP POLICY IF EXISTS "Users can delete own liste_appels" ON public.liste_appels;
CREATE POLICY "Users and admins delete call lists"
  ON public.liste_appels FOR DELETE TO authenticated
  USING (public.is_active_user() AND (user_id = auth.uid() OR public.is_admin()));

-- Les tables liées à un contact suivent son affectation.
DROP POLICY IF EXISTS "Authenticated users can read documents" ON public.contact_documents;
DROP POLICY IF EXISTS "Authenticated users can insert documents" ON public.contact_documents;
DROP POLICY IF EXISTS "Authenticated users can delete documents" ON public.contact_documents;
CREATE POLICY "Users read documents for assigned contacts"
  ON public.contact_documents FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND (c.assigned_to = auth.uid() OR public.is_admin())
  ));
CREATE POLICY "Users insert documents for assigned contacts"
  ON public.contact_documents FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND (c.assigned_to = auth.uid() OR public.is_admin())
  ));
CREATE POLICY "Users delete documents for assigned contacts"
  ON public.contact_documents FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND (c.assigned_to = auth.uid() OR public.is_admin())
  ));

DROP POLICY IF EXISTS "Users can select relances via contacts" ON public.relances;
DROP POLICY IF EXISTS "Users can insert relances" ON public.relances;
DROP POLICY IF EXISTS "Users can update relances" ON public.relances;
DROP POLICY IF EXISTS "Users can delete relances" ON public.relances;
CREATE POLICY "Users select relances for assigned contacts"
  ON public.relances FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND (c.assigned_to = auth.uid() OR public.is_admin())
  ));
CREATE POLICY "Users insert relances for assigned contacts"
  ON public.relances FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND (c.assigned_to = auth.uid() OR public.is_admin())
  ));
CREATE POLICY "Users update relances for assigned contacts"
  ON public.relances FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND (c.assigned_to = auth.uid() OR public.is_admin())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND (c.assigned_to = auth.uid() OR public.is_admin())
  ));
CREATE POLICY "Users delete relances for assigned contacts"
  ON public.relances FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND (c.assigned_to = auth.uid() OR public.is_admin())
  ));

DROP POLICY IF EXISTS "Authenticated users can view enrollments" ON public.email_sequence_enrollments;
DROP POLICY IF EXISTS "Authenticated users can insert enrollments" ON public.email_sequence_enrollments;
DROP POLICY IF EXISTS "Authenticated users can update enrollments" ON public.email_sequence_enrollments;
DROP POLICY IF EXISTS "Authenticated users can delete enrollments" ON public.email_sequence_enrollments;
CREATE POLICY "Users view enrollments for assigned contacts"
  ON public.email_sequence_enrollments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND (c.assigned_to = auth.uid() OR public.is_admin())
  ));
CREATE POLICY "Users insert enrollments for assigned contacts"
  ON public.email_sequence_enrollments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND (c.assigned_to = auth.uid() OR public.is_admin())
  ));
CREATE POLICY "Users update enrollments for assigned contacts"
  ON public.email_sequence_enrollments FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND (c.assigned_to = auth.uid() OR public.is_admin())
  ));
CREATE POLICY "Users delete enrollments for assigned contacts"
  ON public.email_sequence_enrollments FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND (c.assigned_to = auth.uid() OR public.is_admin())
  ));

DROP POLICY IF EXISTS "Authenticated users can read ai enrichments" ON public.ai_enrichments;
DROP POLICY IF EXISTS "Authenticated users can insert ai enrichments" ON public.ai_enrichments;
DROP POLICY IF EXISTS "Authenticated users can delete ai enrichments" ON public.ai_enrichments;
CREATE POLICY "Users read enrichments for assigned contacts"
  ON public.ai_enrichments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND (c.assigned_to = auth.uid() OR public.is_admin())
  ));
CREATE POLICY "Users insert enrichments for assigned contacts"
  ON public.ai_enrichments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND (c.assigned_to = auth.uid() OR public.is_admin())
  ));
CREATE POLICY "Users delete enrichments for assigned contacts"
  ON public.ai_enrichments FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND (c.assigned_to = auth.uid() OR public.is_admin())
  ));

-- Le chemin de stockage commence par l'identifiant du contact.
DROP POLICY IF EXISTS "Authenticated can upload contact docs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can read contact docs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can delete contact docs" ON storage.objects;
CREATE POLICY "Users upload documents for assigned contacts"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'contact-documents'
    AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id::text = (storage.foldername(name))[1]
        AND (c.assigned_to = auth.uid() OR public.is_admin())
    )
  );
CREATE POLICY "Users read stored documents for assigned contacts"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'contact-documents'
    AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id::text = (storage.foldername(name))[1]
        AND (c.assigned_to = auth.uid() OR public.is_admin())
    )
  );
CREATE POLICY "Users delete stored documents for assigned contacts"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'contact-documents'
    AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id::text = (storage.foldername(name))[1]
        AND (c.assigned_to = auth.uid() OR public.is_admin())
    )
  );

-- Modèles et scripts : lecture pour l'équipe, écriture réservée aux admins.
DROP POLICY IF EXISTS "Accès public aux templates" ON public.templates;
DROP POLICY IF EXISTS "Accès public aux scripts" ON public.scripts_phoning;
CREATE POLICY "Authenticated users read templates"
  ON public.templates FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY "Admins manage templates"
  ON public.templates FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Authenticated users read scripts"
  ON public.scripts_phoning FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY "Admins manage scripts"
  ON public.scripts_phoning FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Séquences globales pilotées par l'administrateur.
DROP POLICY IF EXISTS "Authenticated users can view sequences" ON public.email_sequences;
DROP POLICY IF EXISTS "Authenticated users can insert sequences" ON public.email_sequences;
DROP POLICY IF EXISTS "Authenticated users can update sequences" ON public.email_sequences;
DROP POLICY IF EXISTS "Authenticated users can delete sequences" ON public.email_sequences;
CREATE POLICY "Authenticated users read sequences"
  ON public.email_sequences FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY "Admins manage sequences"
  ON public.email_sequences FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Le déclencheur garantit que l'auteur d'une interaction est toujours le compte connecté.
CREATE OR REPLACE FUNCTION public.set_activity_ownership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'interactions' AND auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    NEW.user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_interaction_ownership ON public.interactions;
CREATE TRIGGER set_interaction_ownership
  BEFORE INSERT ON public.interactions
  FOR EACH ROW EXECUTE FUNCTION public.set_activity_ownership();
