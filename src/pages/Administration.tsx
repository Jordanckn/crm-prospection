import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BarChart2, CheckCircle2, Clock, Mail, Phone, Plus, Search,
  ShieldCheck, Target, UserCheck, UserCog, Users, KeyRound, Copy, Plug, History,
  Pencil, Trash2, X, ScanSearch, RefreshCw, Eye,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Contact, Profile, Tache } from '../types/database';
import { roleLabel } from '../contexts/PermissionsContext';
import { useBrand } from '../contexts/BrandContext';

type Period = 'day' | 'week' | 'month';
type AdminTab = 'equipe' | 'affectations' | 'doublons' | 'pilotage' | 'integrations';
const multiUserEnabled = import.meta.env.VITE_MULTI_USER_ENABLED === 'true';

type ApiClient = {
  id: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  default_user_id: string | null;
  active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
};

type AgentAuditLog = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  result: { status?: number; success?: boolean };
  created_at: string;
};

type AdminTimeSession = {
  id: string;
  user_id: string;
  debut: string;
  fin: string | null;
  duree_minutes: number | null;
  type_session: 'travail' | 'prospection';
  notes: string;
};

type TeamUserKpi = {
  userId: string;
  contacts: number;
  appels: number;
  messages: number;
  taches: number;
  terminees: number;
  minutes: number;
  travailMinutes: number;
  prospectionMinutes: number;
  activeNow: boolean;
  lastStart: string | null;
};

type DuplicateMatch = {
  match_type: 'entreprise' | 'siren_siret' | 'telephone' | 'site_web' | 'email';
  match_value: string;
  contact_ids: string[];
  contact_count: number;
};

type DuplicateGroup = {
  key: string;
  criteria: Array<{ type: DuplicateMatch['match_type']; value: string }>;
  contacts: Contact[];
};

const minutesLabel = (minutes: number) => `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;

function periodStart(period: Period) {
  const date = new Date();
  if (period === 'day') date.setHours(0, 0, 0, 0);
  if (period === 'week') {
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    date.setHours(0, 0, 0, 0);
  }
  if (period === 'month') {
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
  }
  return date.toISOString();
}

export default function Administration({ onOpenContact }: { onOpenContact: (id: string) => void }) {
  const { brand } = useBrand();
  const [tab, setTab] = useState<AdminTab>('equipe');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [period, setPeriod] = useState<Period>('week');
  const [stats, setStats] = useState({ contacts: 0, appels: 0, messages: 0, taches: 0, terminees: 0, minutes: 0 });
  const [teamKpis, setTeamKpis] = useState<TeamUserKpi[]>([]);
  const [recentSessions, setRecentSessions] = useState<AdminTimeSession[]>([]);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [newUser, setNewUser] = useState({ full_name: '', email: '', password: '', role: 'contributor' as Profile['role'] });
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [editUserForm, setEditUserForm] = useState({ full_name: '', email: '', password: '', role: 'contributor' as Profile['role'], active: true });
  const [apiClients, setApiClients] = useState<ApiClient[]>([]);
  const [auditLogs, setAuditLogs] = useState<AgentAuditLog[]>([]);
  const [integrationName, setIntegrationName] = useState('OpenClaw CRM');
  const [integrationUserId, setIntegrationUserId] = useState('');
  const [generatedToken, setGeneratedToken] = useState('');
  const [integrationLoading, setIntegrationLoading] = useState(false);
  const [assignment, setAssignment] = useState({
    addToCallList: true,
    notes: '',
    taskTitle: '',
    taskDescription: '',
    dueDate: '',
  });

  const loadBaseData = useCallback(async () => {
    setLoading(true);
    if (!multiUserEnabled) {
      setProfiles([]);
      setContacts([]);
      setLoading(false);
      return;
    }
    const [profilesRes, contactsRes] = await Promise.all([
      supabase.from('profiles').select('*, profile_brands!inner(brand_id)').eq('profile_brands.brand_id', brand.id).order('full_name'),
      supabase.from('contacts').select('*').order('nom'),
    ]);
    const team = profilesRes.data || [];
    setProfiles(team);
    setContacts(contactsRes.data || []);
    setSelectedUserId(current => current || team.find(p => p.role !== 'admin' && p.active)?.id || '');
    setLoading(false);
  }, [brand.id]);

  useEffect(() => {
    setIntegrationName(`OpenClaw ${brand.name}`);
    setGeneratedToken('');
  }, [brand.name]);

  useEffect(() => { loadBaseData(); }, [loadBaseData]);

  const loadStats = useCallback(async () => {
    const from = periodStart(period);
    const [contactRes, interactionRes, taskRes, sessionRes] = await Promise.all([
      supabase.from('contacts').select('id, assigned_to'),
      supabase.from('interactions').select('user_id, type').gte('date_heure', from),
      supabase.from('taches').select('assigned_to, statut').gte('updated_at', from),
      supabase.from('sessions_travail').select('id, user_id, debut, fin, duree_minutes, type_session, notes').gte('debut', from).order('debut', { ascending: false }),
    ]);
    const contacts = contactRes.data || [];
    const interactions = interactionRes.data || [];
    const tasks = taskRes.data || [];
    const sessions = (sessionRes.data || []) as AdminTimeSession[];
    const sessionMinutes = (session: AdminTimeSession) => {
      if (session.duree_minutes !== null) return Math.max(0, session.duree_minutes);
      const end = session.fin ? new Date(session.fin).getTime() : Date.now();
      return Math.max(0, Math.round((end - new Date(session.debut).getTime()) / 60000));
    };
    const kpis = profiles.map(profile => {
      const userSessions = sessions.filter(session => session.user_id === profile.id);
      const userInteractions = interactions.filter(item => item.user_id === profile.id);
      const userTasks = tasks.filter(task => task.assigned_to === profile.id);
      return {
        userId: profile.id,
        contacts: contacts.filter(contact => contact.assigned_to === profile.id).length,
        appels: userInteractions.filter(item => item.type === 'Appel').length,
        messages: userInteractions.filter(item => item.type !== 'Appel').length,
        taches: userTasks.length,
        terminees: userTasks.filter(task => task.statut === 'Terminé').length,
        minutes: userSessions.reduce((sum, session) => sum + sessionMinutes(session), 0),
        travailMinutes: userSessions.filter(session => session.type_session !== 'prospection').reduce((sum, session) => sum + sessionMinutes(session), 0),
        prospectionMinutes: userSessions.filter(session => session.type_session === 'prospection').reduce((sum, session) => sum + sessionMinutes(session), 0),
        activeNow: userSessions.some(session => !session.fin),
        lastStart: userSessions[0]?.debut || null,
      };
    });
    setTeamKpis(kpis);
    setRecentSessions(sessions.slice(0, 100));
    const selected = kpis.find(kpi => kpi.userId === selectedUserId);
    setStats(selected || { contacts: 0, appels: 0, messages: 0, taches: 0, terminees: 0, minutes: 0 });
  }, [period, profiles, selectedUserId]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const teamTotals = useMemo(() => teamKpis.reduce((totals, user) => ({
    contacts: totals.contacts + user.contacts,
    interactions: totals.interactions + user.appels + user.messages,
    terminees: totals.terminees + user.terminees,
    minutes: totals.minutes + user.minutes,
    activeNow: totals.activeNow + (user.activeNow ? 1 : 0),
  }), { contacts: 0, interactions: 0, terminees: 0, minutes: 0, activeNow: 0 }), [teamKpis]);

  const crmApiRequest = useCallback(async (path: string, method = 'GET', body?: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Session administrateur expirée.');
    const baseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/functions/v1/crm-api/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: String(import.meta.env.VITE_SUPABASE_ANON_KEY || ''),
        'Content-Type': 'application/json',
        'X-Request-Id': crypto.randomUUID(),
      },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Erreur de communication avec l\'API CRM.');
    return payload.data;
  }, []);

  const loadIntegrations = useCallback(async () => {
    if (!multiUserEnabled) return;
    setIntegrationLoading(true);
    try {
      const [clients, logs] = await Promise.all([
        crmApiRequest('clients'),
        crmApiRequest('audit?limit=30'),
      ]);
      setApiClients(clients || []);
      setAuditLogs(logs || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Impossible de charger les intégrations.');
    } finally {
      setIntegrationLoading(false);
    }
  }, [crmApiRequest]);

  useEffect(() => {
    if (tab === 'integrations') void loadIntegrations();
  }, [tab, loadIntegrations]);

  const loadDuplicates = useCallback(async () => {
    setDuplicatesLoading(true);
    setMessage('');
    try {
      const { data: matches, error } = await supabase.rpc('admin_find_contact_duplicates');
      if (error) throw error;
      const rows = (matches || []) as DuplicateMatch[];
      const ids = [...new Set(rows.flatMap(row => row.contact_ids))];
      const { data: duplicateContacts, error: contactError } = ids.length
        ? await supabase.from('contacts').select('*').in('id', ids)
        : { data: [], error: null };
      if (contactError) throw contactError;
      const contactsById = new Map((duplicateContacts || []).map(contact => [contact.id, contact as Contact]));
      const grouped = new Map<string, DuplicateGroup>();
      for (const row of rows) {
        const sortedIds = [...row.contact_ids].sort();
        const key = sortedIds.join('|');
        const existing = grouped.get(key) || {
          key,
          criteria: [],
          contacts: sortedIds.map(id => contactsById.get(id)).filter(Boolean) as Contact[],
        };
        existing.criteria.push({ type: row.match_type, value: row.match_value });
        grouped.set(key, existing);
      }
      setDuplicateGroups([...grouped.values()].sort((a, b) => b.criteria.length - a.criteria.length || b.contacts.length - a.contacts.length));
    } catch (error) {
      setMessage(`Erreur : ${error instanceof Error ? error.message : 'Analyse des doublons impossible.'}`);
    } finally {
      setDuplicatesLoading(false);
    }
  }, [brand.id]);

  useEffect(() => {
    if (tab === 'doublons') void loadDuplicates();
  }, [tab, loadDuplicates]);

  const deleteDuplicateContact = async (contact: Contact) => {
    if (!confirm(`Supprimer définitivement ${contact.entreprise || `${contact.prenom} ${contact.nom}`} ?\n\nSes interactions, tâches et documents associés pourront également être supprimés. Vérifiez d'abord la fiche à conserver.`)) return;
    setSaving(true);
    setMessage('');
    const { error } = await supabase.from('contacts').delete().eq('id', contact.id);
    if (error) setMessage(`Erreur : ${error.message}`);
    else {
      setMessage('Contact supprimé. L’analyse des doublons a été actualisée.');
      await Promise.all([loadBaseData(), loadDuplicates()]);
    }
    setSaving(false);
  };

  const createIntegration = async () => {
    if (!integrationName.trim()) return;
    setSaving(true);
    setGeneratedToken('');
    setMessage('');
    try {
      const client = await crmApiRequest('clients', 'POST', {
        name: integrationName.trim(),
        default_user_id: integrationUserId || null,
        permissions: [
          'contacts:read', 'contacts:write', 'interactions:write', 'tasks:write',
          'assignments:write', 'work:read', 'reports:read', 'users:read', 'audit:read',
        ],
      });
      setGeneratedToken(client.token);
      setMessage('Clé OpenClaw créée. Copiez-la maintenant : elle ne sera plus affichée.');
      await loadIntegrations();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Création de la clé impossible.');
    } finally {
      setSaving(false);
    }
  };

  const revokeIntegration = async (client: ApiClient) => {
    if (!confirm(`Révoquer l'accès de ${client.name} ?`)) return;
    await crmApiRequest(`clients/${client.id}`, 'PATCH', { active: false });
    setGeneratedToken('');
    await loadIntegrations();
  };

  const commercialProfiles = profiles.filter(profile => profile.role !== 'admin');
  const selectedProfile = profiles.find(profile => profile.id === selectedUserId);
  const filteredContacts = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('fr');
    return contacts.filter(contact => {
      if (!needle) return true;
      return [contact.prenom, contact.nom, contact.entreprise, contact.email, contact.telephone]
        .join(' ').toLocaleLowerCase('fr').includes(needle);
    });
  }, [contacts, search]);

  const createUser = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!multiUserEnabled) {
      setMessage("Création indisponible : la migration multi-utilisateur et la fonction admin-users doivent d'abord être déployées sur Supabase.");
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      await adminUserRequest('POST', newUser);
      setMessage('Utilisateur créé. Il peut maintenant se connecter au CRM.');
      setNewUser({ full_name: '', email: '', password: '', role: 'contributor' });
      await loadBaseData();
    } catch (error) {
      setMessage(`Erreur : ${error instanceof Error ? error.message : 'Création impossible.'}`);
    }
    setSaving(false);
  };

  const adminUserRequest = async (method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Session administrateur expirée.');
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`, {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: String(import.meta.env.VITE_SUPABASE_ANON_KEY || ''),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Opération impossible.');
    return payload;
  };

  const openUserEditor = (profile: Profile) => {
    setEditingUser(profile);
    setEditUserForm({
      full_name: profile.full_name,
      email: profile.email,
      password: '',
      role: profile.role,
      active: profile.active,
    });
    setMessage('');
  };

  const saveEditedUser = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingUser) return;
    setSaving(true);
    setMessage('');
    try {
      await adminUserRequest('PATCH', {
        id: editingUser.id,
        full_name: editUserForm.full_name,
        email: editUserForm.email,
        role: editUserForm.role,
        active: editUserForm.active,
        ...(editUserForm.password ? { password: editUserForm.password } : {}),
      });
      setMessage(`Informations de ${editUserForm.full_name} mises à jour.`);
      setEditingUser(null);
      await loadBaseData();
    } catch (error) {
      setMessage(`Erreur : ${error instanceof Error ? error.message : 'Modification impossible.'}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async (profile: Profile) => {
    if (!confirm(`Supprimer ${profile.full_name || profile.email} de ${brand.name} ?\n\nSes prospects, interactions et tâches seront transférés à votre compte administrateur. Cette action ne peut pas être annulée.`)) return;
    setSaving(true);
    setMessage('');
    try {
      const result = await adminUserRequest('DELETE', { id: profile.id });
      setMessage(result.deleted
        ? `Le compte de ${profile.full_name || profile.email} a été supprimé et son activité vous a été transférée.`
        : `${profile.full_name || profile.email} a été retiré de ${brand.name}. Ses autres accès ont été conservés.`);
      if (selectedUserId === profile.id) setSelectedUserId('');
      setEditingUser(null);
      await loadBaseData();
    } catch (error) {
      setMessage(`Erreur : ${error instanceof Error ? error.message : 'Suppression impossible.'}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleContact = (id: string) => {
    setSelectedContactIds(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const assignActivity = async () => {
    if (!selectedUserId || selectedContactIds.size === 0) return;
    setSaving(true);
    setMessage('');
    const ids = [...selectedContactIds];
    const { error: contactError } = await supabase.from('contacts').update({ assigned_to: selectedUserId }).in('id', ids);
    if (contactError) {
      setMessage(`Erreur d'affectation : ${contactError.message}`);
      setSaving(false);
      return;
    }

    // Une réaffectation transfère aussi les actions encore ouvertes.
    await supabase.from('taches')
      .update({ assigned_to: selectedUserId })
      .in('contact_id', ids)
      .eq('statut', 'En attente');
    await supabase.from('liste_appels')
      .delete()
      .in('contact_id', ids)
      .neq('statut', 'traite');

    if (assignment.addToCallList) {
      const { data: currentRows } = await supabase
        .from('liste_appels').select('contact_id, ordre').eq('user_id', selectedUserId).neq('statut', 'traite');
      const existing = new Set((currentRows || []).map(row => row.contact_id));
      let nextOrder = Math.max(-1, ...(currentRows || []).map(row => row.ordre)) + 1;
      const rows = ids.filter(id => !existing.has(id)).map(id => ({
        user_id: selectedUserId,
        contact_id: id,
        ordre: nextOrder++,
        notes_prep: assignment.notes.trim(),
        statut: 'en_attente' as const,
      }));
      if (rows.length) await supabase.from('liste_appels').insert(rows);
    }

    if (assignment.taskTitle.trim()) {
      const tasks = ids.map(contactId => ({
        contact_id: contactId,
        titre: assignment.taskTitle.trim(),
        description: assignment.taskDescription.trim(),
        date_echeance: assignment.dueDate ? new Date(assignment.dueDate).toISOString() : null,
        statut: 'En attente' as Tache['statut'],
        assigned_to: selectedUserId,
      }));
      await supabase.from('taches').insert(tasks);
    }

    setMessage(`${ids.length} prospect(s) affecté(s) à ${selectedProfile?.full_name || 'cet utilisateur'}.`);
    setSelectedContactIds(new Set());
    setAssignment(previous => ({ ...previous, notes: '', taskTitle: '', taskDescription: '', dueDate: '' }));
    await loadBaseData();
    setSaving(false);
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><div className="h-9 w-9 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Administration · {brand.name}</h1>
        <p className="mt-1 text-sm text-slate-500">Créez les accès, distribuez les prospects et suivez uniquement l'activité de cet espace.</p>
      </div>

      {!multiUserEnabled && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Administration multi-utilisateur en attente de déploiement</p>
          <p className="mt-1">La connexion au CRM fonctionne, mais la création d'utilisateurs, les affectations, les rapports individuels et les intégrations restent désactivés jusqu'au déploiement Supabase.</p>
        </div>
      )}

      {message && <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{message}</div>}

      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {([
          ['equipe', 'Utilisateurs', Users],
          ['affectations', 'Affectations', Target],
          ['doublons', 'Doublons', ScanSearch],
          ['pilotage', 'Rapports individuels', BarChart2],
          ['integrations', 'Intégrations & agents', Plug],
        ] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)} disabled={!multiUserEnabled && id !== 'equipe'}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${tab === id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {tab === 'equipe' && (
        <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
          <form onSubmit={createUser} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-blue-50 p-2.5"><UserCog className="h-5 w-5 text-blue-600" /></div>
              <div><h2 className="font-bold text-slate-900">Nouvel utilisateur</h2><p className="text-xs text-slate-500">Accès immédiat à {brand.name}.</p></div>
            </div>
            <input required value={newUser.full_name} onChange={e => setNewUser({ ...newUser, full_name: e.target.value })} placeholder="Nom complet"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            <input required type="email" value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} placeholder="Email"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            <input required minLength={8} type="password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} placeholder="Mot de passe (8 caractères min.)"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">Niveau d'accès</label>
              <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value as Profile['role'] })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm">
                <option value="contributor">Lecture + ajout</option>
                <option value="editor">Lecture + ajout + modification</option>
                <option value="admin">Administrateur complet</option>
              </select>
              <p className="mt-1.5 text-xs text-slate-500">Les comptes non administrateurs ne peuvent jamais supprimer de données.</p>
            </div>
            <button disabled={saving || !multiUserEnabled} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              <Plus className="h-4 w-4" />{multiUserEnabled ? "Créer l'utilisateur" : 'Déploiement Supabase requis'}
            </button>
          </form>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-bold text-slate-900">Équipe ({profiles.length})</h2></div>
            <div className="divide-y divide-slate-100">
              {profiles.map(profile => (
                <div key={profile.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full ${profile.role === 'admin' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>
                    {profile.role === 'admin' ? <ShieldCheck className="h-5 w-5" /> : <UserCheck className="h-5 w-5" />}
                  </div>
                  <div className="min-w-[180px] flex-1">
                    <p className="font-semibold text-slate-900">{profile.full_name || 'Sans nom'}</p>
                    <p className="text-xs text-slate-500">{profile.email}</p>
                    <p className="mt-0.5 text-[11px] font-medium text-blue-600">{roleLabel(profile.role)}</p>
                  </div>
                  <span className={`rounded-lg px-3 py-2 text-xs font-semibold ${profile.active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {profile.active ? 'Actif' : 'Désactivé'}
                  </span>
                  <button onClick={() => openUserEditor(profile)} disabled={saving}
                    className="flex items-center gap-1.5 rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                    <Pencil className="h-3.5 w-3.5" />Modifier
                  </button>
                  {profile.email.toLowerCase() !== 'contact@webfityou.com' && (
                    <button onClick={() => deleteUser(profile)} disabled={saving}
                      className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                      <Trash2 className="h-3.5 w-3.5" />Supprimer
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'affectations' && (
        <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
              <div className="relative min-w-[240px] flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un prospect…" className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-sm" /></div>
              <span className="text-xs font-semibold text-blue-700">{selectedContactIds.size} sélectionné(s)</span>
            </div>
            <div className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto">
              {filteredContacts.map(contact => {
                const owner = profiles.find(p => p.id === contact.assigned_to);
                return (
                  <label key={contact.id} className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <input type="checkbox" checked={selectedContactIds.has(contact.id)} onChange={() => toggleContact(contact.id)} className="h-4 w-4 rounded" />
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-900">{contact.prenom} {contact.nom} · {contact.entreprise}</p>
                      <p className="truncate text-xs text-slate-500">{contact.telephone || contact.email || 'Aucune coordonnée'}</p></div>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{owner?.full_name || 'Non affecté'}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="h-fit space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-900">Distribuer l'activité</h2>
            <label className="block text-xs font-semibold text-slate-600">Utilisateur
              <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm">
                <option value="">Choisir…</option>{commercialProfiles.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">
              <input type="checkbox" checked={assignment.addToCallList} onChange={e => setAssignment({ ...assignment, addToCallList: e.target.checked })} />
              Ajouter à sa liste d'appels
            </label>
            <textarea value={assignment.notes} onChange={e => setAssignment({ ...assignment, notes: e.target.value })} placeholder="Consignes de préparation des appels" rows={2}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
            <div className="border-t border-slate-100 pt-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Tâche associée (facultatif)</p>
              <input value={assignment.taskTitle} onChange={e => setAssignment({ ...assignment, taskTitle: e.target.value })} placeholder="Ex. Appeler et qualifier"
                className="mb-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
              <textarea value={assignment.taskDescription} onChange={e => setAssignment({ ...assignment, taskDescription: e.target.value })} placeholder="Instructions" rows={2}
                className="mb-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
              <input type="datetime-local" value={assignment.dueDate} onChange={e => setAssignment({ ...assignment, dueDate: e.target.value })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
            </div>
            <button onClick={assignActivity} disabled={saving || !selectedUserId || selectedContactIds.size === 0}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white disabled:opacity-40">
              <Target className="h-4 w-4" />Affecter prospects et activité
            </button>
          </div>
        </div>
      )}

      {tab === 'doublons' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <div className="flex items-center gap-2"><ScanSearch className="h-5 w-5 text-violet-600" /><h2 className="font-bold text-slate-900">Détection des doublons · {brand.name}</h2></div>
              <p className="mt-1 text-sm text-slate-500">Comparaison par entreprise, SIREN/SIRET, téléphone, site internet et email.</p>
            </div>
            <button onClick={() => void loadDuplicates()} disabled={duplicatesLoading}
              className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${duplicatesLoading ? 'animate-spin' : ''}`} />Relancer l’analyse
            </button>
          </div>

          {!duplicatesLoading && !duplicateGroups.length && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
              <h3 className="mt-3 font-bold text-emerald-900">Aucun doublon détecté</h3>
              <p className="mt-1 text-sm text-emerald-700">Aucune valeur identique n’a été trouvée dans les critères analysés.</p>
            </div>
          )}

          {duplicatesLoading && <div className="flex h-48 items-center justify-center"><div className="h-9 w-9 animate-spin rounded-full border-4 border-violet-600 border-t-transparent" /></div>}

          {!duplicatesLoading && duplicateGroups.map((group, index) => (
            <div key={group.key} className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-100 bg-amber-50 px-5 py-4">
                <div>
                  <h3 className="font-bold text-amber-950">Groupe potentiel #{index + 1} · {group.contacts.length} contacts</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {group.criteria.map(criterion => (
                      <span key={`${criterion.type}-${criterion.value}`} className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-xs font-semibold text-amber-800">
                        {{ entreprise: 'Entreprise', siren_siret: 'SIREN/SIRET', telephone: 'Téléphone', site_web: 'Site web', email: 'Email' }[criterion.type]} : {criterion.value}
                      </span>
                    ))}
                  </div>
                </div>
                <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-bold text-amber-900">{group.criteria.length} critère(s) commun(s)</span>
              </div>
              <div className="divide-y divide-slate-100">
                {group.contacts.map(contact => (
                  <div key={contact.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 font-bold text-slate-600">{(contact.entreprise || contact.nom || '?').slice(0, 1).toUpperCase()}</div>
                    <div className="min-w-[220px] flex-1">
                      <p className="font-semibold text-slate-900">{contact.entreprise || `${contact.prenom} ${contact.nom}`}</p>
                      <p className="text-xs text-slate-500">{[contact.prenom, contact.nom].filter(Boolean).join(' ') || 'Aucun nom de personne'} · Créé le {new Date(contact.created_at).toLocaleDateString('fr-FR')}</p>
                    </div>
                    <div className="min-w-[260px] text-xs leading-5 text-slate-600">
                      <p><strong>Email :</strong> {contact.email || '—'}</p>
                      <p><strong>Téléphone :</strong> {contact.telephone || '—'}</p>
                      <p><strong>SIREN/SIRET :</strong> {contact.siren_siret || '—'}</p>
                      <p><strong>Site :</strong> {contact.site_web || '—'}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => onOpenContact(contact.id)} className="flex items-center gap-1.5 rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50">
                        <Eye className="h-3.5 w-3.5" />Examiner
                      </button>
                      <button onClick={() => deleteDuplicateContact(contact)} disabled={saving}
                        className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                        <Trash2 className="h-3.5 w-3.5" />Supprimer
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'pilotage' && (
        <div className="space-y-5">
          <div>
            <div className="mb-3 flex items-end justify-between">
              <div><h2 className="text-lg font-bold text-slate-900">Vue globale de l’équipe</h2><p className="text-xs text-slate-500">KPI cumulés sur la période sélectionnée</p></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {[
                [Clock, 'Temps total', minutesLabel(teamTotals.minutes), 'bg-blue-50 text-blue-600'],
                [Activity, 'En pointage', teamTotals.activeNow, 'bg-emerald-50 text-emerald-600'],
                [Users, 'Prospects', teamTotals.contacts, 'bg-violet-50 text-violet-600'],
                [Phone, 'Interactions', teamTotals.interactions, 'bg-amber-50 text-amber-600'],
                [CheckCircle2, 'Tâches terminées', teamTotals.terminees, 'bg-green-50 text-green-600'],
              ].map(([Icon, label, value, color]) => {
                const CardIcon = Icon as typeof Users;
                return <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className={`mb-3 inline-flex rounded-xl p-2 ${String(color)}`}><CardIcon className="h-4 w-4" /></div>
                  <p className="text-2xl font-bold text-slate-900">{String(value)}</p><p className="text-xs text-slate-500">{String(label)}</p>
                </div>;
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)} className="min-w-[240px] rounded-xl border border-slate-300 px-3 py-2.5 text-sm">
              {profiles.filter(profile => profile.active).map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
            </select>
            <div className="flex rounded-xl bg-slate-100 p-1">
              {([['day', "Aujourd'hui"], ['week', 'Semaine'], ['month', 'Mois']] as const).map(([id, label]) => (
                <button key={id} onClick={() => setPeriod(id)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${period === id ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>{label}</button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            {[
              [Users, 'Prospects confiés', stats.contacts, 'bg-blue-50 text-blue-600'],
              [Phone, 'Appels', stats.appels, 'bg-emerald-50 text-emerald-600'],
              [Mail, 'Messages', stats.messages, 'bg-violet-50 text-violet-600'],
              [Activity, 'Tâches créées', stats.taches, 'bg-amber-50 text-amber-600'],
              [CheckCircle2, 'Tâches terminées', stats.terminees, 'bg-green-50 text-green-600'],
              [Clock, 'Temps travaillé', `${Math.floor(stats.minutes / 60)}h${String(stats.minutes % 60).padStart(2, '0')}`, 'bg-slate-100 text-slate-600'],
            ].map(([Icon, label, value, color]) => {
              const CardIcon = Icon as typeof Users;
              return <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className={`mb-3 inline-flex rounded-xl p-2 ${String(color)}`}><CardIcon className="h-4 w-4" /></div>
                <p className="text-2xl font-bold text-slate-900">{String(value)}</p><p className="text-xs text-slate-500">{String(label)}</p>
              </div>;
            })}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="font-bold text-slate-900">Lecture rapide</h2>
            <p className="mt-2 text-sm text-slate-600">
              {selectedProfile?.full_name || 'Cet utilisateur'} a réalisé <strong>{stats.appels + stats.messages} interactions</strong> et terminé <strong>{stats.terminees} tâche(s)</strong> sur la période.
              Son portefeuille contient actuellement <strong>{stats.contacts} prospect(s)</strong>.
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="font-bold text-slate-900">KPI par utilisateur</h2>
              <p className="text-xs text-slate-500">Travail, prospection et activité commerciale sur la période</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="px-5 py-3">Utilisateur</th><th className="px-4 py-3">État</th><th className="px-4 py-3">Travail</th><th className="px-4 py-3">Prospection</th><th className="px-4 py-3">Interactions</th><th className="px-4 py-3">Tâches</th><th className="px-4 py-3">Dernier pointage</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {teamKpis.map(kpi => {
                    const profile = profiles.find(item => item.id === kpi.userId);
                    return <tr key={kpi.userId} className="hover:bg-slate-50">
                      <td className="px-5 py-3"><p className="font-semibold text-slate-900">{profile?.full_name || profile?.email}</p><p className="text-xs text-slate-400">{profile ? roleLabel(profile.role) : ''}</p></td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${kpi.activeNow ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{kpi.activeNow ? 'En cours' : 'Hors pointage'}</span></td>
                      <td className="px-4 py-3 font-semibold text-blue-700">{minutesLabel(kpi.travailMinutes)}</td>
                      <td className="px-4 py-3 font-semibold text-emerald-700">{minutesLabel(kpi.prospectionMinutes)}</td>
                      <td className="px-4 py-3 text-slate-700">{kpi.appels + kpi.messages}</td>
                      <td className="px-4 py-3 text-slate-700">{kpi.terminees}/{kpi.taches}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{kpi.lastStart ? new Date(kpi.lastStart).toLocaleString('fr-FR') : 'Aucun'}</td>
                    </tr>;
                  })}
                  {!teamKpis.length && <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-500">Aucune activité sur cette période.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="font-bold text-slate-900">Historique des pointages</h2>
              <p className="text-xs text-slate-500">Qui a pointé, à quelle heure et pendant combien de temps</p>
            </div>
            <div className="max-h-[430px] divide-y divide-slate-100 overflow-y-auto">
              {recentSessions.map(session => {
                const profile = profiles.find(item => item.id === session.user_id);
                const duration = session.duree_minutes ?? Math.max(0, Math.round(((session.fin ? new Date(session.fin).getTime() : Date.now()) - new Date(session.debut).getTime()) / 60000));
                return <div key={session.id} className="flex flex-wrap items-center gap-4 px-5 py-3 text-sm">
                  <div className={`h-2.5 w-2.5 rounded-full ${session.fin ? 'bg-slate-300' : 'animate-pulse bg-emerald-500'}`} />
                  <div className="min-w-[180px] flex-1"><p className="font-semibold text-slate-900">{profile?.full_name || profile?.email || 'Utilisateur supprimé'}</p><p className="text-xs text-slate-400">{session.notes || (session.type_session === 'prospection' ? 'Prospection' : 'Travail effectif')}</p></div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${session.type_session === 'prospection' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>{session.type_session === 'prospection' ? 'Prospection' : 'Travail'}</span>
                  <span className="min-w-[150px] text-xs text-slate-600">Début : {new Date(session.debut).toLocaleString('fr-FR')}</span>
                  <span className="min-w-[110px] text-xs text-slate-500">Fin : {session.fin ? new Date(session.fin).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'En cours'}</span>
                  <span className="min-w-[70px] text-right font-bold text-slate-800">{minutesLabel(duration)}</span>
                </div>;
              })}
              {!recentSessions.length && <p className="p-8 text-center text-sm text-slate-500">Aucun pointage sur cette période.</p>}
            </div>
          </div>
        </div>
      )}

      {tab === 'integrations' && (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[390px_1fr]">
            <div className="h-fit space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-violet-50 p-2.5"><KeyRound className="h-5 w-5 text-violet-600" /></div>
                <div>
                  <h2 className="font-bold text-slate-900">Nouvel accès agent</h2>
                  <p className="text-xs text-slate-500">Pour OpenClaw, Make ou une API externe.</p>
                </div>
              </div>
              <label className="block text-xs font-semibold text-slate-600">Nom de l'intégration
                <input value={integrationName} onChange={event => setIntegrationName(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
              </label>
              <label className="block text-xs font-semibold text-slate-600">Utilisateur par défaut
                <select value={integrationUserId} onChange={event => setIntegrationUserId(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm">
                  <option value="">L'agent devra le préciser</option>
                  {profiles.filter(profile => profile.active).map(profile => (
                    <option key={profile.id} value={profile.id}>{profile.full_name || profile.email}</option>
                  ))}
                </select>
              </label>
              <div className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                Cette clé est verrouillée sur <strong>{brand.name}</strong>. Elle ne peut ni lire ni écrire dans un autre espace, même si OpenClaw se trompe.
              </div>
              <button onClick={createIntegration} disabled={saving || !integrationName.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
                <KeyRound className="h-4 w-4" />Générer une clé sécurisée
              </button>

              {generatedToken && (
                <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3">
                  <p className="mb-2 text-xs font-bold text-emerald-800">Clé affichée une seule fois</p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-lg bg-white p-2 text-xs text-slate-800">{generatedToken}</code>
                    <button onClick={() => navigator.clipboard.writeText(generatedToken)} title="Copier"
                      className="rounded-lg bg-emerald-600 p-2 text-white"><Copy className="h-4 w-4" /></button>
                  </div>
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div><h2 className="font-bold text-slate-900">Accès techniques</h2><p className="text-xs text-slate-500">Clés actives et dernière utilisation</p></div>
                {integrationLoading && <div className="h-5 w-5 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />}
              </div>
              <div className="divide-y divide-slate-100">
                {!apiClients.length && !integrationLoading && <p className="p-6 text-center text-sm text-slate-500">Aucune intégration configurée.</p>}
                {apiClients.map(client => {
                  const defaultUser = profiles.find(profile => profile.id === client.default_user_id);
                  return (
                    <div key={client.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                      <div className={`rounded-xl p-2.5 ${client.active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}><Plug className="h-5 w-5" /></div>
                      <div className="min-w-[200px] flex-1">
                        <p className="font-semibold text-slate-900">{client.name}</p>
                        <p className="text-xs text-slate-500">{client.key_prefix}… · {defaultUser?.full_name || 'Sans utilisateur par défaut'}</p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          Dernière utilisation : {client.last_used_at ? new Date(client.last_used_at).toLocaleString('fr-FR') : 'Jamais'}
                          {client.expires_at ? ` · Expire le ${new Date(client.expires_at).toLocaleDateString('fr-FR')}` : ''}
                        </p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${client.active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{client.active ? 'Actif' : 'Révoqué'}</span>
                      {client.active && <button onClick={() => revokeIntegration(client)} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50">Révoquer</button>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
              <History className="h-5 w-5 text-slate-500" /><div><h2 className="font-bold text-slate-900">Journal des agents</h2><p className="text-xs text-slate-500">Les 30 dernières actions techniques</p></div>
            </div>
            <div className="divide-y divide-slate-100">
              {!auditLogs.length && <p className="p-6 text-center text-sm text-slate-500">Aucune action enregistrée.</p>}
              {auditLogs.map(log => (
                <div key={log.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                  <span className={`h-2.5 w-2.5 rounded-full ${log.result?.success ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  <code className="min-w-[180px] text-xs font-semibold text-slate-700">{log.action}</code>
                  <span className="flex-1 text-xs text-slate-500">{log.entity_type}{log.entity_id ? ` · ${log.entity_id}` : ''}</span>
                  <span className="text-xs text-slate-400">{new Date(log.created_at).toLocaleString('fr-FR')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <form onSubmit={saveEditedUser} className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="font-bold text-slate-900">Modifier l’utilisateur</h2>
                <p className="mt-0.5 text-xs text-slate-500">Les changements sont appliqués immédiatement.</p>
              </div>
              <button type="button" onClick={() => setEditingUser(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-6">
              <label className="block text-xs font-semibold text-slate-600">Nom complet
                <input required value={editUserForm.full_name} onChange={event => setEditUserForm({ ...editUserForm, full_name: event.target.value })}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
              </label>
              <label className="block text-xs font-semibold text-slate-600">Adresse email
                <input required type="email" value={editUserForm.email}
                  disabled={editingUser.email.toLowerCase() === 'contact@webfityou.com'}
                  onChange={event => setEditUserForm({ ...editUserForm, email: event.target.value })}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 disabled:bg-slate-100" />
              </label>
              <label className="block text-xs font-semibold text-slate-600">Nouveau mot de passe
                <input type="password" minLength={8} value={editUserForm.password}
                  onChange={event => setEditUserForm({ ...editUserForm, password: event.target.value })}
                  placeholder="Laisser vide pour ne pas le changer"
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-slate-600">Niveau d’accès
                  <select value={editUserForm.role}
                    disabled={editingUser.email.toLowerCase() === 'contact@webfityou.com'}
                    onChange={event => setEditUserForm({ ...editUserForm, role: event.target.value as Profile['role'] })}
                    className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm disabled:bg-slate-100">
                    <option value="contributor">Lecture + ajout</option>
                    <option value="editor">Lecture + ajout + modification</option>
                    <option value="admin">Administrateur complet</option>
                  </select>
                </label>
                <label className="flex items-center gap-3 self-end rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700">
                  <input type="checkbox" checked={editUserForm.active}
                    disabled={editingUser.email.toLowerCase() === 'contact@webfityou.com'}
                    onChange={event => setEditUserForm({ ...editUserForm, active: event.target.checked })}
                    className="h-4 w-4 rounded" />
                  Compte actif
                </label>
              </div>
              {editingUser.email.toLowerCase() === 'contact@webfityou.com' && (
                <p className="rounded-xl bg-violet-50 p-3 text-xs text-violet-800">Le compte administrateur principal peut modifier son nom et son mot de passe, mais son email, son rôle et son statut sont protégés.</p>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
              {editingUser.email.toLowerCase() !== 'contact@webfityou.com' ? (
                <button type="button" onClick={() => deleteUser(editingUser)} disabled={saving}
                  className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                  <Trash2 className="h-4 w-4" />Supprimer l’utilisateur
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditingUser(null)} disabled={saving}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-white disabled:opacity-50">Annuler</button>
                <button type="submit" disabled={saving}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
