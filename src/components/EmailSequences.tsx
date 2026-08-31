import { useEffect, useState, useMemo } from 'react';
import { Plus, X, Trash2, Play, Pause, Mail, Clock, Users, Check, ChevronRight, CreditCard as EditIcon, Search, MapPin, Briefcase, Brain } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Template, Contact } from '../types/database';
import { usePermissions } from '../contexts/PermissionsContext';
import { useBrand } from '../contexts/BrandContext';

type SequenceStep = {
  delay_days: number;
  template_id: string;
  subject: string;
};

type EmailSequence = {
  id: string;
  titre: string;
  description: string;
  etapes: SequenceStep[];
  actif: boolean;
  delai_base_minutes: number;
  alea_pourcentage: number;
  rewrite_ia: boolean;
  target_country: 'France' | 'Israël' | null;
  created_at: string;
};

type Enrollment = {
  id: string;
  sequence_id: string;
  contact_id: string;
  etape_courante: number;
  statut: 'active' | 'completed' | 'cancelled';
  prochaine_execution: string | null;
  derniere_execution: string | null;
  execution_status?: 'pending' | 'processing' | 'sent' | 'error' | 'completed' | 'cancelled';
  last_error?: string | null;
  contacts?: Contact;
};

type EnrollMode = 'individual' | 'sector' | 'location';

export default function EmailSequences() {
  const { canModify, canDelete } = usePermissions();
  const { brand } = useBrand();
  const [sequences, setSequences] = useState<EmailSequence[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingSeq, setEditingSeq] = useState<EmailSequence | null>(null);
  const [showEnrollModal, setShowEnrollModal] = useState<EmailSequence | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [operationMessage, setOperationMessage] = useState('');
  const [selectedSeq, setSelectedSeq] = useState<EmailSequence | null>(null);

  // Enrollment selection state
  const [enrollMode, setEnrollMode] = useState<EnrollMode>('individual');
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [enrollSearch, setEnrollSearch] = useState('');
  const [enrollSector, setEnrollSector] = useState('');
  const [enrollLocation, setEnrollLocation] = useState('');

  const [form, setForm] = useState({
    titre: '',
    description: '',
    etapes: [{ delay_days: 0, template_id: '', subject: '' }] as SequenceStep[],
    actif: true,
    delai_base_minutes: 3,
    alea_pourcentage: 30,
    rewrite_ia: true,
    target_country: 'France' as 'France' | 'Israël',
  });

  useEffect(() => { loadData(); }, [brand.id]);

  const loadData = async () => {
    try {
      const [seqRes, tplRes, cRes, enrRes] = await Promise.all([
        supabase.from('email_sequences').select('*').eq('brand_id', brand.id).order('created_at', { ascending: false }),
        supabase.from('templates').select('*').eq('brand_id', brand.id).eq('type', 'Email').order('titre'),
        supabase.from('contacts').select('*').eq('brand_id', brand.id).order('nom'),
        supabase.from('email_sequence_enrollments').select('*, contacts(*)').eq('brand_id', brand.id).order('created_at', { ascending: false }),
      ]);
      setSequences(seqRes.data || []);
      setTemplates(tplRes.data || []);
      setContacts(cRes.data || []);
      setEnrollments(enrRes.data || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  // Derived lists for filters
  const sectors = useMemo(() => {
    const s = new Set(contacts.map(c => c.secteur_activite).filter(Boolean));
    return Array.from(s).sort();
  }, [contacts]);

  const locations = useMemo(() => {
    const s = new Set(contacts.map(c => c.pays).filter(Boolean));
    return Array.from(s).sort();
  }, [contacts]);

  const filteredEnrollContacts = useMemo(() => {
    let list = contacts.filter(c => c.email);
    if (brand.code === 'epiderme_ai' && showEnrollModal?.target_country) {
      list = list.filter(c => c.pays === showEnrollModal.target_country);
    }
    if (enrollMode === 'sector' && enrollSector) {
      list = list.filter(c => c.secteur_activite === enrollSector);
    }
    if (enrollMode === 'location' && enrollLocation) {
      list = list.filter(c => c.pays === enrollLocation);
    }
    if (enrollSearch) {
      const term = enrollSearch.toLowerCase();
      list = list.filter(c =>
        `${c.prenom} ${c.nom}`.toLowerCase().includes(term) ||
        (c.entreprise || '').toLowerCase().includes(term) ||
        (c.email || '').toLowerCase().includes(term)
      );
    }
    // Exclude already enrolled in this sequence
    if (showEnrollModal) {
      const enrolled = new Set(enrollments.filter(e => e.sequence_id === showEnrollModal.id && e.statut === 'active').map(e => e.contact_id));
      list = list.filter(c => !enrolled.has(c.id));
    }
    return list;
  }, [contacts, enrollMode, enrollSector, enrollLocation, enrollSearch, showEnrollModal, enrollments, brand.code]);

  const resetForm = () => {
    setForm({ titre: '', description: '', etapes: [{ delay_days: 0, template_id: '', subject: '' }], actif: true, delai_base_minutes: 3, alea_pourcentage: 30, rewrite_ia: true, target_country: 'France' });
    setEditingSeq(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validSteps = form.etapes.filter(s => s.template_id);
    if (validSteps.length === 0) return;
    if (validSteps.some((step, index) => index > 0 && step.delay_days <= validSteps[index - 1].delay_days)) {
      setOperationMessage('Les délais doivent être strictement croissants : J+0, J+2, J+5, etc.');
      return;
    }
    try {
      const payload = { ...form, etapes: validSteps, target_country: brand.code === 'epiderme_ai' ? form.target_country : null };
      let error;
      if (editingSeq) {
        ({ error } = await supabase.from('email_sequences').update(payload).eq('id', editingSeq.id));
      } else {
        ({ error } = await supabase.from('email_sequences').insert([payload]));
      }
      if (error) throw error;
      setShowModal(false);
      setOperationMessage('Séquence enregistrée.');
      resetForm();
      loadData();
    } catch (err) { console.error(err); }
  };

  const handleEdit = (seq: EmailSequence) => {
    setEditingSeq(seq);
    setForm({
      titre: seq.titre,
      description: seq.description,
      etapes: seq.etapes.length > 0 ? seq.etapes : [{ delay_days: 0, template_id: '', subject: '' }],
      actif: seq.actif,
      delai_base_minutes: seq.delai_base_minutes || 3,
      alea_pourcentage: seq.alea_pourcentage || 30,
      rewrite_ia: seq.rewrite_ia !== false,
      target_country: seq.target_country || 'France',
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette sequence ?')) return;
    await supabase.from('email_sequences').delete().eq('id', id);
    if (selectedSeq?.id === id) setSelectedSeq(null);
    loadData();
  };

  const toggleActif = async (seq: EmailSequence) => {
    await supabase.from('email_sequences').update({ actif: !seq.actif }).eq('id', seq.id);
    loadData();
  };

  const addStep = () => {
    const lastDelay = form.etapes.length > 0 ? form.etapes[form.etapes.length - 1].delay_days : 0;
    setForm(f => ({ ...f, etapes: [...f.etapes, { delay_days: lastDelay + 3, template_id: '', subject: '' }] }));
  };

  const removeStep = (idx: number) => {
    setForm(f => ({ ...f, etapes: f.etapes.filter((_, i) => i !== idx) }));
  };

  const updateStep = (idx: number, field: keyof SequenceStep, value: string | number) => {
    setForm(f => ({
      ...f,
      etapes: f.etapes.map((s, i) => i === idx ? { ...s, [field]: value } : s),
    }));
  };

  const toggleContactSelection = (id: string) => {
    setSelectedContactIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const selectAll = () => {
    setSelectedContactIds(new Set(filteredEnrollContacts.map(c => c.id)));
  };

  const selectNone = () => {
    setSelectedContactIds(new Set());
  };

  const openEnrollModal = (seq: EmailSequence) => {
    setShowEnrollModal(seq);
    setSelectedContactIds(new Set());
    setEnrollSearch('');
    setEnrollSector('');
    setEnrollLocation('');
    setEnrollMode('individual');
  };

  const handleEnroll = async () => {
    if (!showEnrollModal || selectedContactIds.size === 0) return;
    setEnrolling(true);
    try {
      if (brand.code === 'epiderme_ai' && showEnrollModal.target_country) {
        const incompatible = Array.from(selectedContactIds)
          .map(id => contacts.find(contact => contact.id === id))
          .filter(contact => contact && contact.pays !== showEnrollModal.target_country);
        if (incompatible.length) {
          throw new Error(`Cette séquence est réservée à ${showEnrollModal.target_country}. Retirez les contacts d'un autre pays.`);
        }
      }
      const etapes = showEnrollModal.etapes;
      const firstDelay = etapes.length > 0 ? etapes[0].delay_days : 0;
      const enrolledAt = new Date();
      const rows = Array.from(selectedContactIds).map((cid, index) => {
        const variation = 1 + ((Math.random() * 2 - 1) * (showEnrollModal.alea_pourcentage || 0) / 100);
        const staggerMs = index * (showEnrollModal.delai_base_minutes || 3) * variation * 60 * 1000;
        const contactStart = new Date(enrolledAt.getTime() + staggerMs);
        return {
          sequence_id: showEnrollModal.id,
          contact_id: cid,
          etape_courante: 0,
          statut: 'active',
          execution_status: 'pending',
          enrolled_at: contactStart.toISOString(),
          prochaine_execution: new Date(contactStart.getTime() + firstDelay * 24 * 60 * 60 * 1000).toISOString(),
        };
      });

      const { error } = await supabase.from('email_sequence_enrollments').insert(rows);
      if (error) throw error;
      setShowEnrollModal(null);
      setSelectedContactIds(new Set());
      setOperationMessage(`${rows.length} prospect(s) inscrit(s). Le moteur serveur prendra le relais automatiquement.`);
      loadData();
    } catch (err) {
      console.error(err);
      setOperationMessage(`Erreur d’inscription : ${err instanceof Error ? err.message : 'opération impossible'}`);
    }
    finally { setEnrolling(false); }
  };

  const cancelEnrollment = async (id: string) => {
    await supabase.from('email_sequence_enrollments').update({ statut: 'cancelled' }).eq('id', id);
    loadData();
  };

  const getTemplateName = (id: string) => templates.find(t => t.id === id)?.titre || 'Template inconnu';

  const seqEnrollments = selectedSeq ? enrollments.filter(e => e.sequence_id === selectedSeq.id) : [];

  if (loading) {
    return <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Sequences email automatiques</h2>
          <p className="text-xs text-slate-500 mt-0.5">Programmez des chaines d'emails avec envoi humain et reecriture IA</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-semibold transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> Nouvelle sequence
        </button>
      </div>

      {operationMessage && <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{operationMessage}</div>}

      {/* Sequences grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Sequences list */}
        <div className="space-y-3">
          {sequences.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
              <Mail className="w-10 h-10 text-slate-200 mx-auto mb-3" />
              <p className="text-slate-500 font-medium text-sm">Aucune sequence creee</p>
              <p className="text-xs text-slate-400 mt-1">Creez une sequence pour automatiser vos suivis par email</p>
            </div>
          ) : (
            sequences.map(seq => {
              const isSelected = selectedSeq?.id === seq.id;
              const activeEnr = enrollments.filter(e => e.sequence_id === seq.id && e.statut === 'active').length;
              return (
                <div
                  key={seq.id}
                  onClick={() => setSelectedSeq(isSelected ? null : seq)}
                  className={`bg-white rounded-xl border p-4 cursor-pointer transition-all ${isSelected ? 'border-blue-400 shadow-md ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-sm text-slate-900 truncate">{seq.titre}</h3>
                        {!seq.actif && <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-full font-bold">PAUSE</span>}
                        {seq.rewrite_ia && <span title="Reecriture IA active"><Brain className="w-3 h-3 text-violet-500" /></span>}
                        {brand.code === 'epiderme_ai' && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${seq.target_country === 'Israël' ? 'bg-sky-50 text-sky-700' : 'bg-blue-50 text-blue-700'}`}>
                            {seq.target_country === 'Israël' ? '🇮🇱 Epiderm AI' : seq.target_country === 'France' ? '🇫🇷 Epiderme AI' : '🌍 Selon le contact'}
                          </span>
                        )}
                      </div>
                      {seq.description && <p className="text-xs text-slate-500 mt-0.5 truncate">{seq.description}</p>}
                      <div className="flex items-center gap-3 mt-2">
                        <span className="flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                          <Mail className="w-3 h-3" /> {seq.etapes.length} etape{seq.etapes.length > 1 ? 's' : ''}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                          <Clock className="w-3 h-3" /> {seq.delai_base_minutes || 3}min +/-{seq.alea_pourcentage || 30}%
                        </span>
                        {activeEnr > 0 && (
                          <span className="flex items-center gap-1 text-[10px] text-blue-600 font-semibold">
                            <Users className="w-3 h-3" /> {activeEnr} actif{activeEnr > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={e => { e.stopPropagation(); openEnrollModal(seq); }} className="p-1.5 text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors" title="Inscrire des contacts"><Plus className="w-3.5 h-3.5" /></button>
                      {canModify && <button onClick={e => { e.stopPropagation(); toggleActif(seq); }} className={`p-1.5 rounded-lg transition-colors ${seq.actif ? 'text-amber-500 hover:bg-amber-50' : 'text-emerald-500 hover:bg-emerald-50'}`} title={seq.actif ? 'Pause' : 'Activer'}>
                        {seq.actif ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </button>}
                      {canModify && <button onClick={e => { e.stopPropagation(); handleEdit(seq); }} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><EditIcon className="w-3.5 h-3.5" /></button>}
                      {canDelete && <button onClick={e => { e.stopPropagation(); handleDelete(seq.id); }} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                  </div>
                  {/* Steps timeline */}
                  <div className="mt-3 flex items-center gap-1 overflow-x-auto">
                    {seq.etapes.map((step, i) => (
                      <div key={i} className="flex items-center gap-1 flex-shrink-0">
                        <div className="flex flex-col items-center">
                          <span className="text-[9px] text-slate-400 font-medium mb-0.5">J+{step.delay_days}</span>
                          <div className="w-6 h-6 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center">
                            <Mail className="w-3 h-3 text-blue-600" />
                          </div>
                          <span className="text-[9px] text-slate-500 mt-0.5 max-w-16 truncate">{getTemplateName(step.template_id).split(' ').slice(0, 2).join(' ')}</span>
                        </div>
                        {i < seq.etapes.length - 1 && <ChevronRight className="w-3 h-3 text-slate-300 mt-2" />}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Detail / Enrollments panel */}
        <div>
          {selectedSeq ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden sticky top-6">
              <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm text-slate-900">{selectedSeq.titre}</h3>
                  <p className="text-xs text-slate-400">{seqEnrollments.length} contact(s) inscrits</p>
                </div>
                <button onClick={() => openEnrollModal(selectedSeq)} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors">
                  <Plus className="w-3 h-3" /> Inscrire
                </button>
              </div>
              <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
                {seqEnrollments.length === 0 ? (
                  <div className="p-8 text-center">
                    <Users className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                    <p className="text-xs text-slate-400">Aucun contact inscrit</p>
                  </div>
                ) : (
                  seqEnrollments.map(enr => {
                    const c = enr.contacts;
                    return (
                      <div key={enr.id} className="px-5 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${enr.statut === 'active' ? 'bg-blue-600' : enr.statut === 'completed' ? 'bg-emerald-600' : 'bg-slate-400'}`}>
                            {c?.prenom?.[0]}{c?.nom?.[0]}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 truncate">{c?.prenom} {c?.nom}</p>
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-semibold ${enr.execution_status === 'error' ? 'text-red-600' : enr.statut === 'active' ? 'text-blue-600' : enr.statut === 'completed' ? 'text-emerald-600' : 'text-slate-400'}`}>
                                {enr.execution_status === 'error' ? 'Erreur' : enr.execution_status === 'processing' ? 'En cours' : enr.execution_status === 'sent' ? 'Envoyé' : enr.statut === 'active' ? `Etape ${enr.etape_courante + 1}/${selectedSeq.etapes.length}` : enr.statut === 'completed' ? 'Terminé' : 'Annulé'}
                              </span>
                              {enr.prochaine_execution && enr.statut === 'active' && (
                                <span className="flex items-center gap-0.5 text-[10px] text-slate-400">
                                  <Clock className="w-2.5 h-2.5" />
                                  {new Date(enr.prochaine_execution).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                                </span>
                              )}
                            </div>
                            {enr.last_error && <p className="mt-1 max-w-xs truncate text-[10px] text-red-600" title={enr.last_error}>{enr.last_error}</p>}
                          </div>
                        </div>
                        {enr.statut === 'active' && (
                          <button onClick={() => cancelEnrollment(enr.id)} className="text-[10px] text-slate-400 hover:text-red-600 font-medium px-2 py-1 hover:bg-red-50 rounded-lg transition-colors">
                            Annuler
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 flex flex-col items-center justify-center py-16 text-center sticky top-6">
              <Mail className="w-10 h-10 text-slate-200 mb-3" />
              <p className="text-slate-500 font-medium text-sm">Selectionnez une sequence</p>
              <p className="text-xs text-slate-400 mt-1">pour voir les contacts inscrits</p>
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit Sequence Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex justify-between items-center rounded-t-2xl z-10">
              <h2 className="text-lg font-bold text-slate-900">{editingSeq ? 'Modifier la sequence' : 'Nouvelle sequence email'}</h2>
              <button onClick={() => { setShowModal(false); resetForm(); }} className="p-2 hover:bg-slate-100 rounded-xl transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Nom de la sequence *</label>
                  <input required type="text" value={form.titre} onChange={e => setForm({ ...form, titre: e.target.value })} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Ex: Sequence de bienvenue" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Description</label>
                  <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Description courte..." />
                </div>
              </div>

              {brand.code === 'epiderme_ai' && (
                <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
                  <label htmlFor="sequence-target-country" className="mb-2 block text-xs font-bold uppercase tracking-wide text-violet-700">Choix de l’espace d’envoi *</label>
                  <select
                    id="sequence-target-country"
                    required
                    value={form.target_country}
                    onChange={event => setForm({ ...form, target_country: event.target.value as 'France' | 'Israël' })}
                    className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-violet-400"
                  >
                    <option value="France">🇫🇷 France — Epiderme AI</option>
                    <option value="Israël">🇮🇱 Israël — Epiderm AI</option>
                  </select>
                  <div className="mt-2 rounded-lg border border-violet-100 bg-white/80 px-3 py-2 text-xs text-slate-600">
                    Envoyé depuis <strong>{form.target_country === 'Israël' ? 'Epiderm AI' : 'Epiderme AI'}</strong>
                    {' '}— {form.target_country === 'Israël' ? 'contact@epiderm-ai.com' : 'contact@epiderme-ai.com'}
                  </div>
                  <p className="mt-2 text-[11px] text-violet-700">Seuls les contacts du pays sélectionné pourront être inscrits à cette séquence.</p>
                </div>
              )}

              {/* Sending config */}
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-3">Algorithme d'envoi humain</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] text-slate-500 font-semibold mb-1">Delai base (min)</label>
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={form.delai_base_minutes}
                      onChange={e => setForm({ ...form, delai_base_minutes: parseInt(e.target.value) || 3 })}
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    <p className="text-[9px] text-slate-400 mt-0.5">Entre chaque email</p>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 font-semibold mb-1">Alea (%)</label>
                    <input
                      type="number"
                      min="5"
                      max="80"
                      value={form.alea_pourcentage}
                      onChange={e => setForm({ ...form, alea_pourcentage: parseInt(e.target.value) || 30 })}
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    <p className="text-[9px] text-slate-400 mt-0.5">Variation aleatoire</p>
                  </div>
                  <div className="flex flex-col justify-between">
                    <label className="block text-[10px] text-slate-500 font-semibold mb-1">Reecriture IA</label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.rewrite_ia}
                        onChange={e => setForm({ ...form, rewrite_ia: e.target.checked })}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600"
                      />
                      <span className="text-xs text-slate-700 font-medium">Active</span>
                    </label>
                  </div>
                </div>
                <div className="mt-3 p-2.5 bg-white rounded-lg border border-slate-200">
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Delai reel entre 2 mails : <span className="font-bold text-slate-700">{Math.max(1, Math.round(form.delai_base_minutes * (1 - form.alea_pourcentage / 100)))} - {Math.round(form.delai_base_minutes * (1 + form.alea_pourcentage / 100))} min</span>
                    {form.rewrite_ia && <span className="ml-2 text-violet-600 font-semibold">+ IA reecrit chaque email</span>}
                  </p>
                </div>
              </div>

              {/* Steps */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Etapes de la sequence</label>
                  <button type="button" onClick={addStep} className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold hover:bg-blue-100 transition-colors">
                    <Plus className="w-3 h-3" /> Ajouter une etape
                  </button>
                </div>
                <div className="space-y-3">
                  {form.etapes.map((step, idx) => (
                    <div key={idx} className="flex items-start gap-3 bg-slate-50 rounded-xl p-3 border border-slate-200">
                      <div className="flex flex-col items-center flex-shrink-0 pt-1">
                        <div className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">{idx + 1}</div>
                      </div>
                      <div className="flex-1 grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[10px] text-slate-500 font-semibold mb-1">Delai (jours)</label>
                          <input
                            type="number"
                            min="0"
                            value={step.delay_days}
                            onChange={e => updateStep(idx, 'delay_days', parseInt(e.target.value) || 0)}
                            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                          />
                          <p className="text-[9px] text-slate-400 mt-0.5">{step.delay_days === 0 ? 'Immediatement' : `J+${step.delay_days}`}</p>
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 font-semibold mb-1">Template *</label>
                          <select
                            value={step.template_id}
                            onChange={e => updateStep(idx, 'template_id', e.target.value)}
                            className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                          >
                            <option value="">Choisir...</option>
                            {templates.map(t => <option key={t.id} value={t.id}>{t.titre}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-500 font-semibold mb-1">Objet personnalisé (facultatif)</label>
                          <input
                            type="text"
                            value={step.subject}
                            onChange={e => updateStep(idx, 'subject', e.target.value)}
                            placeholder={templates.find(t => t.id === step.template_id)?.objet || 'Objet du template'}
                            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                          />
                        </div>
                      </div>
                      {form.etapes.length > 1 && (
                        <button type="button" onClick={() => removeStep(idx)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors mt-4">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.actif} onChange={e => setForm({ ...form, actif: e.target.checked })} className="w-4 h-4 rounded border-slate-300 text-blue-600" />
                <span className="text-sm font-medium text-slate-700">Sequence active</span>
              </label>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => { setShowModal(false); resetForm(); }} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium transition-colors">Annuler</button>
                <button type="submit" className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-semibold transition-colors shadow-sm">{editingSeq ? 'Enregistrer' : 'Creer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Enroll Contacts Modal - Advanced */}
      {showEnrollModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full max-h-[92vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center flex-shrink-0">
              <div>
                <h3 className="font-bold text-slate-900">Inscrire des contacts</h3>
                <p className="text-xs text-slate-500 mt-0.5">Sequence: {showEnrollModal.titre}</p>
                {brand.code === 'epiderme_ai' && showEnrollModal.target_country && (
                  <p className="mt-1 text-xs font-semibold text-violet-700">
                    {showEnrollModal.target_country === 'Israël' ? '🇮🇱 Epiderm AI · contact@epiderm-ai.com' : '🇫🇷 Epiderme AI · contact@epiderme-ai.com'}
                  </p>
                )}
              </div>
              <button onClick={() => { setShowEnrollModal(null); setSelectedContactIds(new Set()); }} className="p-2 hover:bg-slate-100 rounded-xl"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {/* Mode selection */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">Mode de selection</label>
                <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
                  <button type="button" onClick={() => { setEnrollMode('individual'); setSelectedContactIds(new Set()); }} className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${enrollMode === 'individual' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
                    <Users className="w-3.5 h-3.5" /> Individuel
                  </button>
                  <button type="button" onClick={() => { setEnrollMode('sector'); setSelectedContactIds(new Set()); }} className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${enrollMode === 'sector' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
                    <Briefcase className="w-3.5 h-3.5" /> Par secteur
                  </button>
                  <button type="button" onClick={() => { setEnrollMode('location'); setSelectedContactIds(new Set()); }} className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${enrollMode === 'location' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
                    <MapPin className="w-3.5 h-3.5" /> Par lieu
                  </button>
                </div>
              </div>

              {/* Sector filter */}
              {enrollMode === 'sector' && (
                <div>
                  <label className="block text-[10px] text-slate-500 font-semibold mb-1">Secteur d'activite</label>
                  <select value={enrollSector} onChange={e => { setEnrollSector(e.target.value); setSelectedContactIds(new Set()); }} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Choisir un secteur...</option>
                    {sectors.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}

              {/* Location filter */}
              {enrollMode === 'location' && (
                <div>
                  <label className="block text-[10px] text-slate-500 font-semibold mb-1">Pays / Localisation</label>
                  <select value={enrollLocation} onChange={e => { setEnrollLocation(e.target.value); setSelectedContactIds(new Set()); }} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Choisir un lieu...</option>
                    {locations.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              )}

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={enrollSearch}
                  onChange={e => setEnrollSearch(e.target.value)}
                  placeholder="Rechercher un contact..."
                  className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              {/* Select all / none */}
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  <span className="font-bold text-slate-700">{selectedContactIds.size}</span> / {filteredEnrollContacts.length} selectionne(s)
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={selectAll} className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 px-2 py-1 hover:bg-blue-50 rounded-lg transition-colors">Tout selectionner</button>
                  <button type="button" onClick={selectNone} className="text-[10px] font-semibold text-slate-500 hover:text-slate-700 px-2 py-1 hover:bg-slate-100 rounded-lg transition-colors">Aucun</button>
                </div>
              </div>

              {/* Contact list */}
              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-56 overflow-y-auto">
                {filteredEnrollContacts.length === 0 ? (
                  <div className="p-6 text-center">
                    <p className="text-xs text-slate-400">Aucun contact disponible avec email</p>
                  </div>
                ) : (
                  filteredEnrollContacts.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleContactSelection(c.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors border-b border-slate-50 last:border-0 ${
                        selectedContactIds.has(c.id) ? 'bg-blue-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${selectedContactIds.has(c.id) ? 'bg-blue-600 border-blue-600' : 'border-slate-300'}`}>
                        {selectedContactIds.has(c.id) && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-800 truncate">{c.prenom} {c.nom}</p>
                        <p className="text-[10px] text-slate-400 truncate">{c.email}{c.secteur_activite ? ` - ${c.secteur_activite}` : ''}{c.pays ? ` - ${c.pays}` : ''}</p>
                      </div>
                      {c.entreprise && <span className="text-[10px] text-slate-400 flex-shrink-0">{c.entreprise}</span>}
                    </button>
                  ))
                )}
              </div>

              {/* Sequence recap */}
              {selectedContactIds.size > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                  <p className="text-xs font-semibold text-blue-700 mb-1">Recapitulatif :</p>
                  <p className="text-[10px] text-blue-600 mb-2">{selectedContactIds.size} contact(s) recevront la sequence suivante :</p>
                  <div className="space-y-1">
                    {showEnrollModal.etapes.map((step, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-blue-600">
                        <span className="font-mono font-bold">J+{step.delay_days}</span>
                        <ChevronRight className="w-3 h-3 text-blue-300" />
                        <span className="truncate">{getTemplateName(step.template_id)}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-blue-500 mt-2 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Envoi espace de ~{showEnrollModal.delai_base_minutes || 3}min (+/-{showEnrollModal.alea_pourcentage || 30}%) entre chaque mail
                    {showEnrollModal.rewrite_ia && <span className="ml-1 text-violet-600 font-semibold">+ IA</span>}
                  </p>
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-slate-100 flex gap-3 flex-shrink-0">
              <button onClick={() => { setShowEnrollModal(null); setSelectedContactIds(new Set()); }} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium transition-colors">Annuler</button>
              <button
                onClick={handleEnroll}
                disabled={selectedContactIds.size === 0 || enrolling}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-semibold transition-colors shadow-sm disabled:opacity-50"
              >
                {enrolling ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
                Inscrire {selectedContactIds.size > 0 ? `(${selectedContactIds.size})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
