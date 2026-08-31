import { useEffect, useState, useRef } from 'react';
import {
  Plus, Phone, Mail, MessageCircle, X, Clock,
  Facebook as FacebookIcon, Instagram as InstagramIcon,
  ChevronUp, ChevronDown, Settings2, Eye, EyeOff, Search, Trash2,
  CreditCard, Send, FileText, UserRound,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Interaction, Contact, Profile, Template } from '../types/database';
import ContactSearchSelect from '../components/ContactSearchSelect';
import ContactSidePanel from '../components/ContactSidePanel';
import { usePermissions } from '../contexts/PermissionsContext';
import { useBrand } from '../contexts/BrandContext';
import { formatInTimezone, safeTimezone, toZonedDateTimeInput } from '../lib/timezone';

const TYPES = ['Appel', 'Email', 'WhatsApp', 'SMS', 'Facebook', 'Instagram'] as const;
const RESULTATS = ['Pas de réponse', 'Répondu', 'Intéressé', 'Non intéressé', 'Relance'] as const;

type SortKey = 'date_heure' | 'type' | 'resultat' | 'duree' | 'contact';
type SortDir = 'asc' | 'desc';

type ColumnDef = { key: string; label: string; defaultVisible: boolean };
const ALL_COLUMNS: ColumnDef[] = [
  { key: 'contact', label: 'Contact', defaultVisible: true },
  { key: 'entreprise', label: 'Entreprise', defaultVisible: true },
  { key: 'type', label: 'Type', defaultVisible: true },
  { key: 'date', label: 'Date & Heure', defaultVisible: true },
  { key: 'duree', label: 'Durée', defaultVisible: true },
  { key: 'resultat', label: 'Résultat', defaultVisible: true },
  { key: 'notes', label: 'Notes', defaultVisible: true },
  { key: 'auteur', label: 'Créée par / responsable', defaultVisible: true },
];

const TYPE_COLORS: Record<string, string> = {
  'Appel': 'bg-blue-50 text-blue-700 border-blue-200',
  'Email': 'bg-violet-50 text-violet-700 border-violet-200',
  'WhatsApp': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'SMS': 'bg-orange-50 text-orange-700 border-orange-200',
  'Facebook': 'bg-blue-50 text-blue-800 border-blue-300',
  'Instagram': 'bg-pink-50 text-pink-700 border-pink-200',
};
const RESULT_COLORS: Record<string, string> = {
  'Intéressé': 'bg-emerald-50 text-emerald-700',
  'Répondu': 'bg-blue-50 text-blue-700',
  'Pas de réponse': 'bg-slate-100 text-slate-600',
  'Non intéressé': 'bg-red-50 text-red-700',
  'Relance': 'bg-amber-50 text-amber-700',
};

function getTypeIcon(type: string) {
  switch (type) {
    case 'Appel': return Phone;
    case 'Email': return Mail;
    case 'Facebook': return FacebookIcon;
    case 'Instagram': return InstagramIcon;
    default: return MessageCircle;
  }
}

function SortTh({ col, label, sortKey, sortDir, onSort }: { col: SortKey; label: string; sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void }) {
  return (
    <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap" onClick={() => onSort(col)}>
      {label}
      {col === sortKey
        ? sortDir === 'asc' ? <ChevronUp className="w-3 h-3 inline ml-1 text-blue-600" /> : <ChevronDown className="w-3 h-3 inline ml-1 text-blue-600" />
        : <ChevronUp className="w-3 h-3 inline ml-1 text-slate-300 opacity-60" />}
    </th>
  );
}

type Props = {
  onOpenContact?: (id: string) => void;
  timezone?: string;
  profileId?: string;
};

export default function Interactions({ onOpenContact, timezone: requestedTimezone, profileId }: Props) {
  const timezone = safeTimezone(requestedTimezone);
  const { canModify, canDelete } = usePermissions();
  const { brand } = useBrand();
  const [interactions, setInteractions] = useState<(Interaction & { contacts?: Contact })[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [filterResultat, setFilterResultat] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date_heure');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [visibleCols, setVisibleCols] = useState<Set<string>>(
    () => {
      const defaults = ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key);
      try {
        const saved = JSON.parse(localStorage.getItem(`crm-interaction-visible-columns:${profileId || 'default'}`) || '[]') as string[];
        const valid = saved.filter(key => ALL_COLUMNS.some(column => column.key === key));
        return new Set(valid.length ? valid : defaults);
      } catch { return new Set(defaults); }
    }
  );
  const [showColPanel, setShowColPanel] = useState(false);
  const colPanelRef = useRef<HTMLDivElement>(null);
  const [sidePanelContact, setSidePanelContact] = useState<Contact | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [emailTemplates, setEmailTemplates] = useState<Template[]>([]);
  const [showQuickEmail, setShowQuickEmail] = useState<string | null>(null);
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);
  const [emailSentFeedback, setEmailSentFeedback] = useState<{ id: string; success: boolean; msg: string } | null>(null);

  const [formData, setFormData] = useState({
    contact_id: '',
    type: 'Appel' as Interaction['type'],
    date_heure: toZonedDateTimeInput(new Date(), timezone),
    duree: 0,
    resultat: '' as Interaction['resultat'],
    notes: '',
  });

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    localStorage.setItem(`crm-interaction-visible-columns:${profileId || 'default'}`, JSON.stringify([...visibleCols]));
  }, [visibleCols, profileId]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (colPanelRef.current && !colPanelRef.current.contains(e.target as Node)) setShowColPanel(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const loadData = async () => {
    try {
      const [iRes, cRes, tRes, pRes] = await Promise.all([
        supabase.from('interactions').select('*, contacts(*)').order('date_heure', { ascending: false }),
        supabase.from('contacts').select('*').order('nom', { ascending: true }),
        supabase.from('templates').select('*').eq('type', 'Email').order('titre'),
        supabase.from('profiles').select('*').order('full_name'),
      ]);
      setInteractions(iRes.data || []);
      setContacts(cRes.data || []);
      setEmailTemplates(tRes.data || []);
      setProfiles(pRes.data || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const handleQuickSendEmail = async (contact: Contact, template: Template) => {
    if (!contact.email) return;
    setSendingEmailId(template.id);
    try {
      const html = template.contenu
        .replace(/\{prenom\}/g, contact.prenom || '')
        .replace(/\{nom\}/g, contact.nom || '')
        .replace(/\{entreprise\}/g, contact.entreprise || '')
        .replace(/\{email\}/g, contact.email || '')
        .replace(/\{telephone\}/g, contact.telephone || '');
      const isHtml = /<[a-z][\s\S]*>/i.test(html);

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`;
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          brand_code: brand.code,
          contact_id: contact.id,
          to: contact.email,
          subject: template.objet || template.titre,
          html: isHtml ? html : `<div style="font-family:sans-serif;white-space:pre-wrap;">${html}</div>`,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        const senderName = data.sender?.name || data.sender?.from_email || data.provider;
        setEmailSentFeedback({ id: contact.id, success: true, msg: `Envoyé via ${senderName}` });
        loadData();
      } else {
        setEmailSentFeedback({ id: contact.id, success: false, msg: data.error || 'Erreur' });
      }
    } catch (err) {
      setEmailSentFeedback({ id: contact.id, success: false, msg: (err as Error).message });
    } finally {
      setSendingEmailId(null);
      setShowQuickEmail(null);
      setTimeout(() => setEmailSentFeedback(null), 3000);
    }
  };

  const resetForm = () => {
    setFormData({ contact_id: '', type: 'Appel', date_heure: toZonedDateTimeInput(new Date(), timezone), duree: 0, resultat: '', notes: '' });
    setEditingId(null);
  };

  const handleEdit = (interaction: Interaction & { contacts?: Contact }) => {
    setEditingId(interaction.id);
    setFormData({
      contact_id: interaction.contact_id,
      type: interaction.type,
      date_heure: toZonedDateTimeInput(interaction.date_heure, timezone),
      duree: interaction.duree || 0,
      resultat: interaction.resultat || '',
      notes: interaction.notes || '',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { error } = await supabase.rpc('save_interaction_local_time', {
        p_interaction_id: editingId,
        p_contact_id: formData.contact_id,
        p_type: formData.type,
        p_local_datetime: formData.date_heure,
        p_timezone: timezone,
        p_duree: formData.duree,
        p_resultat: formData.resultat,
        p_notes: formData.notes,
      });
      if (error) throw error;
      setShowModal(false); resetForm(); loadData();
    } catch (err) { console.error(err); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette interaction ?')) return;
    await supabase.from('interactions').delete().eq('id', id);
    loadData();
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const toggleCol = (key: string) => {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) { if (next.size > 1) next.delete(key); }
      else next.add(key);
      return next;
    });
  };

  const filtered = interactions
    .filter(i => {
      if (filterType && i.type !== filterType) return false;
      if (filterResultat && i.resultat !== filterResultat) return false;
      if (searchTerm) {
        const t = searchTerm.toLowerCase();
        const c = i.contacts;
        const author = profiles.find(profile => profile.id === i.user_id);
        if (!(`${c?.prenom} ${c?.nom}`.toLowerCase().includes(t) || (c?.entreprise || '').toLowerCase().includes(t) || (i.notes || '').toLowerCase().includes(t) || (author?.full_name || author?.email || '').toLowerCase().includes(t))) return false;
      }
      return true;
    })
    .sort((a, b) => {
      let av: string | number = '';
      let bv: string | number = '';
      if (sortKey === 'date_heure') { av = a.date_heure; bv = b.date_heure; }
      else if (sortKey === 'type') { av = a.type; bv = b.type; }
      else if (sortKey === 'resultat') { av = a.resultat || ''; bv = b.resultat || ''; }
      else if (sortKey === 'duree') { av = a.duree || 0; bv = b.duree || 0; }
      else if (sortKey === 'contact') {
        av = `${(a.contacts as any)?.nom || ''} ${(a.contacts as any)?.prenom || ''}`;
        bv = `${(b.contacts as any)?.nom || ''} ${(b.contacts as any)?.prenom || ''}`;
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

  const fmtDateTime = (d: string) => formatInTimezone(d, timezone, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Interactions</h1>
          <p className="text-sm text-slate-500 mt-0.5">{filtered.length} interaction(s)</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors text-sm font-semibold shadow-sm shadow-blue-500/30"
        >
          <Plus className="w-4 h-4" />
          Nouvelle interaction
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-40">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher un contact, des notes..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            <button onClick={() => setFilterType('')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${filterType === '' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Tout</button>
            {TYPES.map(type => {
              const Icon = getTypeIcon(type);
              return (
                <button key={type} onClick={() => setFilterType(filterType === type ? '' : type)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${filterType === type ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  <Icon className="w-3 h-3" />{type}
                </button>
              );
            })}
          </div>
          <select value={filterResultat} onChange={e => setFilterResultat(e.target.value)} className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none">
            <option value="">Tous les résultats</option>
            {RESULTATS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {(filterType || filterResultat || searchTerm) && (
            <button onClick={() => { setFilterType(''); setFilterResultat(''); setSearchTerm(''); }} className="text-xs text-slate-500 hover:text-red-600 flex items-center gap-1 px-2">
              <X className="w-3.5 h-3.5" />Effacer
            </button>
          )}
        </div>
      </div>

      {/* Column toggle */}
      <div className="flex justify-end">
        <div className="relative" ref={colPanelRef}>
          <button
            onClick={() => setShowColPanel(o => !o)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-slate-200 rounded-xl bg-white hover:bg-slate-50 shadow-sm"
          >
            <Settings2 className="w-4 h-4 text-slate-500" />
            Colonnes
            <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-bold">{visibleCols.size}</span>
          </button>
          {showColPanel && (
            <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-100">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Colonnes visibles</p>
              </div>
              {ALL_COLUMNS.map(col => (
                <button key={col.key} onClick={() => toggleCol(col.key)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <span>{col.label}</span>
                  {visibleCols.has(col.key) ? <Eye className="w-4 h-4 text-blue-600" /> : <EyeOff className="w-4 h-4 text-slate-300" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {visibleCols.has('contact') && <SortTh col="contact" label="Contact" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
                {visibleCols.has('entreprise') && <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap">Entreprise</th>}
                {visibleCols.has('type') && <SortTh col="type" label="Type" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
                {visibleCols.has('date') && <SortTh col="date_heure" label="Date & Heure" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
                {visibleCols.has('duree') && <SortTh col="duree" label="Durée" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
                {visibleCols.has('resultat') && <SortTh col="resultat" label="Résultat" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />}
                {visibleCols.has('notes') && <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap">Notes</th>}
                {visibleCols.has('auteur') && <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap">Créée par</th>}
                <th className="px-3 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(interaction => {
                const Icon = getTypeIcon(interaction.type);
                const contact = interaction.contacts;
                const author = profiles.find(profile => profile.id === interaction.user_id);
                const responsible = profiles.find(profile => profile.id === contact?.assigned_to);
                return (
                  <tr key={interaction.id} className="hover:bg-slate-50 transition-colors group">
                    {visibleCols.has('contact') && (
                      <td className="px-3 py-3 whitespace-nowrap">
                        {contact ? (
                          <button
                            onClick={() => setSidePanelContact(contact as Contact)}
                            className="flex items-center gap-2 group/contact hover:bg-blue-50 rounded-lg px-1.5 py-0.5 -mx-1.5 transition-colors"
                          >
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                              {contact.prenom?.[0]?.toUpperCase()}{contact.nom?.[0]?.toUpperCase()}
                            </div>
                            <p className="font-semibold text-slate-900 text-xs group-hover/contact:text-blue-700 transition-colors">
                              {contact.prenom} {contact.nom}
                            </p>
                          </button>
                        ) : <span className="text-slate-400 text-xs">—</span>}
                      </td>
                    )}
                    {visibleCols.has('entreprise') && (
                      <td className="px-3 py-3 whitespace-nowrap text-xs font-semibold text-slate-700">
                        {contact?.entreprise || <span className="font-normal text-slate-300">—</span>}
                      </td>
                    )}
                    {visibleCols.has('type') && (
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border ${TYPE_COLORS[interaction.type] || 'bg-slate-100 text-slate-700'}`}>
                          <Icon className="w-3 h-3" />
                          {interaction.type}
                        </span>
                      </td>
                    )}
                    {visibleCols.has('date') && (
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-xs text-slate-600">
                          <Clock className="w-3 h-3 text-slate-400" />
                          {fmtDateTime(interaction.date_heure)}
                        </div>
                      </td>
                    )}
                    {visibleCols.has('duree') && (
                      <td className="px-3 py-3 whitespace-nowrap text-xs text-slate-600">
                        {interaction.duree > 0 ? `${interaction.duree} min` : <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    {visibleCols.has('resultat') && (
                      <td className="px-3 py-3 whitespace-nowrap">
                        {interaction.resultat ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${RESULT_COLORS[interaction.resultat] || 'bg-slate-100 text-slate-600'}`}>
                            {interaction.resultat}
                          </span>
                        ) : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                    )}
                    {visibleCols.has('notes') && (
                      <td className="px-3 py-3 max-w-xs">
                        {interaction.notes
                          ? <p className="text-xs text-slate-600 truncate max-w-48" title={interaction.notes}>{interaction.notes}</p>
                          : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                    )}
                    {visibleCols.has('auteur') && (
                      <td className="px-3 py-3 whitespace-nowrap text-xs text-slate-600">
                        <span className="flex items-center gap-1.5" title={author?.email || undefined}>
                          <UserRound className="h-3.5 w-3.5 text-slate-400" />
                          {author?.full_name || author?.email || 'Utilisateur inconnu'}
                        </span>
                        <span className="mt-0.5 block pl-5 text-[10px] text-slate-400" title={responsible?.email || undefined}>
                          Responsable : {responsible?.full_name || responsible?.email || 'Non attribué'}
                        </span>
                      </td>
                    )}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="flex justify-end items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {/* Quick email send */}
                        {contact && (contact as Contact).email && emailTemplates.length > 0 && (
                          <div className="relative">
                            <button
                              onClick={() => setShowQuickEmail(showQuickEmail === interaction.id ? null : interaction.id)}
                              className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Envoyer un email"
                            >
                              <Send className="w-3.5 h-3.5" />
                            </button>
                            {showQuickEmail === interaction.id && (
                              <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                                <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
                                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Envoyer un email depuis template</p>
                                </div>
                                <div className="max-h-40 overflow-y-auto">
                                  {emailTemplates.map(t => (
                                    <button
                                      key={t.id}
                                      onClick={() => handleQuickSendEmail(contact as Contact, t)}
                                      disabled={sendingEmailId === t.id}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-blue-50 transition-colors text-xs disabled:opacity-50"
                                    >
                                      <FileText className="w-3 h-3 text-blue-500 flex-shrink-0" />
                                      <span className="text-slate-700 truncate">{t.titre}</span>
                                      {sendingEmailId === t.id && <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin ml-auto" />}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {emailSentFeedback && emailSentFeedback.id === (contact as Contact)?.id && (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${emailSentFeedback.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                            {emailSentFeedback.msg}
                          </span>
                        )}
                        {canModify && <button onClick={() => handleEdit(interaction)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors" title="Modifier">
                          <CreditCard className="w-3.5 h-3.5" />
                        </button>}
                        {canDelete && <button onClick={() => handleDelete(interaction.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Supprimer">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-16 text-slate-400">
              <MessageCircle className="w-10 h-10 mx-auto mb-3 text-slate-200" />
              <p className="font-medium">Aucune interaction trouvée</p>
            </div>
          )}
        </div>
      </div>

      {/* Contact side panel */}
      {sidePanelContact && (
        <ContactSidePanel
          contact={sidePanelContact}
          onClose={() => setSidePanelContact(null)}
          onOpenFull={() => {
            if (onOpenContact) onOpenContact(sidePanelContact.id);
            setSidePanelContact(null);
          }}
        />
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex justify-between items-center rounded-t-2xl">
              <h2 className="text-xl font-bold text-slate-900">{editingId ? 'Modifier l\'interaction' : 'Nouvelle interaction'}</h2>
              <button onClick={() => { setShowModal(false); resetForm(); }} className="p-2 hover:bg-slate-100 rounded-xl transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Contact *</label>
                <ContactSearchSelect contacts={contacts} value={formData.contact_id} onChange={id => setFormData({ ...formData, contact_id: id })} required />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">Type *</label>
                <div className="grid grid-cols-3 gap-2">
                  {TYPES.map(type => {
                    const Icon = getTypeIcon(type);
                    return (
                      <button key={type} type="button" onClick={() => setFormData({ ...formData, type })}
                        className={`flex flex-col items-center gap-1.5 py-3 rounded-xl text-xs font-semibold transition-colors border ${formData.type === type ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}`}
                      >
                        <Icon className="w-4 h-4" />{type}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Date et heure * <span className="normal-case font-normal text-slate-400">({timezone})</span></label>
                  <input type="datetime-local" required value={formData.date_heure} onChange={e => setFormData({ ...formData, date_heure: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                {formData.type === 'Appel' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Durée (min)</label>
                    <input type="number" min="0" value={formData.duree} onChange={e => setFormData({ ...formData, duree: parseInt(e.target.value) || 0 })} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Résultat</label>
                <select value={formData.resultat} onChange={e => setFormData({ ...formData, resultat: e.target.value as Interaction['resultat'] })} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                  <option value="">— Sélectionner —</option>
                  {RESULTATS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Notes</label>
                <textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} rows={3} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" placeholder="Détails de l'interaction..." />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => { setShowModal(false); resetForm(); }} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium transition-colors">Annuler</button>
                <button type="submit" className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-medium transition-colors shadow-sm">{editingId ? 'Enregistrer' : 'Créer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
