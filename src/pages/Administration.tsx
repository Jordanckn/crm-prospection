import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BarChart2, CheckCircle2, Clock, Mail, Phone, Plus, Search,
  ShieldCheck, Target, UserCheck, UserCog, Users, KeyRound, Copy, Plug, History,
  Pencil, Trash2, X, ScanSearch, RefreshCw, Eye, GitMerge,
  Info, Check, Radio, AlertCircle, CalendarDays, Play,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Contact, Profile, Tache } from '../types/database';
import { roleLabel } from '../contexts/PermissionsContext';
import { useBrand } from '../contexts/BrandContext';
import { DEFAULT_TIMEZONE, TIMEZONE_OPTIONS, formatInTimezone, zonedDateTimeInputToIso } from '../lib/timezone';

type Period = 'day' | 'week' | 'month';
type AdminTab = 'equipe' | 'affectations' | 'doublons' | 'pilotage' | 'sequences' | 'integrations';
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
  request_id: string;
  client_id: string | null;
  admin_user_id?: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  payload: Record<string, unknown>;
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

type SequenceRun = {
  id: string;
  source: 'cron' | 'manual';
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  finished_at: string | null;
  processed_count: number;
  success_count: number;
  error_count: number;
  error: string | null;
};

type SequenceDefinition = {
  id: string;
  titre: string;
  actif: boolean;
  etapes: Array<{ delay_days: number; template_id: string; subject?: string }>;
};

type SequenceEnrollmentMonitor = {
  id: string;
  sequence_id: string;
  etape_courante: number;
  statut: 'active' | 'completed' | 'cancelled';
  execution_status: 'pending' | 'processing' | 'sent' | 'error' | 'completed' | 'cancelled';
  prochaine_execution: string | null;
  derniere_execution: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  sent_count: number;
  error_count: number;
  contacts?: { id: string; prenom: string; nom: string; entreprise: string; email: string } | null;
  email_sequences?: { id: string; titre: string; etapes: Array<{ delay_days: number }> } | null;
};

type SequenceAttempt = {
  id: string;
  contact_id: string;
  step_index: number;
  status: 'processing' | 'sent' | 'error';
  provider: string | null;
  provider_message_id: string | null;
  recipient_email: string | null;
  sender_code: string | null;
  from_email: string | null;
  subject: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  contacts?: { id: string; entreprise: string; prenom: string; nom: string } | null;
  email_sequences?: { id: string; titre: string } | null;
};

const SEQUENCE_STATUS: Record<SequenceEnrollmentMonitor['execution_status'], { label: string; classes: string }> = {
  pending: { label: 'En attente', classes: 'bg-amber-50 text-amber-700' },
  processing: { label: 'En cours', classes: 'bg-blue-50 text-blue-700' },
  sent: { label: 'Envoyé', classes: 'bg-emerald-50 text-emerald-700' },
  error: { label: 'Erreur', classes: 'bg-red-50 text-red-700' },
  completed: { label: 'Terminé', classes: 'bg-violet-50 text-violet-700' },
  cancelled: { label: 'Annulé', classes: 'bg-slate-100 text-slate-500' },
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

const AGENT_ACTION_LABELS: Record<string, string> = {
  'contacts.create': 'Prospect créé',
  'contacts.update': 'Prospect modifié',
  'interactions.create': 'Interaction ajoutée',
  'followups.record': 'Suivi commercial enregistré',
  'tasks.create': 'Tâche créée',
  'tasks.complete': 'Tâche terminée',
  'assignments.create': 'Prospects affectés',
  'clients.create': 'Accès agent créé',
  'clients.update': 'Accès agent modifié',
};

const agentActionLabel = (action: string) => AGENT_ACTION_LABELS[action]
  || action.replace(/^(post|patch|get)\./, '').replace(/\./g, ' · ');

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
  const [newUser, setNewUser] = useState({ full_name: '', email: '', password: '', role: 'contributor' as Profile['role'], timezone: DEFAULT_TIMEZONE });
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [editUserForm, setEditUserForm] = useState({ full_name: '', email: '', password: '', role: 'contributor' as Profile['role'], active: true, timezone: DEFAULT_TIMEZONE });
  const [apiClients, setApiClients] = useState<ApiClient[]>([]);
  const [auditLogs, setAuditLogs] = useState<AgentAuditLog[]>([]);
  const [auditPeriod, setAuditPeriod] = useState<Period>('day');
  const [auditClientId, setAuditClientId] = useState('');
  const [auditLastRefresh, setAuditLastRefresh] = useState<Date | null>(null);
  const [integrationName, setIntegrationName] = useState('OpenClaw CRM');
  const [integrationUserId, setIntegrationUserId] = useState('');
  const [generatedToken, setGeneratedToken] = useState('');
  const [integrationGuideCopied, setIntegrationGuideCopied] = useState(false);
  const [integrationLoading, setIntegrationLoading] = useState(false);
  const [sequenceRuns, setSequenceRuns] = useState<SequenceRun[]>([]);
  const [sequenceDefinitions, setSequenceDefinitions] = useState<SequenceDefinition[]>([]);
  const [sequenceEnrollments, setSequenceEnrollments] = useState<SequenceEnrollmentMonitor[]>([]);
  const [sequenceLoading, setSequenceLoading] = useState(false);
  const [sequenceActionId, setSequenceActionId] = useState('');
  const [sequenceAttempts, setSequenceAttempts] = useState<SequenceAttempt[]>([]);
  const [sequenceStatusFilter, setSequenceStatusFilter] = useState('');
  const [sequenceSearch, setSequenceSearch] = useState('');
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
    setIntegrationUserId(current => team.some(profile => profile.id === current && profile.active)
      ? current
      : team.find(profile => profile.role === 'admin' && profile.active)?.id || team.find(profile => profile.active)?.id || '');
    setLoading(false);
  }, [brand.id]);

  useEffect(() => {
    setIntegrationName(`OpenClaw ${brand.name}`);
    setIntegrationUserId('');
    setGeneratedToken('');
    setIntegrationGuideCopied(false);
  }, [brand.name]);

  useEffect(() => { loadBaseData(); }, [loadBaseData]);

  const loadSequenceMonitoring = useCallback(async (silent = false) => {
    if (!multiUserEnabled) return;
    if (!silent) setSequenceLoading(true);
    const [runsRes, definitionsRes, enrollmentsRes, attemptsRes] = await Promise.all([
      supabase.from('email_sequence_runs').select('*').or(`brand_id.eq.${brand.id},brand_id.is.null`).order('started_at', { ascending: false }).limit(50),
      supabase.from('email_sequences').select('id, titre, actif, etapes').order('created_at', { ascending: false }),
      supabase.from('email_sequence_enrollments')
        .select('id, sequence_id, etape_courante, statut, execution_status, prochaine_execution, derniere_execution, last_attempt_at, last_error, sent_count, error_count, contacts(id, prenom, nom, entreprise, email), email_sequences(id, titre, etapes)')
        .order('updated_at', { ascending: false }).limit(250),
      supabase.from('email_sequence_attempts')
        .select('id, contact_id, step_index, status, provider, provider_message_id, recipient_email, sender_code, from_email, subject, error, started_at, finished_at, contacts(id, entreprise, prenom, nom), email_sequences(id, titre)')
        .order('started_at', { ascending: false }).limit(500),
    ]);
    if (runsRes.error || definitionsRes.error || enrollmentsRes.error || attemptsRes.error) {
      setMessage(runsRes.error?.message || definitionsRes.error?.message || enrollmentsRes.error?.message || attemptsRes.error?.message || 'Suivi des séquences indisponible.');
    } else {
      setSequenceRuns((runsRes.data || []) as SequenceRun[]);
      setSequenceDefinitions((definitionsRes.data || []) as SequenceDefinition[]);
      setSequenceEnrollments((enrollmentsRes.data || []) as unknown as SequenceEnrollmentMonitor[]);
      setSequenceAttempts((attemptsRes.data || []) as unknown as SequenceAttempt[]);
    }
    if (!silent) setSequenceLoading(false);
  }, [brand.id]);

  useEffect(() => {
    if (tab !== 'sequences') return;
    void loadSequenceMonitoring();
    const timer = window.setInterval(() => void loadSequenceMonitoring(true), 15000);
    return () => window.clearInterval(timer);
  }, [tab, loadSequenceMonitoring]);

  const runSequenceNow = async (sequenceId: string) => {
    if (!window.confirm('Envoyer maintenant la prochaine étape d’un prospect actif de cette séquence ?')) return;
    setSequenceActionId(sequenceId);
    setMessage('');
    const { data, error } = await supabase.functions.invoke('process-sequences', {
      body: { source: 'manual', sequence_id: sequenceId, force: true },
    });
    setMessage(error ? `Erreur : ${error.message}` : data?.message || 'Moteur exécuté.');
    setSequenceActionId('');
    await loadSequenceMonitoring(true);
  };

  const retrySequenceEnrollment = async (enrollmentId: string) => {
    setSequenceActionId(enrollmentId);
    setMessage('');
    const { data, error } = await supabase.functions.invoke('process-sequences', {
      body: { source: 'manual', enrollment_id: enrollmentId, force: true },
    });
    setMessage(error ? `Erreur : ${error.message}` : data?.message || 'Nouvelle tentative terminée.');
    setSequenceActionId('');
    await loadSequenceMonitoring(true);
  };

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

  const loadIntegrations = useCallback(async (silent = false) => {
    if (!multiUserEnabled) return;
    if (!silent) setIntegrationLoading(true);
    try {
      const auditParams = new URLSearchParams({ limit: '1000', from: periodStart(auditPeriod) });
      const [clients, logs] = await Promise.all([
        crmApiRequest('clients'),
        crmApiRequest(`audit?${auditParams.toString()}`),
      ]);
      setApiClients(clients || []);
      setAuditLogs(logs || []);
      setAuditLastRefresh(new Date());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Impossible de charger les intégrations.');
    } finally {
      if (!silent) setIntegrationLoading(false);
    }
  }, [auditPeriod, crmApiRequest]);

  useEffect(() => {
    if (tab !== 'integrations') return;
    void loadIntegrations();
    const refreshTimer = window.setInterval(() => void loadIntegrations(true), 10_000);
    return () => window.clearInterval(refreshTimer);
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

  const mergeDuplicateContacts = async (group: DuplicateGroup, primary: Contact) => {
    const duplicates = group.contacts.filter(contact => contact.id !== primary.id);
    if (!duplicates.length) return;
    const primaryLabel = primary.entreprise || [primary.prenom, primary.nom].filter(Boolean).join(' ') || 'ce contact';
    if (!confirm(
      `Conserver « ${primaryLabel} » et fusionner ${duplicates.length} autre(s) fiche(s) dans celle-ci ?\n\n` +
      'Les champs manquants, notes, interactions, tâches, relances, documents et séquences seront conservés. Une sauvegarde complète sera créée avant la fusion.'
    )) return;

    setSaving(true);
    setMessage('');
    const { error } = await supabase.rpc('admin_merge_contacts', {
      p_primary_id: primary.id,
      p_duplicate_ids: duplicates.map(contact => contact.id),
    });
    if (error) setMessage(`Erreur : ${error.message}`);
    else {
      setMessage(`${duplicates.length} doublon(s) fusionné(s) dans « ${primaryLabel} ». Notes et historiques conservés.`);
      await Promise.all([loadBaseData(), loadDuplicates()]);
    }
    setSaving(false);
  };

  const createIntegration = async () => {
    if (!integrationName.trim() || !integrationUserId) {
      setMessage(`Choisissez l'utilisateur auquel cet agent ${brand.name} travaillera.`);
      return;
    }
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

  const updateIntegrationOwner = async (client: ApiClient, defaultUserId: string) => {
    if (!defaultUserId) return;
    setSaving(true);
    setMessage('');
    try {
      await crmApiRequest(`clients/${client.id}`, 'PATCH', { default_user_id: defaultUserId });
      const owner = profiles.find(profile => profile.id === defaultUserId);
      setMessage(`${client.name} travaille maintenant par défaut pour ${owner?.full_name || owner?.email || 'cet utilisateur'}.`);
      await loadIntegrations(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Attribution de l’agent impossible.');
    } finally {
      setSaving(false);
    }
  };

  const integrationMcpName = brand.code === 'epiderme_ai' ? 'epiderme-ai-crm' : `${brand.code.replace(/_/g, '-')}-crm`;
  const integrationApiUrl = `${String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1/crm-api`;
  const integrationPackageUrl = 'https://crm-prospection-wfy.netlify.app/downloads/openclaw-mcp.zip';
  const integrationOwner = profiles.find(profile => profile.id === integrationUserId);
  const integrationEmailRouting = brand.code === 'epiderme_ai' ? `
Règle impérative pour les emails :
- Contact en France : pays = "France", identité Epiderme AI (avec e final), expéditeur contact@epiderme-ai.com.
- Contact en Israël : pays = "Israël", identité Epiderm AI (sans e final), expéditeur contact@epiderm-ai.com.
- Ne choisis jamais l'identité d'après la langue ou le template. Renseigne d'abord le pays exact ; le CRM choisit automatiquement le bon compte Resend.
- Si le pays est incertain, n'envoie rien et demande une validation humaine.
` : '';
  const integrationGuide = `Configure sur le Mac mini le connecteur CRM OpenClaw exclusivement pour ${brand.name}.

Informations obligatoires :
- Espace CRM : ${brand.name}
- Collaborateur dédié : ${integrationOwner?.full_name || integrationOwner?.email || 'À sélectionner dans le CRM'}
- Nom MCP : ${integrationMcpName}
- API : ${integrationApiUrl}
- Clé API : ${generatedToken || 'crm_CLE_A_GENERER_DANS_LE_CRM'}
- Paquet MCP : ${integrationPackageUrl}
${integrationEmailRouting}

Exécute les commandes suivantes :

mkdir -p /Users/jordanchekroun/openclaw-integrations
cd /Users/jordanchekroun/openclaw-integrations
curl -fsSL ${integrationPackageUrl} -o openclaw-mcp.zip
unzip -oq openclaw-mcp.zip
cd /Users/jordanchekroun/openclaw-integrations/openclaw-mcp
npm ci
npm run build

openclaw mcp add ${integrationMcpName} \\
  --command node \\
  --arg /Users/jordanchekroun/openclaw-integrations/openclaw-mcp/dist/index.js \\
  --env CRM_API_URL=${integrationApiUrl} \\
  --env CRM_API_KEY=${generatedToken || 'crm_CLE_A_GENERER_DANS_LE_CRM'} \\
  --env "CRM_BRAND_NAME=${brand.name}"

openclaw mcp probe ${integrationMcpName}
openclaw mcp reload
openclaw mcp list

Ensuite, appelle l'outil crm_health. Vérifie impérativement que la réponse contient le code de marque "${brand.code}" et le nom "${brand.name}". Cette clé travaille par défaut pour "${integrationOwner?.full_name || integrationOwner?.email || 'le collaborateur choisi dans le CRM'}". Si le MCP existe déjà, mets à jour sa configuration au lieu d'en créer un doublon. N'utilise jamais cette clé ni ce MCP pour une autre marque ou un autre collaborateur.`;

  const copyIntegrationGuide = async () => {
    if (!generatedToken) {
      setMessage(`Générez d'abord une clé sécurisée pour ${brand.name}.`);
      return;
    }
    await navigator.clipboard.writeText(integrationGuide);
    setIntegrationGuideCopied(true);
    setMessage(`Instructions ${brand.name} copiées. Vous pouvez les transmettre directement à OpenClaw.`);
    window.setTimeout(() => setIntegrationGuideCopied(false), 3000);
  };

  const visibleAuditLogs = useMemo(
    () => auditClientId ? auditLogs.filter(log => log.client_id === auditClientId) : auditLogs,
    [auditClientId, auditLogs],
  );
  const auditGroups = useMemo(() => {
    const groups = new Map<string, { date: Date; logs: AgentAuditLog[] }>();
    for (const log of visibleAuditLogs) {
      const date = new Date(log.created_at);
      const key = date.toLocaleDateString('fr-CA');
      const group = groups.get(key) || { date, logs: [] };
      group.logs.push(log);
      groups.set(key, group);
    }
    return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
  }, [visibleAuditLogs]);
  const auditStats = useMemo(() => ({
    total: visibleAuditLogs.length,
    success: visibleAuditLogs.filter(log => log.result?.success !== false && (log.result?.status || 200) < 400).length,
    errors: visibleAuditLogs.filter(log => log.result?.success === false || (log.result?.status || 200) >= 400).length,
    activeAgents: apiClients.filter(client => client.active && client.last_used_at && Date.now() - new Date(client.last_used_at).getTime() <= 5 * 60_000).length,
  }), [apiClients, visibleAuditLogs]);
  const agentPresence = (client: ApiClient) => {
    if (!client.active) return { label: 'Révoqué', classes: 'bg-red-50 text-red-700', dot: 'bg-red-400' };
    if (!client.last_used_at) return { label: 'Jamais actif', classes: 'bg-slate-100 text-slate-500', dot: 'bg-slate-300' };
    const elapsed = Date.now() - new Date(client.last_used_at).getTime();
    if (elapsed <= 5 * 60_000) return { label: 'Actif maintenant', classes: 'bg-emerald-50 text-emerald-700', dot: 'animate-pulse bg-emerald-500' };
    if (elapsed <= 24 * 60 * 60_000) return { label: 'Actif aujourd’hui', classes: 'bg-blue-50 text-blue-700', dot: 'bg-blue-500' };
    return { label: 'Inactif', classes: 'bg-slate-100 text-slate-500', dot: 'bg-slate-300' };
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
      setNewUser({ full_name: '', email: '', password: '', role: 'contributor', timezone: DEFAULT_TIMEZONE });
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
      timezone: profile.timezone || DEFAULT_TIMEZONE,
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
        timezone: editUserForm.timezone,
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
        date_echeance: assignment.dueDate
          ? zonedDateTimeInputToIso(assignment.dueDate, selectedProfile?.timezone || DEFAULT_TIMEZONE)
          : null,
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
          ['sequences', 'Séquences email', Mail],
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
            <label className="block text-xs font-semibold text-slate-600">Fuseau horaire
              <select value={newUser.timezone} onChange={e => setNewUser({ ...newUser, timezone: e.target.value })}
                className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm">
                {TIMEZONE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <span className="mt-1.5 block font-normal text-slate-500">Utilisé pour le pointage, les dates et les rapports de cette personne.</span>
            </label>
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
                    <p className="mt-0.5 text-[11px] text-slate-400">{TIMEZONE_OPTIONS.find(option => option.value === (profile.timezone || DEFAULT_TIMEZONE))?.label || profile.timezone}</p>
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
              <p className="mt-1.5 text-xs text-slate-500">
                Heure de {selectedProfile?.full_name || "l'utilisateur"} · {selectedProfile?.timezone || DEFAULT_TIMEZONE}
              </p>
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
                      <button onClick={() => void mergeDuplicateContacts(group, contact)} disabled={saving}
                        className="flex items-center gap-1.5 rounded-lg border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                        title="Conserver cette fiche et y rattacher toutes les autres">
                        <GitMerge className="h-3.5 w-3.5" />Fusionner ici
                      </button>
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
                      <td className="px-4 py-3 text-xs text-slate-500">{kpi.lastStart ? <>{formatInTimezone(kpi.lastStart, profile?.timezone, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}<span className="block text-[10px] text-slate-400">{profile?.timezone || DEFAULT_TIMEZONE}</span></> : 'Aucun'}</td>
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
                  <span className="min-w-[170px] text-xs text-slate-600">Début : {formatInTimezone(session.debut, profile?.timezone, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}<span className="ml-1 text-[10px] text-slate-400">({profile?.timezone || DEFAULT_TIMEZONE})</span></span>
                  <span className="min-w-[110px] text-xs text-slate-500">Fin : {session.fin ? formatInTimezone(session.fin, profile?.timezone, { hour: '2-digit', minute: '2-digit' }) : 'En cours'}</span>
                  <span className="min-w-[70px] text-right font-bold text-slate-800">{minutesLabel(duration)}</span>
                </div>;
              })}
              {!recentSessions.length && <p className="p-8 text-center text-sm text-slate-500">Aucun pointage sur cette période.</p>}
            </div>
          </div>
        </div>
      )}

      {tab === 'sequences' && (() => {
        const latestRun = sequenceRuns[0];
        const totalSent = sequenceEnrollments.reduce((sum, item) => sum + (item.sent_count || 0), 0);
        const totalErrors = sequenceEnrollments.reduce((sum, item) => sum + (item.error_count || 0), 0);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const sentToday = sequenceAttempts.filter(item => item.status === 'sent' && new Date(item.finished_at || item.started_at) >= todayStart).length;
        const errorsToday = sequenceAttempts.filter(item => item.status === 'error' && new Date(item.finished_at || item.started_at) >= todayStart).length;
        const scheduledToday = sequenceEnrollments.filter(item => item.statut === 'active' && item.prochaine_execution && new Date(item.prochaine_execution).toDateString() === new Date().toDateString()).length;
        const normalizedSearch = sequenceSearch.trim().toLowerCase();
        const visibleSequenceEnrollments = sequenceEnrollments.filter(item => {
          if (sequenceStatusFilter && item.execution_status !== sequenceStatusFilter) return false;
          if (!normalizedSearch) return true;
          return `${item.contacts?.entreprise || ''} ${item.contacts?.prenom || ''} ${item.contacts?.nom || ''} ${item.contacts?.email || ''} ${item.email_sequences?.titre || ''}`.toLowerCase().includes(normalizedSearch);
        });
        return (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 inline-flex rounded-xl bg-blue-50 p-2"><Clock className="h-4 w-4 text-blue-600" /></div>
                <p className="text-sm font-bold text-slate-900">{latestRun ? formatInTimezone(latestRun.started_at, DEFAULT_TIMEZONE, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Jamais'}</p>
                <p className="text-xs text-slate-500">Dernier passage du moteur</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 inline-flex rounded-xl bg-emerald-50 p-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /></div>
                <p className="text-2xl font-bold text-slate-900">{sentToday}</p><p className="text-xs text-slate-500">Envoyés aujourd’hui</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 inline-flex rounded-xl bg-red-50 p-2"><AlertCircle className="h-4 w-4 text-red-600" /></div>
                <p className="text-2xl font-bold text-slate-900">{errorsToday}</p><p className="text-xs text-slate-500">Erreurs aujourd’hui</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 inline-flex rounded-xl bg-amber-50 p-2"><CalendarDays className="h-4 w-4 text-amber-600" /></div>
                <p className="text-2xl font-bold text-slate-900">{scheduledToday}</p><p className="text-xs text-slate-500">Programmés aujourd’hui</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 inline-flex rounded-xl bg-slate-100 p-2"><History className="h-4 w-4 text-slate-600" /></div>
                <p className="text-sm font-bold text-slate-900">{totalSent} envoyés · {totalErrors} erreurs</p><p className="text-xs text-slate-500">Cumul de l’espace</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 inline-flex rounded-xl bg-violet-50 p-2"><Radio className="h-4 w-4 text-violet-600" /></div>
                <p className="text-sm font-bold text-slate-900">Automatique · chaque minute</p><p className="text-xs text-slate-500">Fonctionne même CRM fermé</p>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                <div><h2 className="font-bold text-slate-900">Tester une séquence</h2><p className="text-xs text-slate-500">Envoie immédiatement la prochaine étape d’un prospect actif.</p></div>
                <button type="button" onClick={() => void loadSequenceMonitoring()} disabled={sequenceLoading}
                  className="flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                  <RefreshCw className={`h-3.5 w-3.5 ${sequenceLoading ? 'animate-spin' : ''}`} />Actualiser
                </button>
              </div>
              <div className="divide-y divide-slate-100">
                {sequenceDefinitions.map(sequence => (
                  <div key={sequence.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                    <div className="min-w-[220px] flex-1"><p className="text-sm font-semibold text-slate-900">{sequence.titre}</p><p className="text-xs text-slate-400">{sequence.etapes.length} étape(s) · {sequence.actif ? 'Active' : 'En pause'}</p></div>
                    <span className="text-xs text-slate-500">{sequenceEnrollments.filter(item => item.sequence_id === sequence.id && item.statut === 'active').length} prospect(s) actif(s)</span>
                    <button type="button" onClick={() => void runSequenceNow(sequence.id)} disabled={!sequence.actif || sequenceActionId === sequence.id}
                      className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">
                      {sequenceActionId === sequence.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}Exécuter maintenant
                    </button>
                  </div>
                ))}
                {!sequenceDefinitions.length && <p className="px-5 py-8 text-center text-sm text-slate-500">Aucune séquence dans cet espace.</p>}
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-4">
                <div className="min-w-[220px] flex-1"><h2 className="font-bold text-slate-900">Suivi par prospect</h2><p className="text-xs text-slate-500">État, prochaine échéance et erreur exacte.</p></div>
                <input value={sequenceSearch} onChange={event => setSequenceSearch(event.target.value)} placeholder="Prospect, email ou séquence…" className="min-w-[240px] rounded-xl border border-slate-300 px-3 py-2 text-xs" />
                <select value={sequenceStatusFilter} onChange={event => setSequenceStatusFilter(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-xs">
                  <option value="">Tous les états</option><option value="pending">En attente</option><option value="processing">En cours</option><option value="sent">Envoyé</option><option value="error">Erreur</option><option value="completed">Terminé</option><option value="cancelled">Annulé</option>
                </select>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Prospect</th><th className="px-4 py-3">Séquence</th><th className="px-4 py-3">Étape</th><th className="px-4 py-3">État</th><th className="px-4 py-3">Prochaine exécution</th><th className="px-4 py-3">Résultat</th><th className="px-4 py-3">Action</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleSequenceEnrollments.map(enrollment => {
                      const status = SEQUENCE_STATUS[enrollment.execution_status] || SEQUENCE_STATUS.pending;
                      const contact = enrollment.contacts;
                      const sequence = enrollment.email_sequences;
                      return <tr key={enrollment.id} className="align-top hover:bg-slate-50">
                        <td className="px-5 py-3"><button type="button" onClick={() => contact?.id && onOpenContact(contact.id)} className="text-left font-semibold text-blue-700 hover:underline">{contact?.entreprise || [contact?.prenom, contact?.nom].filter(Boolean).join(' ') || 'Prospect supprimé'}</button><p className="text-xs text-slate-400">{contact?.email || 'Sans email'}</p></td>
                        <td className="px-4 py-3 text-xs font-medium text-slate-700">{sequence?.titre || 'Séquence supprimée'}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">{enrollment.etape_courante + 1}/{sequence?.etapes?.length || '?'}</td>
                        <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.classes}`}>{status.label}</span></td>
                        <td className="px-4 py-3 text-xs text-slate-600">{enrollment.prochaine_execution ? formatInTimezone(enrollment.prochaine_execution, DEFAULT_TIMEZONE, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                        <td className="max-w-[300px] px-4 py-3"><p className="text-xs text-emerald-700">{enrollment.sent_count} envoyé(s)</p>{enrollment.last_error && <p className="mt-1 whitespace-pre-wrap text-xs font-medium text-red-600">{enrollment.last_error}</p>}</td>
                        <td className="px-4 py-3">{enrollment.execution_status === 'error' && <button type="button" onClick={() => void retrySequenceEnrollment(enrollment.id)} disabled={sequenceActionId === enrollment.id}
                          className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
                          <RefreshCw className={`h-3.5 w-3.5 ${sequenceActionId === enrollment.id ? 'animate-spin' : ''}`} />Réessayer
                        </button>}</td>
                      </tr>;
                    })}
                    {!visibleSequenceEnrollments.length && <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-500">Aucun prospect ne correspond aux filtres.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-bold text-slate-900">Journal des e-mails</h2><p className="text-xs text-slate-500">Destinataire, objet, fournisseur et identifiant technique de chaque tentative.</p></div>
              <div className="max-h-[480px] divide-y divide-slate-100 overflow-y-auto">
                {sequenceAttempts.map(attempt => {
                  const contactName = attempt.contacts?.entreprise || [attempt.contacts?.prenom, attempt.contacts?.nom].filter(Boolean).join(' ') || attempt.recipient_email || 'Prospect supprimé';
                  return <div key={attempt.id} className="flex flex-wrap items-start gap-4 px-5 py-3 text-xs">
                    <span className={`mt-1 h-2.5 w-2.5 rounded-full ${attempt.status === 'sent' ? 'bg-emerald-500' : attempt.status === 'error' ? 'bg-red-500' : 'animate-pulse bg-blue-500'}`} />
                    <div className="min-w-[190px]"><button type="button" onClick={() => attempt.contacts?.id && onOpenContact(attempt.contacts.id)} className="font-semibold text-blue-700 hover:underline">{contactName}</button><p className="text-slate-400">{attempt.recipient_email || 'Email inconnu'}</p></div>
                    <div className="min-w-[260px] flex-1"><p className="font-semibold text-slate-700">{attempt.subject || `Étape ${attempt.step_index + 1}`}</p><p className="text-slate-400">{attempt.email_sequences?.titre || 'Séquence supprimée'} · Étape {attempt.step_index + 1}</p>{attempt.error && <p className="mt-1 whitespace-pre-wrap font-medium text-red-600">{attempt.error}</p>}</div>
                    <div className="min-w-[180px]"><p className="font-semibold text-slate-700">{attempt.sender_code === 'epiderm_il' ? 'Epiderm AI · Israël' : attempt.sender_code === 'epiderme_fr' ? 'Epiderme AI · France' : (attempt.provider || 'En cours').toUpperCase()}</p><p className="text-slate-500">{attempt.from_email || 'Expéditeur en attente'}</p><p className="max-w-[180px] truncate text-[10px] text-slate-400" title={attempt.provider_message_id || ''}>{attempt.provider_message_id || 'Identifiant en attente'}</p></div>
                    <time className="text-slate-500">{formatInTimezone(attempt.finished_at || attempt.started_at, DEFAULT_TIMEZONE, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                  </div>;
                })}
                {!sequenceAttempts.length && <p className="px-5 py-8 text-center text-sm text-slate-500">Aucun e-mail traité pour le moment.</p>}
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-bold text-slate-900">Historique du moteur</h2></div>
              <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                {sequenceRuns.map(run => <div key={run.id} className="flex flex-wrap items-center gap-4 px-5 py-3 text-xs">
                  <span className={`h-2.5 w-2.5 rounded-full ${run.status === 'failed' ? 'bg-red-500' : run.status === 'running' ? 'animate-pulse bg-blue-500' : 'bg-emerald-500'}`} />
                  <span className="min-w-[150px] font-semibold text-slate-700">{run.source === 'cron' ? 'Automatique' : 'Administrateur'}</span>
                  <span className="text-slate-500">{formatInTimezone(run.started_at, DEFAULT_TIMEZONE, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  <span className="text-emerald-700">{run.success_count} réussi</span><span className="text-red-600">{run.error_count} erreur</span>
                  {run.error && <span className="min-w-[260px] flex-1 text-red-600">{run.error}</span>}
                </div>)}
                {!sequenceRuns.length && <p className="px-5 py-8 text-center text-sm text-slate-500">Le moteur n’a pas encore été exécuté.</p>}
              </div>
            </div>
          </div>
        );
      })()}

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
              <label className="block text-xs font-semibold text-slate-600">Utilisateur pour lequel l’agent travaille *
                <select value={integrationUserId} onChange={event => setIntegrationUserId(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm">
                  <option value="">Choisir un utilisateur…</option>
                  {profiles.filter(profile => profile.active).map(profile => (
                    <option key={profile.id} value={profile.id}>{profile.full_name || profile.email}</option>
                  ))}
                </select>
              </label>
              <div className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                Cette clé sera verrouillée sur <strong>{brand.name}</strong> et dédiée à <strong>{profiles.find(profile => profile.id === integrationUserId)?.full_name || 'l’utilisateur sélectionné'}</strong>. Elle ne peut ni lire ni écrire dans un autre espace.
              </div>
              <button onClick={createIntegration} disabled={saving || !integrationName.trim() || !integrationUserId}
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
                  <button type="button" onClick={() => void copyIntegrationGuide()}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-emerald-700">
                    {integrationGuideCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {integrationGuideCopied ? 'Tout est copié' : 'Copier tout pour OpenClaw'}
                  </button>
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
                  const presence = agentPresence(client);
                  const actionCount = auditLogs.filter(log => log.client_id === client.id).length;
                  return (
                    <div key={client.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                      <div className={`rounded-xl p-2.5 ${client.active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}><Plug className="h-5 w-5" /></div>
                      <div className="min-w-[200px] flex-1">
                        <p className="font-semibold text-slate-900">{client.name}</p>
                        <p className="text-xs text-slate-500">{client.key_prefix}…</p>
                        <p className={`mt-1 text-xs font-semibold ${defaultUser ? 'text-violet-700' : 'text-red-600'}`}>Travaille pour : {defaultUser?.full_name || defaultUser?.email || 'Aucun utilisateur attribué'}</p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          Dernière utilisation : {client.last_used_at ? new Date(client.last_used_at).toLocaleString('fr-FR') : 'Jamais'}
                          {client.expires_at ? ` · Expire le ${new Date(client.expires_at).toLocaleDateString('fr-FR')}` : ''}
                        </p>
                        <p className="mt-1 text-[11px] font-medium text-slate-500">{actionCount} action(s) sur la période sélectionnée</p>
                      </div>
                      <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Collaborateur dédié
                        <select value={client.default_user_id || ''} onChange={event => void updateIntegrationOwner(client, event.target.value)} disabled={saving || !client.active}
                          className="mt-1 block max-w-48 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium normal-case tracking-normal text-slate-700 disabled:bg-slate-100">
                          <option value="">Choisir…</option>
                          {profiles.filter(profile => profile.active).map(profile => <option key={profile.id} value={profile.id}>{profile.full_name || profile.email}</option>)}
                        </select>
                      </label>
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${presence.classes}`}><span className={`h-2 w-2 rounded-full ${presence.dot}`} />{presence.label}</span>
                      {client.active && <button onClick={() => revokeIntegration(client)} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50">Révoquer</button>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100 bg-blue-50 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-blue-600 p-2 text-white"><Info className="h-4 w-4" /></div>
                <div>
                  <h2 className="font-bold text-slate-900">Configurer OpenClaw · {brand.name}</h2>
                  <p className="text-xs text-slate-600">Un seul copier-coller contient le téléchargement, l’API, la clé et les commandes Mac mini.</p>
                </div>
              </div>
              <button type="button" onClick={() => void copyIntegrationGuide()} disabled={!generatedToken}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">
                {integrationGuideCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {integrationGuideCopied ? 'Instructions copiées' : 'Copier tout pour OpenClaw'}
              </button>
            </div>
            <div className="grid gap-5 p-5 lg:grid-cols-[1fr_1.35fr]">
              <div className="space-y-3">
                {[
                  ['1', `Vérifiez que l’espace actif est ${brand.name}.`],
                  ['2', 'Choisissez l’utilisateur par défaut puis générez une clé sécurisée.'],
                  ['3', 'Cliquez sur « Copier tout pour OpenClaw » avant de quitter la page.'],
                  ['4', 'Envoyez le texte copié à votre agent OpenClaw sur le Mac mini.'],
                ].map(([number, text]) => (
                  <div key={number} className="flex gap-3 text-sm text-slate-700">
                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">{number}</span>
                    <p className="pt-0.5">{text}</p>
                  </div>
                ))}
                {!generatedToken && (
                  <p className="rounded-xl bg-amber-50 p-3 text-xs font-medium leading-relaxed text-amber-800">
                    Le bouton de copie sera activé après la génération de la clé. Une ancienne clé ne peut pas être réaffichée : générez-en une nouvelle si vous ne l’avez plus.
                  </p>
                )}
              </div>
              <div className="min-w-0 space-y-2">
                <div className="grid gap-2 text-xs sm:grid-cols-2">
                  <div className="rounded-lg bg-slate-50 p-2.5"><span className="block text-slate-400">Nom MCP</span><code className="font-semibold text-slate-700">{integrationMcpName}</code></div>
                  <div className="rounded-lg bg-slate-50 p-2.5"><span className="block text-slate-400">Marque attendue</span><code className="font-semibold text-slate-700">{brand.code}</code></div>
                </div>
                <details className="rounded-xl border border-slate-200 bg-slate-950 text-slate-100">
                  <summary className="cursor-pointer px-4 py-3 text-xs font-semibold">Afficher les instructions et commandes</summary>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all border-t border-slate-800 p-4 text-[11px] leading-relaxed">{integrationGuide}</pre>
                </details>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="space-y-4 border-b border-slate-200 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <History className="h-5 w-5 text-slate-500" />
                  <div><h2 className="font-bold text-slate-900">Suivi d’activité des agents</h2><p className="text-xs text-slate-500">Actualisation automatique toutes les 10 secondes · activité réellement envoyée au CRM</p></div>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1.5"><Radio className="h-3.5 w-3.5 text-emerald-500" />{auditLastRefresh ? `Mis à jour à ${auditLastRefresh.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Chargement…'}</span>
                  <button type="button" onClick={() => void loadIntegrations()} disabled={integrationLoading} title="Actualiser maintenant"
                    className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${integrationLoading ? 'animate-spin' : ''}`} /></button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-xl bg-slate-100 p-1">
                  {(['day', 'week', 'month'] as Period[]).map(value => (
                    <button key={value} type="button" onClick={() => setAuditPeriod(value)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${auditPeriod === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                      {value === 'day' ? 'Aujourd’hui' : value === 'week' ? 'Cette semaine' : 'Ce mois'}
                    </button>
                  ))}
                </div>
                <select value={auditClientId} onChange={event => setAuditClientId(event.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700">
                  <option value="">Tous les agents</option>
                  {apiClients.map(client => {
                    const owner = profiles.find(profile => profile.id === client.default_user_id);
                    return <option key={client.id} value={client.id}>{client.name} → {owner?.full_name || owner?.email || 'non attribué'}</option>;
                  })}
                </select>
              </div>
            </div>

            <div className="grid gap-3 border-b border-slate-100 bg-slate-50/70 p-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: 'Actions', value: auditStats.total, icon: Activity, color: 'text-blue-600', bg: 'bg-blue-50' },
                { label: 'Réussies', value: auditStats.success, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                { label: 'Erreurs', value: auditStats.errors, icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50' },
                { label: 'Agents actifs maintenant', value: auditStats.activeAgents, icon: Radio, color: 'text-violet-600', bg: 'bg-violet-50' },
              ].map(({ label, value, icon: Icon, color, bg }) => (
                <div key={label} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
                  <div className={`rounded-lg p-2 ${bg}`}><Icon className={`h-4 w-4 ${color}`} /></div>
                  <div><p className="text-xl font-bold text-slate-900">{value}</p><p className="text-[11px] text-slate-500">{label}</p></div>
                </div>
              ))}
            </div>

            <div className="max-h-[720px] overflow-y-auto">
              {!auditGroups.length && <div className="p-12 text-center"><CalendarDays className="mx-auto mb-3 h-9 w-9 text-slate-200" /><p className="text-sm font-medium text-slate-500">Aucune action sur cette période.</p></div>}
              {auditGroups.map(group => (
                <section key={group.key} className="border-b border-slate-100 last:border-0">
                  <div className="sticky top-0 z-10 flex items-center justify-between bg-slate-100/95 px-5 py-2.5 backdrop-blur">
                    <h3 className="text-xs font-bold capitalize text-slate-700">{group.date.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</h3>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500">{group.logs.length} action(s)</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {group.logs.map(log => {
                      const client = apiClients.find(item => item.id === log.client_id);
                      const resolvedOwnerId = typeof log.payload?._resolved_user_id === 'string'
                        ? log.payload._resolved_user_id
                        : null;
                      const explicitOwnerId = typeof log.payload?.assigned_to === 'string'
                        ? log.payload.assigned_to
                        : typeof log.payload?.user_id === 'string' ? log.payload.user_id : null;
                      const ownerId = resolvedOwnerId || explicitOwnerId || client?.default_user_id || log.admin_user_id || null;
                      const owner = profiles.find(profile => profile.id === ownerId);
                      const success = log.result?.success !== false && (log.result?.status || 200) < 400;
                      return (
                        <div key={log.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm hover:bg-slate-50">
                          <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${success ? 'bg-emerald-500' : 'bg-red-500'}`} />
                          <div className="min-w-[170px]">
                            <p className="text-xs font-bold text-slate-800">{client?.name || (log.client_id ? 'Agent supprimé' : 'Administrateur CRM')}</p>
                            <p className={`text-[10px] font-semibold ${owner ? 'text-violet-600' : 'text-red-500'}`}>Travaille pour : {owner?.full_name || owner?.email || 'non attribué'}</p>
                            <p className="text-[10px] text-slate-400">{client?.key_prefix ? `${client.key_prefix}…${resolvedOwnerId || explicitOwnerId ? ' · attribution enregistrée' : ' · attribution par défaut'}` : 'Action humaine'}</p>
                          </div>
                          <div className="min-w-[210px] flex-1">
                            <p className="text-xs font-semibold text-slate-700">{agentActionLabel(log.action)}</p>
                            <p className="mt-0.5 truncate text-[10px] text-slate-400">{log.entity_type || 'système'}{log.entity_id ? ` · ${log.entity_id}` : ''}</p>
                          </div>
                          {log.entity_type === 'contact' && log.entity_id && (
                            <button type="button" onClick={() => onOpenContact(log.entity_id!)} className="text-[11px] font-semibold text-blue-600 hover:text-blue-800">Voir le contact</button>
                          )}
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{success ? 'Réussi' : `Erreur ${log.result?.status || ''}`}</span>
                          <time className="w-16 text-right text-xs font-medium text-slate-500">{new Date(log.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                        </div>
                      );
                    })}
                  </div>
                </section>
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
              <label className="block text-xs font-semibold text-slate-600">Fuseau horaire
                <select value={editUserForm.timezone} onChange={event => setEditUserForm({ ...editUserForm, timezone: event.target.value })}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm">
                  {TIMEZONE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <span className="mt-1.5 block font-normal text-slate-500">Les horaires de pointage seront présentés dans ce fuseau.</span>
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
