import { useEffect, useState } from 'react';
import {
  X, Phone, Mail, MapPin, Globe, Hash, Smartphone, Monitor,
  FileText, Eye, Download, ChevronRight,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Contact, Interaction, ContactDocument } from '../types/database';

const STATUT_COLORS: Record<string, string> = {
  'Nouveau': 'bg-slate-100 text-slate-700',
  'En cours': 'bg-blue-100 text-blue-700',
  'Converti': 'bg-emerald-100 text-emerald-700',
  'Perdu': 'bg-red-100 text-red-700',
};

const TYPE_COLORS: Record<string, string> = {
  'Appel': 'bg-blue-50 text-blue-700 border-blue-200',
  'Email': 'bg-violet-50 text-violet-700 border-violet-200',
  'WhatsApp': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'SMS': 'bg-orange-50 text-orange-700 border-orange-200',
  'Facebook': 'bg-blue-50 text-blue-800 border-blue-300',
  'Instagram': 'bg-pink-50 text-pink-700 border-pink-200',
};

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function PageSpeedBadge({ score }: { score: number }) {
  const color = score >= 90 ? 'bg-emerald-100 text-emerald-700'
    : score >= 50 ? 'bg-amber-100 text-amber-700'
    : 'bg-red-100 text-red-700';
  return <span className={`px-2 py-0.5 rounded text-xs font-bold ${color}`}>{score}</span>;
}

type Props = {
  contact: Contact;
  onClose: () => void;
  onOpenFull: () => void;
};

export default function ContactSidePanel({ contact, onClose, onOpenFull }: Props) {
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [documents, setDocuments] = useState<ContactDocument[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfName, setPdfName] = useState<string>('');
  const [loadingPdf, setLoadingPdf] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [{ data: i }, { data: d }] = await Promise.all([
        supabase.from('interactions').select('*').eq('contact_id', contact.id)
          .order('date_heure', { ascending: false }).limit(5),
        supabase.from('contact_documents').select('*').eq('contact_id', contact.id)
          .order('created_at', { ascending: false }),
      ]);
      setInteractions(i || []);
      setDocuments(d || []);
    };
    load();
    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); };
  }, [contact.id]);

  const openPdf = async (doc: ContactDocument) => {
    setLoadingPdf(true);
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    const { data, error } = await supabase.storage.from('contact-documents').download(doc.storage_path);
    setLoadingPdf(false);
    if (error || !data) return;
    const url = URL.createObjectURL(data);
    setPdfUrl(url);
    setPdfName(doc.nom_fichier);
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

  const initials = `${contact.prenom?.[0] || ''}${contact.nom?.[0] || ''}`.toUpperCase();

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-[420px] bg-white shadow-2xl z-50 flex flex-col overflow-hidden animate-slideIn">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-100">
          <div className="flex items-center justify-between px-5 py-4">
            <button
              onClick={onOpenFull}
              className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors"
            >
              Ouvrir la fiche complète <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>

          {/* Contact hero */}
          <div className="px-5 pb-4 flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center shadow-sm flex-shrink-0">
              <span className="text-lg font-bold text-white">{initials || '?'}</span>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-bold text-slate-900 text-lg leading-tight truncate">
                {contact.prenom} {contact.nom}
              </h2>
              {contact.entreprise && (
                <p className="text-sm text-slate-500 truncate">{contact.entreprise}</p>
              )}
              <div className="flex items-center gap-2 mt-1.5">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUT_COLORS[contact.statut]}`}>
                  {contact.statut}
                </span>
                {contact.secteur_activite && (
                  <span className="text-xs text-slate-400 truncate">{contact.secteur_activite}</span>
                )}
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex gap-2 px-5 pb-4">
            {contact.telephone && (
              <a href={`tel:${contact.telephone}`}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-semibold transition-colors">
                <Phone className="w-3.5 h-3.5" /> Appeler
              </a>
            )}
            {contact.email && (
              <a href={`mailto:${contact.email}`}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold transition-colors">
                <Mail className="w-3.5 h-3.5" /> Email
              </a>
            )}
            {contact.site_web && (
              <a href={contact.site_web.startsWith('http') ? contact.site_web : `https://${contact.site_web}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold transition-colors">
                <Globe className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* Coordonnées section */}
          <div className="px-5 py-4 border-b border-slate-50">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Coordonnées</p>
            <div className="space-y-2.5">
              {contact.telephone && (
                <div className="flex items-center gap-2.5 text-sm">
                  <Phone className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                  <a href={`tel:${contact.telephone}`} className="text-slate-700 hover:text-blue-700">{contact.telephone}</a>
                </div>
              )}
              {contact.email && (
                <div className="flex items-center gap-2.5 text-sm">
                  <Mail className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                  <a href={`mailto:${contact.email}`} className="text-slate-700 hover:text-blue-700 truncate">{contact.email}</a>
                </div>
              )}
              {(contact.adresse || contact.ville) && (
                <div className="flex items-start gap-2.5 text-sm">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                  <span className="text-slate-600">
                    {[contact.adresse, [contact.code_postal, contact.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
                  </span>
                </div>
              )}
              {contact.siren_siret && (
                <div className="flex items-center gap-2.5 text-sm">
                  <Hash className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                  <span className="font-mono text-slate-700">{contact.siren_siret}</span>
                </div>
              )}
            </div>
          </div>

          {/* PageSpeed */}
          {contact.site_web && (contact.pagespeed_mobile !== null || contact.pagespeed_desktop !== null) && (
            <div className="px-5 py-4 border-b border-slate-50">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">PageSpeed</p>
              <div className="flex items-center gap-4">
                {contact.pagespeed_mobile !== null && (
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs text-slate-500">Mobile</span>
                    <PageSpeedBadge score={contact.pagespeed_mobile} />
                  </div>
                )}
                {contact.pagespeed_desktop !== null && (
                  <div className="flex items-center gap-2">
                    <Monitor className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs text-slate-500">Desktop</span>
                    <PageSpeedBadge score={contact.pagespeed_desktop} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes entreprise */}
          {contact.notes_entreprise && (
            <div className="px-5 py-4 border-b border-slate-50">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Notes entreprise</p>
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{contact.notes_entreprise}</p>
            </div>
          )}

          {/* Interactions récentes */}
          {interactions.length > 0 && (
            <div className="px-5 py-4 border-b border-slate-50">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                Interactions récentes
              </p>
              <div className="space-y-2">
                {interactions.slice(0, 4).map(i => (
                  <div key={i.id} className="flex items-start gap-2 text-xs">
                    <span className={`px-1.5 py-0.5 rounded border text-xs font-semibold flex-shrink-0 ${TYPE_COLORS[i.type]}`}>{i.type}</span>
                    <div className="flex-1 min-w-0">
                      {i.notes && <p className="text-slate-600 truncate">{i.notes}</p>}
                      <p className="text-slate-400">
                        {new Date(i.date_heure).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {contact.tags.length > 0 && (
            <div className="px-5 py-4 border-b border-slate-50">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {contact.tags.map(tag => (
                  <span key={tag} className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">{tag}</span>
                ))}
              </div>
            </div>
          )}

          {/* Documents */}
          {documents.length > 0 && (
            <div className="px-5 py-4">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                Documents ({documents.length})
              </p>
              <div className="space-y-2">
                {documents.map(doc => (
                  <div key={doc.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors">
                    <div className="w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <FileText className="w-4 h-4 text-red-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate">{doc.nom_fichier}</p>
                      <p className="text-xs text-slate-400">{fmtSize(doc.taille_octets)}</p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => openPdf(doc)}
                        className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Visualiser"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => downloadPdf(doc)}
                        className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors"
                        title="Télécharger"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Inline PDF viewer in panel */}
              {loadingPdf && (
                <div className="mt-3 flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {pdfUrl && (
                <div className="mt-3 rounded-xl overflow-hidden border border-slate-200">
                  <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
                    <span className="text-xs font-semibold text-slate-600 truncate flex-1">{pdfName}</span>
                    <button onClick={() => { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); setPdfName(''); }}
                      className="p-1 hover:bg-slate-200 rounded transition-colors ml-2">
                      <X className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                  </div>
                  <iframe src={pdfUrl} title={pdfName} className="w-full" style={{ height: '60vh' }} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
