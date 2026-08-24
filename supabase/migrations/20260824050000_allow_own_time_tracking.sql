/* Tous les utilisateurs actifs peuvent gerer leur propre pointage. */

DROP POLICY IF EXISTS "Editors update own sessions" ON public.sessions_travail;
DROP POLICY IF EXISTS "Users update own sessions" ON public.sessions_travail;
CREATE POLICY "Active users update own sessions"
  ON public.sessions_travail FOR UPDATE TO authenticated
  USING (public.is_active_user() AND (user_id = auth.uid() OR public.is_admin()))
  WITH CHECK (public.is_active_user() AND (user_id = auth.uid() OR public.is_admin()));

DROP POLICY IF EXISTS "Editors update own recaps" ON public.recaps_journaliers;
DROP POLICY IF EXISTS "Users update own recaps" ON public.recaps_journaliers;
CREATE POLICY "Active users update own recaps"
  ON public.recaps_journaliers FOR UPDATE TO authenticated
  USING (public.is_active_user() AND (user_id = auth.uid() OR public.is_admin()))
  WITH CHECK (public.is_active_user() AND (user_id = auth.uid() OR public.is_admin()));

-- Les politiques INSERT historiques sont recreees explicitement pour inclure
-- le statut actif, l'isolation de marque restant imposee par la policy restrictive.
DROP POLICY IF EXISTS "Users can insert own sessions" ON public.sessions_travail;
CREATE POLICY "Active users insert own sessions"
  ON public.sessions_travail FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user() AND user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own recaps" ON public.recaps_journaliers;
CREATE POLICY "Active users insert own recaps"
  ON public.recaps_journaliers FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user() AND user_id = auth.uid());
