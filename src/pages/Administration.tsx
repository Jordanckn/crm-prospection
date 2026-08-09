import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BarChart2, CheckCircle2, Clock, Mail, Phone, Plus, Search,
  ShieldCheck, Target, UserCheck, UserCog, Users, KeyRound, Copy, Plug, History,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Contact, Profile, Tache } from '../types/database';

type Period = 'day' | 'week' | 'month';
type AdminTab = 'equipe' | 'affectations' | 'pilotage' | 'integrations';

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

export default function Administration() {
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
  const [newUser, setNewUser] = useState({ full_name: '', email: '', password: '', role: 'commercial' as Profile['role'] });
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
    const [profilesRes, contactsRes] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('contacts').select('*').order('nom'),
    ]);
    const team = profilesRes.data || [];
    setProfiles(team);
    setContacts(contactsRes.data || []);
    setSelectedUserId(current => current || team.find(p => p.role === 'commercial' && p.active)?.id || '');
    setLoading(false);
  }, []);

  useEffect(() => { loadBaseData(); }, [loadBaseData]);

  const loadStats = useCallback(async () => {
    if (!selectedUserId) return;
    const from = periodStart(period);
    const [contactRes, interactionRes, taskRes, sessionRes] = await Promise.all([
      supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('assigned_to', selectedUserId),
      supabase.from('interactions').select('type').eq('user_id', selectedUserId).gte('date_heure', from),
      supabase.from('taches').select('statut').eq('assigned_to', selectedUserId).gte('updated_at', from),
      supabase.from('sessions_travail').select('duree_minutes, debut, fin').eq('user_id', selectedUserId).gte('debut', from),
    ]);
    const interactions = interactionRes.data || [];
    const tasks = taskRes.data || [];
    const sessions = sessionRes.data || [];
    setStats({
      contacts: contactRes.count || 0,
      appels: interactions.filter(i => i.type === 'Appel').length,
      messages: interactions.filter(i => i.type !== 'Appel').length,
      taches: tasks.length,
      terminees: tasks.filter(t => t.statut === 'Terminé').length,
      minutes: sessions.reduce((sum, s) => {
        if (s.duree_minutes) return sum + s.duree_minutes;
        if (s.fin) return sum + Math.max(0, Math.round((new Date(s.fin).getTime() - new Date(s.debut).getTime()) / 60000));
        return sum;
      }, 0),
    });
  }, [period, selectedUserId]);

  useEffect(() => { loadStats(); }, [loadStats]);

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

  const commercialProfiles = profiles.filter(profile => profile.role === 'commercial');
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
    setSaving(true);
    setMessage('');
    const { error } = await supabase.functions.invoke('admin-users', { body: newUser });
    if (error) setMessage(`Erreur : ${error.message}`);
    else {
      setMessage('Utilisateur créé. Il peut maintenant se connecter au CRM.');
      setNewUser({ full_name: '', email: '', password: '', role: 'commercial' });
      await loadBaseData();
    }
    setSaving(false);
  };

  const updateProfile = async (profile: Profile, changes: Partial<Profile>) => {
    if (profile.id === (await supabase.auth.getUser()).data.user?.id && (changes.active === false || changes.role === 'commercial')) {
      setMessage("Vous ne pouvez pas désactiver votre propre compte administrateur.");
      return;
    }
    await supabase.from('profiles').update({ ...changes, updated_at: new Date().toISOString() }).eq('id', profile.id);
    await loadBaseData();
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
        <h1 className="text-2xl font-bold text-slate-900">Administration de l'équipe</h1>
        <p className="mt-1 text-sm text-slate-500">Créez les accès, distribuez les prospects et suivez l'activité individuelle.</p>
      </div>

      {message && <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{message}</div>}

      <div className="flex gap-2 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {([
          ['equipe', 'Utilisateurs', Users],
          ['affectations', 'Affectations', Target],
          ['pilotage', 'Rapports individuels', BarChart2],
          ['integrations', 'Intégrations & agents', Plug],
        ] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${tab === id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {tab === 'equipe' && (
        <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
          <form onSubmit={createUser} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-blue-50 p-2.5"><UserCog className="h-5 w-5 text-blue-600" /></div>
              <div><h2 className="font-bold text-slate-900">Nouvel utilisateur</h2><p className="text-xs text-slate-500">Le compte est actif immédiatement.</p></div>
            </div>
            <input required value={newUser.full_name} onChange={e => setNewUser({ ...newUser, full_name: e.target.value })} placeholder="Nom complet"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            <input required type="email" value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} placeholder="Email"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            <input required minLength={8} type="password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} placeholder="Mot de passe (8 caractères min.)"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value as Profile['role'] })}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm">
              <option value="commercial">Commercial</option><option value="admin">Administrateur</option>
            </select>
            <button disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              <Plus className="h-4 w-4" />Créer l'utilisateur
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
                  </div>
                  <select value={profile.role} onChange={e => updateProfile(profile, { role: e.target.value as Profile['role'] })}
                    className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs">
                    <option value="commercial">Commercial</option><option value="admin">Administrateur</option>
                  </select>
                  <button onClick={() => updateProfile(profile, { active: !profile.active })}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold ${profile.active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {profile.active ? 'Actif' : 'Désactivé'}
                  </button>
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

      {tab === 'pilotage' && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)} className="min-w-[240px] rounded-xl border border-slate-300 px-3 py-2.5 text-sm">
              {commercialProfiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
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
                La clé donne accès aux fonctions CRM, jamais à la clé maître Supabase. Toutes les actions seront journalisées.
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
    </div>
  );
}
