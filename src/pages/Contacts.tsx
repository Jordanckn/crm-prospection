import { useEffect, useState, useRef } from 'react';
import {
  Plus, Search, X, CreditCard as Edit, Trash2, Phone, Mail, Tag,
  Clock, MapPin, Briefcase, Instagram, Facebook, Linkedin, Twitter,
  ChevronLeft, ChevronRight, List, Map, ChevronUp, ChevronDown as ChevronDownIcon,
  Settings2, Eye, EyeOff, Globe, FileText, Hash, Smartphone, Monitor, RefreshCw,
  Upload, PanelRight, PhoneCall, UserRound,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Contact } from '../types/database';
import ContactMap from '../components/ContactMap';
import CsvImport from '../components/CsvImport';
import ContactSidePanel from '../components/ContactSidePanel';
import SirenEnrichButton from '../components/SirenEnrichButton';
import type { SirenResult } from '../lib/siren';
import { usePermissions } from '../contexts/PermissionsContext';

const STATUTS = ['Nouveau', 'En cours', 'Converti', 'Perdu'] as const;
const TAGS_DISPONIBLES = ['Client', 'Prospect', 'Partenaire', 'VIP', 'Prioritaire', 'À relancer'];
const PAYS = ['France', 'Israël'] as const;
const SECTEUR_GROUPS: { label: string; secteurs: string[] }[] = [
  {
    label: 'Bâtiment',
    secteurs: [
      'Carreleur', 'Charpentier', 'Chauffagiste', 'Climaticien', 'Constructeur maison individuelle',
      'Couvreur', 'Couvreur zingueur', 'Cuisiniste indépendant', 'Domoticien', 'Élagueur',
      'Électricien', 'Entreprise de rénovation générale', 'Étancheur', 'Façadier',
      'Installateur pompe à chaleur', 'Installateur portail & clôture', 'Isolation maison/combles',
      'Maçon', 'Menuisier extérieur', 'Paysagiste', 'Peintre en bâtiment', 'Pisciniste',
      'Plaquiste', 'Plombier', 'Poseur de fenêtres', 'Rénovation salle de bain', 'Serrurier',
      'Solier / Poseur de sol', 'Terrassier', 'Vérandaliste',
    ],
  },
  {
    label: 'Autres secteurs',
    secteurs: [
      'Agriculture', 'Alimentation & Restauration', 'Automobile', 'Autre', 'Banque & Finance',
      'Commerce & Distribution', 'Conseil & Services', 'Courtier en énergie', 'Droit & Juridique',
      'Éducation & Formation', 'Énergie', 'High-Tech & Informatique', 'Hôtellerie & Tourisme',
      'Immobilier', 'Industrie & Manufacturing', 'Logistique & Transport', 'Médias & Communication',
      'Santé & Pharmacie', 'Télécommunications', 'Textile & Mode',
    ],
  },
];

function findSecteurGroupe(secteur: string): string {
  return SECTEUR_GROUPS.find(g => g.secteurs.includes(secteur))?.label || SECTEUR_GROUPS[0].label;
}

const PAGE_SIZE = 15;

type SortKey = 'nom' | 'prenom' | 'entreprise' | 'statut' | 'pays' | 'secteur_activite' | 'derniere_interaction' | 'created_at';
type SortDir = 'asc' | 'desc';

type ColumnDef = {
  key: string;
  label: string;
  defaultVisible: boolean;
};

const ALL_COLUMNS: ColumnDef[] = [
  { key: 'contact', label: 'Entreprise', defaultVisible: true },
  { key: 'statut', label: 'Statut', defaultVisible: true },
  { key: 'pays', label: 'Pays', defaultVisible: true },
  { key: 'entreprise', label: 'Nom du contact', defaultVisible: true },
  { key: 'secteur', label: 'Secteur', defaultVisible: true },
  { key: 'coordonnees', label: 'Coordonnées', defaultVisible: true },
  { key: 'reseaux', label: 'Réseaux sociaux', defaultVisible: false },
  { key: 'adresse', label: 'Adresse', defaultVisible: false },
  { key: 'site_web', label: 'Site web', defaultVisible: false },
  { key: 'siren_siret', label: 'SIREN/SIRET', defaultVisible: false },
  { key: 'pagespeed', label: 'PageSpeed', defaultVisible: false },
  { key: 'tags', label: 'Tags', defaultVisible: true },
  { key: 'derniere_interaction', label: 'Dernière interaction', defaultVisible: true },
  { key: 'created_at', label: 'Ajouté le', defaultVisible: false },
  { key: 'documents', label: 'Documents', defaultVisible: false },
];

const emptyForm = {
  prenom: '', nom: '', email: '', telephone: '', entreprise: '',
  adresse: '', ville: '', code_postal: '',
  tags: [] as string[],
  statut: 'Nouveau' as Contact['statut'],
  pays: 'France' as Contact['pays'],
  secteur_activite: '', instagram: '', facebook: '', linkedin: '', twitter: '',
  siren_siret: '', notes_entreprise: '', site_web: '',
  pagespeed_mobile: null as number | null,
  pagespeed_desktop: null as number | null,
};

const getPersonName = (contact: Pick<Contact, 'prenom' | 'nom'>) =>
  [contact.prenom, contact.nom].filter(Boolean).join(' ').trim();

const normalizeName = (value: string) => value.trim().toLocaleLowerCase('fr-FR');

const getCompanyInitials = (company: string) => {
  const words = company.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return `${words[0][0] || ''}${words.length > 1 ? words[words.length - 1][0] || '' : ''}`.toUpperCase();
};

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <span className="ml-1 text-slate-300 opacity-60"><ChevronUp className="w-3 h-3 inline" /></span>;
  return sortDir === 'asc'
    ? <ChevronUp className="w-3 h-3 inline ml-1 text-blue-600" />
    : <ChevronDownIcon className="w-3 h-3 inline ml-1 text-blue-600" />;
}

type ContactsProps = {
  onOpenContact?: (id: string) => void;
  editTarget?: Contact | null;
  onEditTargetHandled?: () => void;
};

export default function Contacts({ onOpenContact, editTarget, onEditTargetHandled }: ContactsProps = {}) {
  const { canModify, canDelete } = usePermissions();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatut, setFilterStatut] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [filterPays, setFilterPays] = useState('');
  const [filterSecteur, setFilterSecteur] = useState('');
  const [filterContacted, setFilterContacted] = useState<'all' | 'today' | 'not_today'>('all');
  const [filterMobile, setFilterMobile] = useState(false);
  const [filterDocument, setFilterDocument] = useState<'all' | 'with' | 'without'>('all');
  const [contactsWithDocs, setContactsWithDocs] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [sidePanelContact, setSidePanelContact] = useState<Contact | null>(null);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeTab, setActiveTab] = useState<'list' | 'map'>('list');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [visibleCols, setVisibleCols] = useState<Set<string>>(
    new Set(ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key))
  );
  const [showColPanel, setShowColPanel] = useState(false);
  const colPanelRef = useRef<HTMLDivElement>(null);
  const [formData, setFormData] = useState({ ...emptyForm });
  const [secteurGroupe, setSecteurGroupe] = useState(SECTEUR_GROUPS[0].label);

  useEffect(() => { loadContacts(); }, []);

  useEffect(() => {
    if (editTarget && canModify) {
      handleEdit(editTarget);
      onEditTargetHandled?.();
    }
  }, [editTarget]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (colPanelRef.current && !colPanelRef.current.contains(e.target as Node)) setShowColPanel(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    let filtered = [...contacts];
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      filtered = filtered.filter(c =>
        c.prenom.toLowerCase().includes(t) || c.nom.toLowerCase().includes(t) ||
        c.email.toLowerCase().includes(t) || c.entreprise.toLowerCase().includes(t) ||
        (c.secteur_activite || '').toLowerCase().includes(t) ||
        (c.ville || '').toLowerCase().includes(t)
      );
    }
    if (filterStatut) filtered = filtered.filter(c => c.statut === filterStatut);
    if (filterTag) filtered = filtered.filter(c => c.tags.includes(filterTag));
    if (filterPays) filtered = filtered.filter(c => c.pays === filterPays);
    if (filterSecteur) filtered = filtered.filter(c => c.secteur_activite === filterSecteur);
    const todayStr = new Date().toISOString().split('T')[0];
    if (filterContacted === 'today') filtered = filtered.filter(c => c.derniere_interaction?.startsWith(todayStr));
    if (filterContacted === 'not_today') filtered = filtered.filter(c => !c.derniere_interaction?.startsWith(todayStr));
    if (filterMobile) filtered = filtered.filter(c => c.telephone && isMobileNumber(c.telephone));
    if (filterDocument === 'with') filtered = filtered.filter(c => contactsWithDocs.has(c.id));
    if (filterDocument === 'without') filtered = filtered.filter(c => !contactsWithDocs.has(c.id));

    filtered.sort((a, b) => {
      let av: string | number = '';
      let bv: string | number = '';
      if (sortKey === 'nom') { av = a.nom; bv = b.nom; }
      else if (sortKey === 'prenom') { av = a.prenom; bv = b.prenom; }
      else if (sortKey === 'entreprise') { av = a.entreprise || ''; bv = b.entreprise || ''; }
      else if (sortKey === 'statut') { av = a.statut; bv = b.statut; }
      else if (sortKey === 'pays') { av = a.pays; bv = b.pays; }
      else if (sortKey === 'secteur_activite') { av = a.secteur_activite || ''; bv = b.secteur_activite || ''; }
      else if (sortKey === 'derniere_interaction') { av = a.derniere_interaction || ''; bv = b.derniere_interaction || ''; }
      else if (sortKey === 'created_at') { av = a.created_at; bv = b.created_at; }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    setFilteredContacts(filtered);
    setCurrentPage(1);
  }, [searchTerm, filterStatut, filterTag, filterPays, filterSecteur, filterContacted, filterMobile, filterDocument, contacts, contactsWithDocs, sortKey, sortDir]);

  const isMobileNumber = (tel: string) => {
    const clean = tel.replace(/[\s.\-()]/g, '');
    return /^(\+336|\+337|06|07)/.test(clean);
  };

  const loadContacts = async () => {
    try {
      const [{ data, error }, { data: docs }] = await Promise.all([
        supabase.from('contacts').select('*').order('created_at', { ascending: false }),
        supabase.from('contact_documents').select('contact_id'),
      ]);
      if (error) throw error;
      setContacts(data || []);
      setContactsWithDocs(new Set((docs || []).map((d: { contact_id: string }) => d.contact_id)));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
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

  const resetForm = () => { setFormData({ ...emptyForm }); setEditingContact(null); setSecteurGroupe(SECTEUR_GROUPS[0].label); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = { ...formData };
      if (editingContact) {
        const oldAddr = [editingContact.adresse, editingContact.code_postal, editingContact.ville].join('');
        const newAddr = [formData.adresse, formData.code_postal, formData.ville].join('');
        if (oldAddr !== newAddr) { (payload as any).latitude = null; (payload as any).longitude = null; }
        await supabase.from('contacts').update(payload).eq('id', editingContact.id);
      } else {
        await supabase.from('contacts').insert([payload]);
      }
      setShowModal(false); resetForm(); loadContacts();
    } catch (err) { console.error(err); }
  };

  const handleEdit = (c: Contact) => {
    if (!canModify) return;
    setEditingContact(c);
    setFormData({
      prenom: c.prenom, nom: c.nom, email: c.email, telephone: c.telephone,
      entreprise: c.entreprise, adresse: c.adresse || '', ville: c.ville || '',
      code_postal: c.code_postal || '', tags: c.tags, statut: c.statut, pays: c.pays,
      secteur_activite: c.secteur_activite, instagram: c.instagram, facebook: c.facebook,
      linkedin: c.linkedin, twitter: c.twitter,
      siren_siret: c.siren_siret || '', notes_entreprise: c.notes_entreprise || '',
      site_web: c.site_web || '',
      pagespeed_mobile: c.pagespeed_mobile ?? null,
      pagespeed_desktop: c.pagespeed_desktop ?? null,
    });
    setSecteurGroupe(findSecteurGroupe(c.secteur_activite));
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer ce contact ?')) return;
    await supabase.from('contacts').delete().eq('id', id);
    loadContacts();
  };

  const [addedToCallList, setAddedToCallList] = useState<Set<string>>(new Set());

  const addToCallList = async (contactId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: existing } = await supabase
        .from('liste_appels')
        .select('id')
        .eq('user_id', user.id)
        .eq('contact_id', contactId)
        .neq('statut', 'traite')
        .maybeSingle();
      if (existing) {
        setAddedToCallList(prev => new Set(prev).add(contactId));
        return;
      }
      const { data: maxRow } = await supabase
        .from('liste_appels')
        .select('ordre')
        .eq('user_id', user.id)
        .order('ordre', { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextOrdre = (maxRow?.ordre ?? -1) + 1;
      await supabase.from('liste_appels').insert([{
        user_id: user.id,
        contact_id: contactId,
        ordre: nextOrdre,
        notes_prep: '',
        statut: 'en_attente',
      }]);
      setAddedToCallList(prev => new Set(prev).add(contactId));
      setTimeout(() => setAddedToCallList(prev => { const n = new Set(prev); n.delete(contactId); return n; }), 2000);
    } catch (err) { console.error(err); }
  };

  const toggleTag = (tag: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags.filter(t => t !== tag) : [...prev.tags, tag],
    }));
  };

  const getStatutColor = (s: string) => ({
    'Nouveau': 'bg-blue-50 text-blue-700 border-blue-200',
    'En cours': 'bg-amber-50 text-amber-700 border-amber-200',
    'Converti': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'Perdu': 'bg-red-50 text-red-700 border-red-200',
  }[s] || 'bg-slate-100 text-slate-700');

  const getPaysFlag = (p: string) => ({ 'France': '🇫🇷', 'Israël': '🇮🇱' }[p] || '');
  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('fr-FR') : '—';

  const totalPages = Math.max(1, Math.ceil(filteredContacts.length / PAGE_SIZE));
  const paginated = filteredContacts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const hasFilters = searchTerm || filterStatut || filterTag || filterPays || filterSecteur || filterContacted !== 'all' || filterMobile || filterDocument !== 'all';
  const todayStr = new Date().toISOString().split('T')[0];
  const contactedTodayIds = new Set(contacts.filter(c => c.derniere_interaction?.startsWith(todayStr)).map(c => c.id));

  const SortTh = ({ col, label }: { col: SortKey; label: string }) => (
    <th
      className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
      onClick={() => handleSort(col)}
    >
      {label}<SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
    </th>
  );

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Contacts</h1>
          <p className="text-sm text-slate-500 mt-0.5">{filteredContacts.length} contact(s) — 🇫🇷 {contacts.filter(c => c.pays === 'France').length} | 🇮🇱 {contacts.filter(c => c.pays === 'Israël').length}</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors text-sm font-semibold shadow-sm shadow-blue-500/30"
        >
          <Plus className="w-4 h-4" />
          Nouveau contact
        </button>
        <button
          onClick={() => setShowCsvImport(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors text-sm font-semibold shadow-sm shadow-emerald-500/20"
        >
          <Upload className="w-4 h-4" />
          Importer CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <select value={filterPays} onChange={e => setFilterPays(e.target.value)} className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white">
            <option value="">Tous les pays</option>
            {PAYS.map(p => <option key={p} value={p}>{getPaysFlag(p)} {p}</option>)}
          </select>
          <select value={filterStatut} onChange={e => setFilterStatut(e.target.value)} className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white">
            <option value="">Tous les statuts</option>
            {STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterSecteur} onChange={e => setFilterSecteur(e.target.value)} className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white">
            <option value="">Tous les secteurs</option>
            {SECTEUR_GROUPS.map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.secteurs.map(s => <option key={s} value={s}>{s}</option>)}
              </optgroup>
            ))}
          </select>
          <select value={filterTag} onChange={e => setFilterTag(e.target.value)} className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white">
            <option value="">Tous les tags</option>
            {TAGS_DISPONIBLES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFilterContacted('all')}
              className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${filterContacted === 'all' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >Tous</button>
            <button
              onClick={() => setFilterContacted(filterContacted === 'today' ? 'all' : 'today')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${filterContacted === 'today' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
              Contactés auj.
            </button>
            <button
              onClick={() => setFilterContacted(filterContacted === 'not_today' ? 'all' : 'not_today')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${filterContacted === 'not_today' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              <span className="w-2 h-2 rounded-full bg-slate-400 flex-shrink-0" />
              Non contactés
            </button>
          </div>
          <button
            onClick={() => setFilterMobile(o => !o)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${filterMobile ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            <Phone className="w-3.5 h-3.5" />
            Portable
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFilterDocument(filterDocument === 'with' ? 'all' : 'with')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${filterDocument === 'with' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              <FileText className="w-3.5 h-3.5" />
              Avec doc
            </button>
            <button
              onClick={() => setFilterDocument(filterDocument === 'without' ? 'all' : 'without')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${filterDocument === 'without' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              Sans doc
            </button>
          </div>
          {hasFilters && (
            <button onClick={() => { setSearchTerm(''); setFilterStatut(''); setFilterTag(''); setFilterPays(''); setFilterSecteur(''); setFilterContacted('all'); setFilterMobile(false); setFilterDocument('all'); }} className="text-xs text-slate-500 hover:text-red-600 flex items-center gap-1 px-2 py-2">
              <X className="w-3.5 h-3.5" />Réinitialiser
            </button>
          )}
        </div>
      </div>

      {/* Tab + Column toggle */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
          {(['list', 'map'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === tab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {tab === 'list' ? <><List className="w-3.5 h-3.5" />Liste</> : <><Map className="w-3.5 h-3.5" />Carte</>}
            </button>
          ))}
        </div>
        {activeTab === 'list' && (
          <div className="relative" ref={colPanelRef}>
            <button
              onClick={() => setShowColPanel(o => !o)}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-slate-200 rounded-xl bg-white hover:bg-slate-50 transition-colors shadow-sm"
            >
              <Settings2 className="w-4 h-4 text-slate-500" />
              Colonnes
              <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-bold">{visibleCols.size}</span>
            </button>
            {showColPanel && (
              <div className="absolute right-0 top-full mt-2 w-52 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-100">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Colonnes visibles</p>
                </div>
                {ALL_COLUMNS.map(col => (
                  <button
                    key={col.key}
                    onClick={() => toggleCol(col.key)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <span>{col.label}</span>
                    {visibleCols.has(col.key)
                      ? <Eye className="w-4 h-4 text-blue-600" />
                      : <EyeOff className="w-4 h-4 text-slate-300" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {activeTab === 'list' && (
        <>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {visibleCols.has('contact') && <SortTh col="entreprise" label="Entreprise" />}
                    {visibleCols.has('statut') && <SortTh col="statut" label="Statut" />}
                    {visibleCols.has('pays') && <SortTh col="pays" label="Pays" />}
                    {visibleCols.has('entreprise') && <SortTh col="nom" label="Nom du contact" />}
                    {visibleCols.has('secteur') && <SortTh col="secteur_activite" label="Secteur" />}
                    {visibleCols.has('coordonnees') && <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap">Coordonnées</th>}
                    {visibleCols.has('reseaux') && <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap">Réseaux</th>}
                    {visibleCols.has('adresse') && <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap">Adresse</th>}
                    {visibleCols.has('site_web') && <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap">Site web</th>}
                    {visibleCols.has('siren_siret') && <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap">SIREN/SIRET</th>}
                    {visibleCols.has('pagespeed') && <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap">PageSpeed</th>}
                    {visibleCols.has('tags') && <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap">Tags</th>}
                    {visibleCols.has('derniere_interaction') && <SortTh col="derniere_interaction" label="Dernière interaction" />}
                    {visibleCols.has('created_at') && <SortTh col="created_at" label="Ajouté le" />}
                    {visibleCols.has('documents') && <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap">Documents</th>}
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginated.map(c => (
                    <tr key={c.id} onClick={() => setSidePanelContact(c)} className="hover:bg-slate-50 transition-colors group cursor-pointer">
                      {visibleCols.has('contact') && (
                        <td className="px-3 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2.5">
                            <div className="relative flex-shrink-0">
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-xs font-bold">
                                {getCompanyInitials(c.entreprise || getPersonName(c))}
                              </div>
                              {contactedTodayIds.has(c.id) && (
                                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full" title="Contacté aujourd'hui" />
                              )}
                            </div>
                            <div>
                              <p className="font-semibold text-slate-900">{c.entreprise || getPersonName(c) || 'Entreprise non renseignée'}</p>
                            </div>
                          </div>
                        </td>
                      )}
                      {visibleCols.has('statut') && (
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${getStatutColor(c.statut)}`}>{c.statut}</span>
                        </td>
                      )}
                      {visibleCols.has('pays') && (
                        <td className="px-3 py-3 whitespace-nowrap text-sm text-slate-600">
                          {getPaysFlag(c.pays)} {c.pays}
                        </td>
                      )}
                      {visibleCols.has('entreprise') && (
                        <td className="px-3 py-3 whitespace-nowrap">
                          {getPersonName(c) && normalizeName(getPersonName(c)) !== normalizeName(c.entreprise || '') ? (
                            <div className="flex items-center gap-1.5 text-sm text-slate-700">
                              <UserRound className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                              <span className="truncate max-w-32">{getPersonName(c)}</span>
                            </div>
                          ) : <span className="text-slate-300 text-xs">—</span>}
                        </td>
                      )}
                      {visibleCols.has('secteur') && (
                        <td className="px-3 py-3 whitespace-nowrap">
                          {c.secteur_activite && (
                            <div className="flex items-center gap-1.5 text-sm text-slate-600">
                              <Briefcase className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                              <span className="truncate max-w-36">{c.secteur_activite}</span>
                            </div>
                          )}
                        </td>
                      )}
                      {visibleCols.has('coordonnees') && (
                        <td className="px-3 py-3">
                          <div className="space-y-0.5">
                            {c.email && <div className="flex items-center gap-1 text-xs text-slate-600"><Mail className="w-3 h-3 text-slate-400" /><span className="truncate max-w-36">{c.email}</span></div>}
                            {c.telephone && <div className="flex items-center gap-1 text-xs text-slate-600"><Phone className="w-3 h-3 text-slate-400" />{c.telephone}</div>}
                          </div>
                        </td>
                      )}
                      {visibleCols.has('reseaux') && (
                        <td className="px-3 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            {c.instagram && <a href={`https://instagram.com/${c.instagram}`} target="_blank" rel="noopener noreferrer" className="text-pink-500 hover:text-pink-700"><Instagram className="w-3.5 h-3.5" /></a>}
                            {c.facebook && <a href={`https://facebook.com/${c.facebook}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800"><Facebook className="w-3.5 h-3.5" /></a>}
                            {c.linkedin && <a href={`https://linkedin.com/in/${c.linkedin}`} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:text-blue-900"><Linkedin className="w-3.5 h-3.5" /></a>}
                            {c.twitter && <a href={`https://twitter.com/${c.twitter}`} target="_blank" rel="noopener noreferrer" className="text-sky-500 hover:text-sky-700"><Twitter className="w-3.5 h-3.5" /></a>}
                            {!c.instagram && !c.facebook && !c.linkedin && !c.twitter && <span className="text-slate-300 text-xs">—</span>}
                          </div>
                        </td>
                      )}
                      {visibleCols.has('adresse') && (
                        <td className="px-3 py-3">
                          {(c.adresse || c.ville) ? (
                            <div className="flex items-start gap-1 text-xs text-slate-600">
                              <MapPin className="w-3 h-3 text-slate-400 mt-0.5 flex-shrink-0" />
                              <div>
                                {c.adresse && <div className="truncate max-w-32">{c.adresse}</div>}
                                {(c.code_postal || c.ville) && <div>{[c.code_postal, c.ville].filter(Boolean).join(' ')}</div>}
                              </div>
                            </div>
                          ) : <span className="text-slate-300 text-xs">—</span>}
                        </td>
                      )}
                      {visibleCols.has('site_web') && (
                        <td className="px-3 py-3 whitespace-nowrap">
                          {c.site_web ? (
                            <a href={c.site_web.startsWith('http') ? c.site_web : `https://${c.site_web}`} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 max-w-36 truncate">
                              <Globe className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate">{c.site_web.replace(/^https?:\/\//, '')}</span>
                            </a>
                          ) : <span className="text-slate-300 text-xs">—</span>}
                        </td>
                      )}
                      {visibleCols.has('siren_siret') && (
                        <td className="px-3 py-3 whitespace-nowrap">
                          {c.siren_siret ? (
                            <div className="flex items-center gap-1 text-xs text-slate-600">
                              <Hash className="w-3 h-3 text-slate-400 flex-shrink-0" />
                              <span className="font-mono">{c.siren_siret}</span>
                            </div>
                          ) : <span className="text-slate-300 text-xs">—</span>}
                        </td>
                      )}
                      {visibleCols.has('pagespeed') && (
                        <td className="px-3 py-3 whitespace-nowrap">
                          {(c.pagespeed_mobile !== null || c.pagespeed_desktop !== null) ? (
                            <div className="flex items-center gap-2">
                              {c.pagespeed_mobile !== null && (
                                <div className="flex items-center gap-1" title="Mobile">
                                  <Smartphone className="w-3 h-3 text-slate-400" />
                                  <PageSpeedBadge score={c.pagespeed_mobile} />
                                </div>
                              )}
                              {c.pagespeed_desktop !== null && (
                                <div className="flex items-center gap-1" title="Desktop">
                                  <Monitor className="w-3 h-3 text-slate-400" />
                                  <PageSpeedBadge score={c.pagespeed_desktop} />
                                </div>
                              )}
                            </div>
                          ) : <span className="text-slate-300 text-xs">—</span>}
                        </td>
                      )}
                      {visibleCols.has('tags') && (
                        <td className="px-3 py-3 whitespace-nowrap">
                          <div className="flex gap-1">
                            {c.tags.slice(0, 2).map((t, i) => (
                              <span key={i} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">{t}</span>
                            ))}
                            {c.tags.length > 2 && <span className="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-xs">+{c.tags.length - 2}</span>}
                          </div>
                        </td>
                      )}
                      {visibleCols.has('derniere_interaction') && (
                        <td className="px-3 py-3 whitespace-nowrap text-xs text-slate-500">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {fmtDate(c.derniere_interaction)}
                          </div>
                        </td>
                      )}
                      {visibleCols.has('created_at') && (
                        <td className="px-3 py-3 whitespace-nowrap text-xs text-slate-500">{fmtDate(c.created_at)}</td>
                      )}
                      {visibleCols.has('documents') && (
                        <td className="px-3 py-3 whitespace-nowrap">
                          {contactsWithDocs.has(c.id) ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-xs font-semibold">
                              <FileText className="w-3 h-3" /> Oui
                            </span>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
                      )}
                      <td className="px-3 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {onOpenContact && (
                            <button onClick={() => onOpenContact(c.id)} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors" title="Ouvrir la fiche"><PanelRight className="w-3.5 h-3.5" /></button>
                          )}
                          <button
                            onClick={() => addToCallList(c.id)}
                            className={`p-1.5 rounded-lg transition-colors ${addedToCallList.has(c.id) ? 'text-emerald-600 bg-emerald-50' : 'text-amber-600 hover:bg-amber-50'}`}
                            title={addedToCallList.has(c.id) ? 'Ajoute !' : 'Ajouter aux appels'}
                          >
                            <PhoneCall className="w-3.5 h-3.5" />
                          </button>
                          {canModify && <button onClick={() => handleEdit(c)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><Edit className="w-3.5 h-3.5" /></button>}
                          {canDelete && <button onClick={() => handleDelete(c.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredContacts.length === 0 && (
                <div className="text-center py-16 text-slate-400">
                  <Tag className="w-10 h-10 mx-auto mb-3 text-slate-200" />
                  <p className="font-medium">Aucun contact trouvé</p>
                </div>
              )}
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">
                {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredContacts.length)} sur {filteredContacts.length}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
                  <ChevronLeft className="w-4 h-4 text-slate-600" />
                </button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  const page = totalPages <= 7 ? i + 1 : currentPage <= 4 ? i + 1 : currentPage >= totalPages - 3 ? totalPages - 6 + i : currentPage - 3 + i;
                  return (
                    <button key={page} onClick={() => setCurrentPage(page)}
                      className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${page === currentPage ? 'bg-blue-600 text-white' : 'border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                    >{page}</button>
                  );
                })}
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
                  <ChevronRight className="w-4 h-4 text-slate-600" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'map' && <ContactMap contacts={contacts} onContactsUpdated={loadContacts} />}

      {showCsvImport && (
        <CsvImport
          onClose={() => setShowCsvImport(false)}
          onImported={() => { void loadContacts(); }}
        />
      )}

      {sidePanelContact && (
        <ContactSidePanel
          contact={sidePanelContact}
          onClose={() => setSidePanelContact(null)}
          onOpenFull={() => { onOpenContact?.(sidePanelContact.id); setSidePanelContact(null); }}
        />
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex justify-between items-center rounded-t-2xl">
              <h2 className="text-xl font-bold text-slate-900">{editingContact ? 'Modifier le contact' : 'Nouveau contact'}</h2>
              <button onClick={() => { setShowModal(false); resetForm(); }} className="p-2 hover:bg-slate-100 rounded-xl transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Entreprise *</label>
                <input required type="text" value={formData.entreprise} onChange={e => setFormData({ ...formData, entreprise: e.target.value })} placeholder="Nom de l’entreprise" className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Prénom du contact</label>
                  <input type="text" value={formData.prenom} onChange={e => setFormData({ ...formData, prenom: e.target.value })} placeholder="Optionnel" className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Nom du contact</label>
                  <input type="text" value={formData.nom} onChange={e => setFormData({ ...formData, nom: e.target.value })} placeholder="Optionnel" className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Pays *</label>
                  <select value={formData.pays} onChange={e => setFormData({ ...formData, pays: e.target.value as Contact['pays'] })} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    {PAYS.map(p => <option key={p} value={p}>{getPaysFlag(p)} {p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Secteur</label>
                  <div className="space-y-1.5">
                    <select
                      value={secteurGroupe}
                      onChange={e => {
                        const groupe = e.target.value;
                        setSecteurGroupe(groupe);
                        const secteurs = SECTEUR_GROUPS.find(g => g.label === groupe)?.secteurs || [];
                        setFormData(prev => ({ ...prev, secteur_activite: secteurs.includes(prev.secteur_activite) ? prev.secteur_activite : '' }));
                      }}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                    >
                      {SECTEUR_GROUPS.map(g => <option key={g.label} value={g.label}>{g.label}</option>)}
                    </select>
                    <select
                      value={formData.secteur_activite}
                      onChange={e => setFormData({ ...formData, secteur_activite: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                    >
                      <option value="">— Choisir —</option>
                      {(SECTEUR_GROUPS.find(g => g.label === secteurGroupe)?.secteurs || []).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Email</label>
                  <input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Téléphone</label>
                  <input type="tel" value={formData.telephone} onChange={e => setFormData({ ...formData, telephone: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Adresse</label>
                <div className="space-y-2">
                  <input type="text" placeholder="Rue, numéro..." value={formData.adresse} onChange={e => setFormData({ ...formData, adresse: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" placeholder="Code postal" value={formData.code_postal} onChange={e => setFormData({ ...formData, code_postal: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    <input type="text" placeholder="Ville" value={formData.ville} onChange={e => setFormData({ ...formData, ville: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">Réseaux sociaux</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'instagram', icon: Instagram, color: 'text-pink-600', label: 'Instagram' },
                    { key: 'facebook', icon: Facebook, color: 'text-blue-600', label: 'Facebook' },
                    { key: 'linkedin', icon: Linkedin, color: 'text-blue-700', label: 'LinkedIn' },
                    { key: 'twitter', icon: Twitter, color: 'text-sky-500', label: 'Twitter' },
                  ].map(({ key, icon: Icon, color, label }) => (
                    <div key={key} className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2">
                      <Icon className={`w-4 h-4 ${color} flex-shrink-0`} />
                      <input
                        type="text"
                        value={(formData as any)[key]}
                        onChange={e => setFormData({ ...formData, [key]: e.target.value })}
                        placeholder={label}
                        className="flex-1 text-sm outline-none bg-transparent"
                      />
                    </div>
                  ))}
                </div>
              </div>
              {/* Entreprise details */}
              <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Informations entreprise</p>
                  <SirenEnrichButton
                    sirenSiret={formData.siren_siret}
                    entreprise={formData.entreprise}
                    onApply={(r: SirenResult) => {
                      if (r.secteur_suggestion) setSecteurGroupe(findSecteurGroupe(r.secteur_suggestion));
                      setFormData(prev => ({
                        ...prev,
                        entreprise: r.entreprise || prev.entreprise,
                        siren_siret: r.siret || prev.siren_siret,
                        adresse: r.adresse || prev.adresse,
                        code_postal: r.code_postal || prev.code_postal,
                        ville: r.ville || prev.ville,
                        secteur_activite: r.secteur_suggestion || prev.secteur_activite,
                      }));
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">SIREN / SIRET</label>
                    <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 bg-white">
                      <Hash className="w-4 h-4 text-slate-400 flex-shrink-0" />
                      <input
                        type="text"
                        value={formData.siren_siret}
                        onChange={e => setFormData({ ...formData, siren_siret: e.target.value })}
                        placeholder="123456789 ou 12345678900012"
                        className="flex-1 text-sm outline-none bg-transparent font-mono"
                        maxLength={14}
                      />
                    </div>
                    {formData.siren_siret && formData.siren_siret.length !== 9 && formData.siren_siret.length !== 14 && (
                      <p className="text-xs text-amber-600 mt-1">SIREN = 9 chiffres, SIRET = 14 chiffres</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Site web</label>
                    <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 bg-white">
                      <Globe className="w-4 h-4 text-slate-400 flex-shrink-0" />
                      <input
                        type="text"
                        value={formData.site_web}
                        onChange={e => setFormData({ ...formData, site_web: e.target.value })}
                        placeholder="www.exemple.fr"
                        className="flex-1 text-sm outline-none bg-transparent"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Notes entreprise</label>
                  <textarea
                    value={formData.notes_entreprise}
                    onChange={e => setFormData({ ...formData, notes_entreprise: e.target.value })}
                    rows={3}
                    placeholder="Contexte, historique, besoins identifiés, concurrents, budget estimé..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">
                    Score PageSpeed Insights
                    <span className="ml-2 text-slate-400 font-normal normal-case">0–49 lent • 50–89 moyen • 90+ rapide</span>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 bg-white">
                      <Smartphone className="w-4 h-4 text-slate-400 flex-shrink-0" />
                      <span className="text-xs text-slate-500 flex-shrink-0">Mobile</span>
                      <input
                        type="number"
                        min={0} max={100}
                        value={formData.pagespeed_mobile ?? ''}
                        onChange={e => setFormData({ ...formData, pagespeed_mobile: e.target.value ? Number(e.target.value) : null })}
                        placeholder="—"
                        className="flex-1 text-sm outline-none bg-transparent text-center font-bold w-12"
                      />
                      {formData.pagespeed_mobile !== null && (
                        <PageSpeedBadge score={formData.pagespeed_mobile} />
                      )}
                    </div>
                    <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 bg-white">
                      <Monitor className="w-4 h-4 text-slate-400 flex-shrink-0" />
                      <span className="text-xs text-slate-500 flex-shrink-0">Desktop</span>
                      <input
                        type="number"
                        min={0} max={100}
                        value={formData.pagespeed_desktop ?? ''}
                        onChange={e => setFormData({ ...formData, pagespeed_desktop: e.target.value ? Number(e.target.value) : null })}
                        placeholder="—"
                        className="flex-1 text-sm outline-none bg-transparent text-center font-bold w-12"
                      />
                      {formData.pagespeed_desktop !== null && (
                        <PageSpeedBadge score={formData.pagespeed_desktop} />
                      )}
                    </div>
                  </div>
                  {formData.site_web && (
                    <a
                      href={`https://pagespeed.web.dev/analysis?url=${encodeURIComponent(formData.site_web.startsWith('http') ? formData.site_web : 'https://' + formData.site_web)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 mt-2 text-xs text-blue-600 hover:text-blue-800"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Tester sur PageSpeed Insights
                    </a>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Statut</label>
                  <select value={formData.statut} onChange={e => setFormData({ ...formData, statut: e.target.value as Contact['statut'] })} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    {STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">Tags</label>
                <div className="flex flex-wrap gap-2">
                  {TAGS_DISPONIBLES.map(tag => (
                    <button key={tag} type="button" onClick={() => toggleTag(tag)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${formData.tags.includes(tag) ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                    >{tag}</button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowModal(false); resetForm(); }} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium transition-colors">Annuler</button>
                <button type="submit" className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-medium transition-colors shadow-sm">{editingContact ? 'Mettre à jour' : 'Créer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function PageSpeedBadge({ score }: { score: number }) {
  const color = score >= 90 ? 'bg-emerald-100 text-emerald-700' : score >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${color}`}>{score}</span>;
}
