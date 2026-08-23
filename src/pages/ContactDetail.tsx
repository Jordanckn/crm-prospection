import { useEffect, useState, useRef } from 'react';
import { ArrowLeft, Phone, Mail, MailX, Building2, MapPin, Globe, Instagram, Facebook, Linkedin, Twitter, Clock, Trash2, CheckSquare, FileText, Upload, Download, ExternalLink, X, CreditCard as Edit3, Check, MessageCircle, Calendar, AlertTriangle, Eye, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Contact, Interaction, Tache, ContactDocument } from '../types/database';
import { usePermissions } from '../contexts/PermissionsContext';
import QuickInteractionModal from '../components/QuickInteractionModal';
import ContactAddressMap from '../components/ContactAddressMap';
import SirenEnrichButton from '../components/SirenEnrichButton';
import AiEnrichModal from '../components/AiEnrichModal';
import PageSpeedPanel from '../components/PageSpeedPanel';
import type { SirenResult } from '../lib/siren';
import { useBrand } from '../contexts/BrandContext';

const STATUT_COLORS: Record<string, string> = {
  'Nouveau': 'bg-slate-100 text-slate-700 border-slate-300',
  'En cours': 'bg-blue-100 text-blue-700 border-blue-300',
  'Converti': 'bg-emerald-100 text-emerald-700 border-emerald-300',
  'Perdu': 'bg-red-100 text-red-700 border-red-300',
};

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
  'Pas de réponse': 'bg-slate-100 text-slate-500',
  'Non intéressé': 'bg-red-50 text-red-700',
  'Relance': 'bg-amber-50 text-amber-700',
};

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

type Props = { contactId: string; onBack: () => void; onEdit: (c: Contact) => void };

export default function ContactDetail({ contactId, onBack, onEdit }: Props) {
  const { canModify, canDelete } = usePermissions();
  const { brand } = useBrand();
  const [contact, setContact] = useState<Contact | null>(null);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [taches, setTaches] = useState<Tache[]>([]);
  const [documents, setDocuments] = useState<ContactDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'apercu' | 'interactions' | 'taches' | 'documents'>('apercu');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfName, setPdfName] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [draggingPdf, setDraggingPdf] = useState(false);
  const [showQuickModal, setShowQuickModal] = useState(false);
  const [showAiEnrich, setShowAiEnrich] = useState(false);
  const [editingInteraction, setEditingInteraction] = useState<Interaction | null>(null);
  const [editingTache, setEditingTache] = useState<Tache | null>(null);
  const [iForm, setIForm] = useState({ type: 'Appel' as Interaction['type'], date_heure: '', duree: 0, resultat: '' as Interaction['resultat'], notes: '' });
  const [tForm, setTForm] = useState({ titre: '', description: '', date_echeance: '', statut: 'En attente' as Tache['statut'] });

  useEffect(() => {
    loadAll();
    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); };
  }, [contactId]);

  const loadAll = async () => {
    setLoading(true);
    const [{ data: c }, { data: i }, { data: t }, { data: d }] = await Promise.all([
      supabase.from('contacts').select('*').eq('id', contactId).maybeSingle(),
      supabase.from('interactions').select('*').eq('contact_id', contactId).order('date_heure', { ascending: false }),
      supabase.from('taches').select('*').eq('contact_id', contactId).order('date_echeance', { ascending: true }),
      supabase.from('contact_documents').select('*').eq('contact_id', contactId).order('created_at', { ascending: false }),
    ]);
    if (c) setContact(c);
    setInteractions(i || []);
    setTaches(t || []);
    setDocuments(d || []);
    setLoading(false);
  };

  const handleFileUpload = async (file: File) => {
    if (!file || file.type !== 'application/pdf') {
      setUploadError('Seuls les fichiers PDF sont acceptés.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setUploadError('Le fichier ne doit pas dépasser 20 Mo.');
      return;
    }
    setUploadError('');
    setUploading(true);
    const path = `${contactId}/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;

    const { error: upErr } = await supabase.storage.from('contact-documents').upload(path, file, { contentType: 'application/pdf' });
    if (upErr) { setUploadError(upErr.message); setUploading(false); return; }

    const { error: dbErr } = await supabase.from('contact_documents').insert({
      contact_id: contactId,
      nom_fichier: file.name,
      storage_path: path,
      taille_octets: file.size,
    });
    if (dbErr) { setUploadError(dbErr.message); setUploading(false); return; }

    setUploading(false);
    loadAll();
  };

  const openPdf = async (doc: ContactDocument) => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    const { data, error } = await supabase.storage.from('contact-documents').download(doc.storage_path);
    if (error || !data) return;
    const url = URL.createObjectURL(data);
    setPdfUrl(url);
    setPdfName(doc.nom_fichier);
    setActiveTab('documents');
  };

  const downloadPdf = async (doc: ContactDocument) => {
    const { data, error } = await supabase.storage.from('contact-documents').download(doc.storage_path);
    if (error || !data) return;
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.nom_fichier;
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteDocument = async (doc: ContactDocument) => {
    await supabase.storage.from('contact-documents').remove([doc.storage_path]);
    await supabase.from('contact_documents').delete().eq('id', doc.id);
    if (pdfUrl && pdfName === doc.nom_fichier) { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); setPdfName(''); }
    loadAll();
  };

  const completeTache = async (id: string) => {
    await supabase.from('taches').update({ statut: 'Terminé' }).eq('id', id);
    loadAll();
  };

  const openEditInteraction = (i: Interaction) => {
    setEditingInteraction(i);
    setIForm({ type: i.type, date_heure: new Date(i.date_heure).toISOString().slice(0, 16), duree: i.duree || 0, resultat: i.resultat || '', notes: i.notes || '' });
  };

  const saveInteraction = async () => {
    if (!editingInteraction) return;
    await supabase.from('interactions').update(iForm).eq('id', editingInteraction.id);
    setEditingInteraction(null);
    loadAll();
  };

  const deleteInteraction = async (id: string) => {
    if (!confirm('Supprimer cette interaction ?')) return;
    await supabase.from('interactions').delete().eq('id', id);
    loadAll();
  };

  const openEditTache = (t: Tache) => {
    setEditingTache(t);
    setTForm({ titre: t.titre, description: t.description || '', date_echeance: t.date_echeance ? new Date(t.date_echeance).toISOString().slice(0, 16) : '', statut: t.statut });
  };

  const saveTache = async () => {
    if (!editingTache) return;
    await supabase.from('taches').update({ ...tForm, date_echeance: tForm.date_echeance || null }).eq('id', editingTache.id);
    setEditingTache(null);
    loadAll();
  };

  const deleteTache = async (id: string) => {
    if (!confirm('Supprimer cette tâche ?')) return;
    await supabase.from('taches').delete().eq('id', id);
    loadAll();
  };

  const applySirenResult = async (r: SirenResult) => {
    await supabase.from('contacts').update({
      entreprise: r.entreprise || contact?.entreprise,
      siren_siret: r.siret || contact?.siren_siret,
      adresse: r.adresse || contact?.adresse,
      code_postal: r.code_postal || contact?.code_postal,
      ville: r.ville || contact?.ville,
      secteur_activite: r.secteur_suggestion || contact?.secteur_activite,
    }).eq('id', contactId);
    loadAll();
  };

  const toggleEmailOptOut = async () => {
    if (!contact) return;
    const optingOut = !contact.email_opted_out_at;
    if (!confirm(optingOut
      ? `Bloquer tous les futurs emails ${brand.name} vers ${contact.email} ?`
      : `Autoriser de nouveau les emails vers ${contact.email} ?`)) return;
    await supabase.from('contacts').update({
      email_opted_out_at: optingOut ? new Date().toISOString() : null,
      email_opt_out_reason: optingOut ? 'Demande reçue par email' : '',
    }).eq('id', contact.id);
    await loadAll();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertTriangle className="w-12 h-12 text-slate-300" />
        <p className="text-slate-500">Contact introuvable</p>
        <button onClick={onBack} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm">Retour</button>
      </div>
    );
  }

  const initials = `${contact.prenom?.[0] || ''}${contact.nom?.[0] || ''}`.toUpperCase();
  const tachesEnAttente = taches.filter(t => t.statut === 'En attente');

  return (
    <div className="space-y-0">
      {/* Back bar */}
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 mb-6 transition-colors group">
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        Retour aux contacts
      </button>

      {/* Hero card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm mb-6">
        {/* Banner */}
        <div className="h-28 bg-gradient-to-r from-slate-800 to-slate-700 rounded-t-2xl" />

        {/* Content below banner — avatar overlaps via negative margin on wrapper */}
        <div className="px-6 pb-6">
          {/* Avatar + actions row */}
          <div className="flex items-start justify-between -mt-10">
            <div className="w-20 h-20 rounded-2xl border-4 border-white bg-blue-600 flex items-center justify-center shadow-lg flex-shrink-0">
              <span className="text-2xl font-bold text-white">{initials || '?'}</span>
            </div>
            <div className="flex items-center gap-2 pt-12">
              <span className={`px-3 py-1 text-xs font-semibold rounded-full border ${STATUT_COLORS[contact.statut]}`}>
                {contact.statut}
              </span>
              <button
                onClick={() => setShowQuickModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-semibold hover:bg-emerald-700 transition-colors shadow-sm shadow-emerald-500/20"
              >
                <Phone className="w-3.5 h-3.5" />
                Noter interaction
              </button>
              <button
                onClick={() => setShowAiEnrich(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 text-white rounded-xl text-xs font-semibold hover:bg-slate-900 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Enrichir via IA
              </button>
              {canModify && <button
                onClick={() => onEdit(contact)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 transition-colors"
              >
                <Edit3 className="w-3.5 h-3.5" />
                Modifier
              </button>}
              {canModify && contact.email && <button
                onClick={toggleEmailOptOut}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${contact.email_opted_out_at ? 'bg-amber-100 text-amber-800 hover:bg-amber-200' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                title={contact.email_opted_out_at ? 'Réautoriser les emails' : 'Marquer comme désinscrit'}
              >
                <MailX className="h-3.5 w-3.5" />
                {contact.email_opted_out_at ? 'Désinscrit' : 'Désinscription'}
              </button>}
            </div>
          </div>

          {/* Name + company + sector */}
          <div className="mt-3">
            <h1 className="text-2xl font-bold text-slate-900 leading-tight">
              {contact.prenom} {contact.nom}
            </h1>
            {contact.entreprise && contact.entreprise !== `${contact.prenom} ${contact.nom}` && (
              <p className="text-slate-600 font-medium mt-1 flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-slate-400 flex-shrink-0" />
                {contact.entreprise}
              </p>
            )}
            {contact.secteur_activite && (
              <p className="text-sm text-slate-400 mt-0.5 ml-5">{contact.secteur_activite}</p>
            )}
          </div>

          {/* Tags */}
          {contact.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {contact.tags.map(tag => (
                <span key={tag} className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium">{tag}</span>
              ))}
            </div>
          )}

          {/* Quick stats row */}
          <div className="flex flex-wrap items-center gap-0 mt-4 pt-4 border-t border-slate-100 divide-x divide-slate-200">
            {[
              { value: interactions.length, label: 'Interactions' },
              { value: tachesEnAttente.length, label: 'Tâches actives' },
              { value: documents.length, label: 'Documents' },
              { value: fmtDate(contact.derniere_interaction), label: 'Dernière interaction', small: true },
            ].map(({ value, label, small }) => (
              <div key={label} className="px-5 first:pl-0 text-center">
                <p className={`font-bold text-slate-900 ${small ? 'text-base' : 'text-2xl'}`}>{value}</p>
                <p className="text-xs text-slate-500 mt-0.5 whitespace-nowrap">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl mb-6 w-fit">
        {([
          ['apercu', 'Aperçu', null],
          ['interactions', `Interactions (${interactions.length})`, null],
          ['taches', `Tâches (${tachesEnAttente.length})`, tachesEnAttente.length > 0],
          ['documents', `Documents (${documents.length})`, null],
        ] as [string, string, boolean | null][]).map(([key, label, badge]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as typeof activeTab)}
            className={`relative px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
            {badge && <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-500 rounded-full" />}
          </button>
        ))}
      </div>

      {/* ── TAB: APERÇU ── */}
      {activeTab === 'apercu' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Coordonnées */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Phone className="w-4 h-4 text-blue-600" /> Coordonnées
            </h3>
            <div className="space-y-3">
              {contact.telephone && (
                <a href={`tel:${contact.telephone}`} className="flex items-center gap-3 text-sm text-slate-700 hover:text-blue-700 group">
                  <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                    <Phone className="w-3.5 h-3.5 text-blue-600" />
                  </div>
                  {contact.telephone}
                </a>
              )}
              {contact.email && (
                <a href={`mailto:${contact.email}`} className="flex items-center gap-3 text-sm text-slate-700 hover:text-blue-700 group">
                  <div className="w-8 h-8 bg-violet-50 rounded-lg flex items-center justify-center group-hover:bg-violet-100 transition-colors">
                    <Mail className="w-3.5 h-3.5 text-violet-600" />
                  </div>
                  {contact.email}
                </a>
              )}
              {contact.site_web && (
                <a
                  href={contact.site_web.startsWith('http') ? contact.site_web : `https://${contact.site_web}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 text-sm text-slate-700 hover:text-blue-700 group"
                >
                  <div className="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center group-hover:bg-slate-100 transition-colors">
                    <Globe className="w-3.5 h-3.5 text-slate-600" />
                  </div>
                  <span className="truncate">{contact.site_web.replace(/^https?:\/\//, '')}</span>
                  <ExternalLink className="w-3 h-3 text-slate-300 group-hover:text-blue-500 flex-shrink-0" />
                </a>
              )}
              {(contact.adresse || contact.ville) && (
                <div className="flex items-start gap-3 text-sm text-slate-700">
                  <div className="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-600" />
                  </div>
                  <div>
                    {contact.adresse && <div>{contact.adresse}</div>}
                    {(contact.code_postal || contact.ville) && <div>{[contact.code_postal, contact.ville].filter(Boolean).join(' ')}</div>}
                    {contact.pays && <div className="text-slate-500 text-xs mt-0.5">{contact.pays}</div>}
                  </div>
                </div>
              )}
            </div>

            <ContactAddressMap contact={contact} onContactUpdated={loadAll} />
          </div>

          {/* Entreprise */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-600" /> Entreprise
              </h3>
              <SirenEnrichButton
                sirenSiret={contact.siren_siret || ''}
                entreprise={contact.entreprise || ''}
                onApply={applySirenResult}
              />
            </div>
            <div className="space-y-3">
              {contact.entreprise && (
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">Raison sociale</p>
                  <p className="font-semibold text-slate-900">{contact.entreprise}</p>
                </div>
              )}
              {contact.secteur_activite && (
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">Secteur</p>
                  <p className="text-sm text-slate-700">{contact.secteur_activite}</p>
                </div>
              )}
              {contact.siren_siret && (
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">SIREN / SIRET</p>
                  <p className="font-mono text-sm text-slate-800 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 inline-block">
                    {contact.siren_siret}
                  </p>
                </div>
              )}
              {contact.site_web && <PageSpeedPanel contact={contact} onUpdated={loadAll} />}
            </div>

            {contact.notes_entreprise && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs text-slate-500 mb-2 font-semibold uppercase tracking-wide">Notes entreprise</p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{contact.notes_entreprise}</p>
              </div>
            )}
          </div>

          {/* Réseaux sociaux */}
          {(contact.linkedin || contact.instagram || contact.facebook || contact.twitter) && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <h3 className="font-bold text-slate-900 mb-4">Réseaux sociaux</h3>
              <div className="flex flex-wrap gap-3">
                {contact.linkedin && (
                  <a href={contact.linkedin.startsWith('http') ? contact.linkedin : `https://${contact.linkedin}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-sm transition-colors">
                    <Linkedin className="w-4 h-4" /> LinkedIn
                  </a>
                )}
                {contact.instagram && (
                  <a href={contact.instagram.startsWith('http') ? contact.instagram : `https://instagram.com/${contact.instagram}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 bg-pink-50 hover:bg-pink-100 text-pink-700 rounded-xl text-sm transition-colors">
                    <Instagram className="w-4 h-4" /> Instagram
                  </a>
                )}
                {contact.facebook && (
                  <a href={contact.facebook.startsWith('http') ? contact.facebook : `https://facebook.com/${contact.facebook}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-800 rounded-xl text-sm transition-colors">
                    <Facebook className="w-4 h-4" /> Facebook
                  </a>
                )}
                {contact.twitter && (
                  <a href={contact.twitter.startsWith('http') ? contact.twitter : `https://twitter.com/${contact.twitter}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 bg-sky-50 hover:bg-sky-100 text-sky-600 rounded-xl text-sm transition-colors">
                    <Twitter className="w-4 h-4" /> Twitter
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Activité récente résumée */}
          {interactions.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-600" /> Activité récente
              </h3>
              <div className="space-y-2">
                {interactions.slice(0, 4).map(i => (
                  <div key={i.id} className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
                    <span className={`px-2 py-0.5 rounded-md text-xs font-semibold border ${TYPE_COLORS[i.type]}`}>{i.type}</span>
                    <div className="flex-1 min-w-0">
                      {i.notes && <p className="text-xs text-slate-600 truncate">{i.notes}</p>}
                      <p className="text-xs text-slate-400 mt-0.5">{fmtDateTime(i.date_heure)}</p>
                    </div>
                    {i.resultat && (
                      <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${RESULT_COLORS[i.resultat] || 'bg-slate-100 text-slate-600'}`}>
                        {i.resultat}
                      </span>
                    )}
                  </div>
                ))}
                {interactions.length > 4 && (
                  <button onClick={() => setActiveTab('interactions')} className="text-xs text-blue-600 hover:text-blue-800 ml-1">
                    Voir toutes les interactions ({interactions.length}) →
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: INTERACTIONS ── */}
      {activeTab === 'interactions' && (
        <div className="space-y-3">
          {interactions.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center">
              <MessageCircle className="w-12 h-12 mx-auto mb-3 text-slate-200" />
              <p className="text-slate-400 font-medium">Aucune interaction enregistrée</p>
            </div>
          ) : interactions.map(i => (
            <div key={i.id} className="bg-white rounded-2xl border border-slate-200 hover:border-slate-300 transition-colors group">
              {editingInteraction?.id === i.id ? (
                <div className="p-5 space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {(['Appel','Email','WhatsApp','SMS','Facebook','Instagram'] as const).map(t => (
                      <button key={t} type="button" onClick={() => setIForm(f => ({ ...f, type: t }))}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${iForm.type === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'}`}
                      >{t}</button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Date et heure</label>
                      <input type="datetime-local" value={iForm.date_heure} onChange={e => setIForm(f => ({ ...f, date_heure: e.target.value }))} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Durée (min)</label>
                      <input type="number" min="0" value={iForm.duree} onChange={e => setIForm(f => ({ ...f, duree: parseInt(e.target.value) || 0 }))} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Résultat</label>
                    <select value={iForm.resultat} onChange={e => setIForm(f => ({ ...f, resultat: e.target.value as Interaction['resultat'] }))} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                      <option value="">— Sélectionner —</option>
                      {['Pas de réponse','Répondu','Intéressé','Non intéressé','Relance'].map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Notes</label>
                    <textarea value={iForm.notes} onChange={e => setIForm(f => ({ ...f, notes: e.target.value }))} rows={3} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditingInteraction(null)} className="flex-1 px-3 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm hover:bg-slate-50 transition-colors">Annuler</button>
                    <button onClick={saveInteraction} className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors">Enregistrer</button>
                  </div>
                </div>
              ) : (
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${TYPE_COLORS[i.type]}`}>{i.type}</span>
                      {i.resultat && (
                        <span className={`text-xs px-2 py-0.5 rounded-lg ${RESULT_COLORS[i.resultat] || 'bg-slate-100 text-slate-600'}`}>{i.resultat}</span>
                      )}
                      {i.duree > 0 && (
                        <span className="text-xs text-slate-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {i.duree} min
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-xs text-slate-400 whitespace-nowrap mr-1">{fmtDateTime(i.date_heure)}</span>
                      {canModify && <button onClick={() => openEditInteraction(i)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all" title="Modifier">
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>}
                      {canDelete && <button onClick={() => deleteInteraction(i.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all" title="Supprimer">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>}
                    </div>
                  </div>
                  {i.notes && (
                    <p className="mt-3 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                      {i.notes}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── TAB: TÂCHES ── */}
      {activeTab === 'taches' && (
        <div className="space-y-3">
          {taches.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center">
              <CheckSquare className="w-12 h-12 mx-auto mb-3 text-slate-200" />
              <p className="text-slate-400 font-medium">Aucune tâche</p>
            </div>
          ) : taches.map(t => {
            const overdue = t.date_echeance && new Date(t.date_echeance) < new Date() && t.statut === 'En attente';
            return (
              <div key={t.id} className={`bg-white rounded-2xl border transition-colors group ${
                t.statut === 'Terminé' ? 'border-slate-100 opacity-60' : overdue ? 'border-red-200' : 'border-slate-200'
              }`}>
                {editingTache?.id === t.id ? (
                  <div className="p-5 space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Titre *</label>
                      <input type="text" value={tForm.titre} onChange={e => setTForm(f => ({ ...f, titre: e.target.value }))} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Description</label>
                      <input type="text" value={tForm.description} onChange={e => setTForm(f => ({ ...f, description: e.target.value }))} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Échéance</label>
                        <input type="datetime-local" value={tForm.date_echeance} onChange={e => setTForm(f => ({ ...f, date_echeance: e.target.value }))} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Statut</label>
                        <div className="flex gap-2">
                          {(['En attente', 'Terminé'] as const).map(s => (
                            <button key={s} type="button" onClick={() => setTForm(f => ({ ...f, statut: s }))}
                              className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors ${tForm.statut === s ? s === 'En attente' ? 'bg-blue-600 text-white' : 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                            >{s}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => setEditingTache(null)} className="flex-1 px-3 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm hover:bg-slate-50 transition-colors">Annuler</button>
                      <button onClick={saveTache} className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors">Enregistrer</button>
                    </div>
                  </div>
                ) : (
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1">
                        <button
                          onClick={() => completeTache(t.id)}
                          className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                            t.statut === 'Terminé' ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 hover:border-emerald-400'
                          }`}
                        >
                          {t.statut === 'Terminé' && <Check className="w-3 h-3 text-white" />}
                        </button>
                        <div>
                          <p className={`font-semibold text-sm ${t.statut === 'Terminé' ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                            {t.titre}
                          </p>
                          {t.description && <p className="text-xs text-slate-500 mt-1">{t.description}</p>}
                          {t.date_echeance && (
                            <div className={`flex items-center gap-1 text-xs mt-1.5 ${overdue ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>
                              <Calendar className="w-3 h-3" />
                              {fmtDate(t.date_echeance)}
                              {overdue && <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs ml-1">En retard</span>}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {canModify && <button onClick={() => openEditTache(t)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all" title="Modifier">
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>}
                        {canDelete && <button onClick={() => deleteTache(t.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all" title="Supprimer">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── TAB: DOCUMENTS ── */}
      {activeTab === 'documents' && (
        <div className="space-y-6">
          {/* Upload zone */}
          <div
            ref={dropRef}
            onDragOver={e => { e.preventDefault(); setDraggingPdf(true); }}
            onDragLeave={() => setDraggingPdf(false)}
            onDrop={e => { e.preventDefault(); setDraggingPdf(false); const f = e.dataTransfer.files[0]; if (f) handleFileUpload(f); }}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
              draggingPdf ? 'border-blue-400 bg-blue-50 scale-[1.01]' : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
            }`}
          >
            <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }} />
            {uploading ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-slate-500">Envoi en cours...</p>
              </div>
            ) : (
              <>
                <Upload className={`w-10 h-10 mx-auto mb-3 transition-colors ${draggingPdf ? 'text-blue-500' : 'text-slate-300'}`} />
                <p className="font-semibold text-slate-700 mb-1">Glissez un PDF ici</p>
                <p className="text-sm text-slate-400">ou cliquez pour parcourir — 20 Mo max</p>
              </>
            )}
          </div>
          {uploadError && (
            <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {uploadError}
            </div>
          )}

          {/* Document list */}
          {documents.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
              <FileText className="w-12 h-12 mx-auto mb-3 text-slate-200" />
              <p className="text-slate-400 font-medium">Aucun document</p>
            </div>
          ) : (
            <div className="space-y-3">
              {documents.map(doc => (
                <div key={doc.id} className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-4 hover:border-slate-300 transition-colors">
                  <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-red-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-slate-900 truncate">{doc.nom_fichier}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{fmtSize(doc.taille_octets)} · Ajouté le {fmtDate(doc.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openPdf(doc)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-xl text-xs font-semibold hover:bg-blue-100 transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" /> Visualiser
                    </button>
                    <button
                      onClick={() => downloadPdf(doc)}
                      className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
                      title="Télécharger"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    {canDelete && <button
                      onClick={() => deleteDocument(doc)}
                      className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                      title="Supprimer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Quick interaction modal */}
          {showQuickModal && (
            <QuickInteractionModal
              contact={contact}
              onClose={() => setShowQuickModal(false)}
              onSaved={() => { setShowQuickModal(false); loadAll(); }}
            />
          )}

          {/* Inline PDF viewer */}
          {pdfUrl && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-red-500" />
                  <span className="text-sm font-semibold text-slate-700 truncate max-w-96">{pdfName}</span>
                </div>
                <button onClick={() => { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); setPdfName(''); }}
                  className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors">
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              </div>
              <iframe
                src={pdfUrl}
                title={pdfName}
                className="w-full"
                style={{ height: '80vh' }}
              />
            </div>
          )}
        </div>
      )}

      {showAiEnrich && (
        <AiEnrichModal
          contact={contact}
          onClose={() => setShowAiEnrich(false)}
          onApplied={() => { setShowAiEnrich(false); loadAll(); }}
        />
      )}
    </div>
  );
}
