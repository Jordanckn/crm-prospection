import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Check, X, Calendar, User, CreditCard as Edit, Trash2,
  Bell, ChevronDown, ChevronUp, Zap,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Tache, Contact } from '../types/database';
import RelanceTimeline, { ETAPES_CONFIG, RelanceEtape } from '../components/RelanceTimeline';
import { usePermissions } from '../contexts/PermissionsContext';
import { dateKeyInTimezone, formatInTimezone, safeTimezone, toZonedDateTimeInput, zonedDateTimeInputToIso } from '../lib/timezone';

type TacheWithContact = Tache & { contacts?: Contact | null };

type RelanceGroup = {
  contact: Contact;
  interaction_id: string | null;
  interaction_date: string;
  etapes: RelanceEtape[];
  expanded: boolean;
};

const JOURS_PAR_ETAPE: Record<number, number> = { 1: 2, 2: 5, 3: 7, 4: 15, 5: 30 };

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function isToday(dateStr: string, timezone: string): boolean {
  return dateStr === dateKeyInTimezone(new Date(), timezone);
}

function isPast(dateStr: string, timezone: string): boolean {
  return dateStr < dateKeyInTimezone(new Date(), timezone);
}

export default function Taches({ timezone: requestedTimezone }: { timezone?: string }) {
  const timezone = safeTimezone(requestedTimezone);
  const { canModify, canDelete } = usePermissions();
  const [taches, setTaches] = useState<TacheWithContact[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [relanceGroups, setRelanceGroups] = useState<RelanceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTache, setEditingTache] = useState<Tache | null>(null);
  const [filterStatut, setFilterStatut] = useState('');
  const [activeTab, setActiveTab] = useState<'taches' | 'relances'>('taches');
  const [showRelanceModal, setShowRelanceModal] = useState(false);
  const [relanceContactId, setRelanceContactId] = useState('');
  const [relanceInteractionDate, setRelanceInteractionDate] = useState(dateKeyInTimezone(new Date(), timezone));

  const [formData, setFormData] = useState({
    contact_id: '', titre: '', description: '', date_echeance: '',
    statut: 'En attente' as Tache['statut'],
  });

  const loadData = useCallback(async () => {
    try {
      const [tRes, cRes, rRes] = await Promise.all([
        supabase.from('taches').select('*, contacts(*)').order('date_echeance', { ascending: true }),
        supabase.from('contacts').select('*').order('nom', { ascending: true }),
        supabase.from('relances').select('*, contacts(*)').order('date_relance', { ascending: true }),
      ]);
      setTaches(tRes.data || []);
      setContacts(cRes.data || []);

      // Build relance groups by contact
      const raw: any[] = rRes.data || [];
      const map = new Map<string, RelanceGroup>();
      for (const r of raw) {
        const cid = r.contact_id;
        if (!map.has(cid)) {
          map.set(cid, {
            contact: r.contacts as Contact,
            interaction_id: r.interaction_id,
            interaction_date: r.date_relance, // fallback
            etapes: [],
            expanded: false,
          });
        }
        const group = map.get(cid)!;
        const dateStr: string = r.date_relance;
        group.etapes.push({
          id: r.id,
          etape: r.etape,
          label: `J+${JOURS_PAR_ETAPE[r.etape]}`,
          jours: JOURS_PAR_ETAPE[r.etape],
          date_relance: dateStr,
          statut: r.statut,
          isPast: isPast(dateStr, timezone),
          isToday: isToday(dateStr, timezone),
        });
      }
      // Sort etapes inside each group
      for (const g of map.values()) {
        g.etapes.sort((a, b) => a.etape - b.etape);
      }
      setRelanceGroups(Array.from(map.values()));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [timezone]);

  useEffect(() => { loadData(); }, [loadData]);

  const resetForm = () => {
    setFormData({ contact_id: '', titre: '', description: '', date_echeance: '', statut: 'En attente' });
    setEditingTache(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { error } = await supabase.rpc('save_task_local_time', {
        p_task_id: editingTache?.id || null,
        p_contact_id: formData.contact_id || null,
        p_titre: formData.titre,
        p_description: formData.description,
        p_local_datetime: formData.date_echeance || null,
        p_timezone: timezone,
        p_statut: formData.statut,
      });
      if (error) throw error;
      setShowModal(false); resetForm(); loadData();
    } catch (err) { console.error(err); }
  };

  const handleEdit = (t: Tache) => {
    setEditingTache(t);
    setFormData({
      contact_id: t.contact_id || '',
      titre: t.titre,
      description: t.description,
      date_echeance: t.date_echeance ? toZonedDateTimeInput(t.date_echeance, timezone) : '',
      statut: t.statut,
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette tâche ?')) return;
    await supabase.from('taches').delete().eq('id', id);
    loadData();
  };

  const toggleStatut = async (t: Tache) => {
    const newStatut = t.statut === 'En attente' ? 'Terminé' : 'En attente';
    await supabase.from('taches').update({ statut: newStatut }).eq('id', t.id);
    loadData();
  };

  // Create a full relance sequence for a contact
  const createRelanceSequence = async () => {
    if (!relanceContactId) return;
    // Delete existing pending relances for this contact to reset
    await supabase.from('relances').delete().eq('contact_id', relanceContactId).eq('statut', 'en_attente');

    const rows = ETAPES_CONFIG.map(cfg => ({
      contact_id: relanceContactId,
      etape: cfg.etape,
      date_relance: addDays(relanceInteractionDate, cfg.jours),
      statut: 'en_attente',
    }));
    await supabase.from('relances').insert(rows);

    // Create matching taches for each step
    const contactObj = contacts.find(c => c.id === relanceContactId);
    if (contactObj) {
      const tacheRows = rows.map(r => ({
        contact_id: r.contact_id,
        titre: `Relance ${ETAPES_CONFIG.find(c => c.etape === r.etape)?.label} — ${contactObj.prenom} ${contactObj.nom}`,
        description: `Relance automatique étape ${r.etape} (${ETAPES_CONFIG.find(c => c.etape === r.etape)?.label})`,
        date_echeance: zonedDateTimeInputToIso(r.date_relance + 'T09:00', timezone),
        statut: 'En attente',
      }));
      await supabase.from('taches').insert(tacheRows);
    }

    setShowRelanceModal(false);
    setRelanceContactId('');
    loadData();
  };

  const markRelance = async (id: string, statut: 'fait' | 'ignore' | 'en_attente') => {
    await supabase.from('relances').update({ statut }).eq('id', id);
    loadData();
  };

  const toggleGroupExpanded = (contactId: string) => {
    setRelanceGroups(prev => prev.map(g => g.contact.id === contactId ? { ...g, expanded: !g.expanded } : g));
  };

  // Counts
  const pendingRelances = relanceGroups.flatMap(g => g.etapes).filter(e => e.statut === 'en_attente' && (e.isToday || e.isPast)).length;
  const tachesEnAttente = taches.filter(t => t.statut === 'En attente').length;
  const tachesTerminees = taches.filter(t => t.statut === 'Terminé').length;
  const filteredTaches = filterStatut ? taches.filter(t => t.statut === filterStatut) : taches;

  const fmtDate = (d: string | null) => {
    if (!d) return 'Pas de date';
    return formatInTimezone(d, timezone, { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const isOverdue = (d: string | null) => !!d && new Date(d) < new Date();

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tâches & Relances</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {tachesEnAttente} tâche(s) en attente
            {pendingRelances > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-bold">
                <Bell className="w-3 h-3" />{pendingRelances} relance(s) à faire
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowRelanceModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors text-sm font-semibold shadow-sm"
          >
            <Zap className="w-4 h-4" />
            Séquence relance
          </button>
          <button
            onClick={() => { resetForm(); setShowModal(true); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors text-sm font-semibold shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Nouvelle tâche
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab('taches')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'taches' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Tâches
          <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-bold">{tachesEnAttente}</span>
        </button>
        <button
          onClick={() => setActiveTab('relances')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'relances' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Séquences de relance
          {pendingRelances > 0 && (
            <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-bold">{pendingRelances}</span>
          )}
        </button>
      </div>

      {/* ── TACHES TAB ── */}
      {activeTab === 'taches' && (
        <>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
            <div className="flex gap-2">
              {[['', `Tout (${taches.length})`], ['En attente', `En attente (${tachesEnAttente})`], ['Terminé', `Terminé (${tachesTerminees})`]].map(([val, label]) => (
                <button key={val} onClick={() => setFilterStatut(val)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterStatut === val ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >{label}</button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {filteredTaches.map(tache => {
              const contact = tache.contacts;
              const overdue = tache.statut === 'En attente' && isOverdue(tache.date_echeance);
              return (
                <div key={tache.id} className={`bg-white rounded-xl border shadow-sm p-4 hover:shadow-md transition-all ${overdue ? 'border-red-200 bg-red-50/50' : 'border-slate-200'} ${tache.statut === 'Terminé' ? 'opacity-60' : ''}`}>
                  <div className="flex items-start gap-3">
                    <button onClick={() => toggleStatut(tache)} disabled={!canModify}
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${tache.statut === 'Terminé' ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 hover:border-blue-500'}`}
                    >
                      {tache.statut === 'Terminé' && <Check className="w-3 h-3 text-white" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <h3 className={`font-semibold text-sm ${tache.statut === 'Terminé' ? 'line-through text-slate-400' : 'text-slate-900'}`}>{tache.titre}</h3>
                          <div className="flex flex-wrap items-center gap-3 mt-1">
                            {contact && (
                              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                <User className="w-3 h-3" />{contact.prenom} {contact.nom}
                              </div>
                            )}
                            {tache.date_echeance && (
                              <div className={`flex items-center gap-1 text-xs ${overdue ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                                <Calendar className="w-3 h-3" />
                                {fmtDate(tache.date_echeance)}
                                {overdue && <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-bold ml-1">En retard</span>}
                              </div>
                            )}
                          </div>
                          {tache.description && <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{tache.description}</p>}
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          {canModify && <button onClick={() => handleEdit(tache)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><Edit className="w-3.5 h-3.5" /></button>}
                          {canDelete && <button onClick={() => handleDelete(tache.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredTaches.length === 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                <Check className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                <p className="text-slate-400 font-medium">Aucune tâche</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── RELANCES TAB ── */}
      {activeTab === 'relances' && (
        <div className="space-y-4">
          {relanceGroups.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center">
              <Zap className="w-12 h-12 text-slate-200 mx-auto mb-4" />
              <p className="text-slate-500 font-semibold text-lg">Aucune séquence de relance</p>
              <p className="text-slate-400 text-sm mt-2 mb-6">Créez une séquence automatique J+2, J+5, J+7, J+15, J+30 pour un contact</p>
              <button
                onClick={() => setShowRelanceModal(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white rounded-xl hover:bg-amber-600 text-sm font-semibold transition-colors"
              >
                <Zap className="w-4 h-4" />
                Créer une séquence
              </button>
            </div>
          ) : (
            relanceGroups.map(group => {
              const pendingCount = group.etapes.filter(e => e.statut === 'en_attente' && (e.isToday || e.isPast)).length;
              const nextPending = group.etapes.find(e => e.statut === 'en_attente');
              const allDone = group.etapes.every(e => e.statut === 'fait' || e.statut === 'ignore');

              return (
                <div key={group.contact.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all ${pendingCount > 0 ? 'border-amber-200' : 'border-slate-200'}`}>
                  {/* Group header */}
                  <div
                    className={`flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors ${pendingCount > 0 ? 'bg-amber-50/60' : ''}`}
                    onClick={() => toggleGroupExpanded(group.contact.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                        {group.contact.prenom?.[0]?.toUpperCase()}{group.contact.nom?.[0]?.toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900 text-sm">{group.contact.prenom} {group.contact.nom}</p>
                        <p className="text-xs text-slate-500">{group.contact.entreprise || group.contact.secteur_activite || group.contact.pays}</p>
                      </div>
                      {pendingCount > 0 && (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">
                          <Bell className="w-3 h-3" />{pendingCount} à relancer
                        </span>
                      )}
                      {allDone && (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold">Séquence complète</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {/* Compact timeline */}
                      <RelanceTimeline
                        etapes={group.etapes}
                        onMarkDone={() => {}}
                        onMarkIgnore={() => {}}
                        onMarkPending={() => {}}
                        compact
                      />
                      {nextPending && !allDone && (
                        <div className="text-right hidden sm:block">
                          <p className="text-xs text-slate-500">Prochaine</p>
                          <p className="text-xs font-bold text-slate-700">{nextPending.label} — {new Date(nextPending.date_relance).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</p>
                        </div>
                      )}
                      {group.expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </div>

                  {/* Expanded timeline */}
                  {group.expanded && (
                    <div className="px-5 pb-5 pt-2 border-t border-slate-100">
                      <RelanceTimeline
                        etapes={group.etapes}
                        onMarkDone={canModify ? id => markRelance(id, 'fait') : undefined}
                        onMarkIgnore={canModify ? id => markRelance(id, 'ignore') : undefined}
                        onMarkPending={canModify ? id => markRelance(id, 'en_attente') : undefined}
                      />
                      {canDelete && <div className="mt-4 pt-4 border-t border-slate-100 flex justify-end">
                        <button
                          onClick={async () => {
                            if (!confirm('Supprimer toute la séquence pour ce contact ?')) return;
                            await supabase.from('relances').delete().eq('contact_id', group.contact.id);
                            loadData();
                          }}
                          className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" />Supprimer la séquence
                        </button>
                      </div>}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── TACHE MODAL ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex justify-between items-center rounded-t-2xl">
              <h2 className="text-xl font-bold text-slate-900">{editingTache ? 'Modifier la tâche' : 'Nouvelle tâche'}</h2>
              <button onClick={() => { setShowModal(false); resetForm(); }} className="p-2 hover:bg-slate-100 rounded-xl"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wide">Titre *</label>
                <input required type="text" value={formData.titre} onChange={e => setFormData({ ...formData, titre: e.target.value })} placeholder="Ex: Relancer le client..." className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wide">Description</label>
                <textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} rows={3} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" placeholder="Détails..." />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wide">Contact</label>
                <select value={formData.contact_id} onChange={e => setFormData({ ...formData, contact_id: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                  <option value="">Aucun contact</option>
                  {contacts.map(c => <option key={c.id} value={c.id}>{c.prenom} {c.nom}{c.entreprise ? ` (${c.entreprise})` : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wide">Date d'échéance <span className="normal-case font-normal text-slate-400">({timezone})</span></label>
                <input type="datetime-local" value={formData.date_echeance} onChange={e => setFormData({ ...formData, date_echeance: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-2 uppercase tracking-wide">Statut</label>
                <div className="flex gap-2">
                  {(['En attente', 'Terminé'] as const).map(s => (
                    <button key={s} type="button" onClick={() => setFormData({ ...formData, statut: s })}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${formData.statut === s ? s === 'En attente' ? 'bg-blue-600 text-white' : 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >{s}</button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowModal(false); resetForm(); }} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50">Annuler</button>
                <button type="submit" className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 shadow-sm">{editingTache ? 'Mettre à jour' : 'Créer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── RELANCE MODAL ── */}
      {showRelanceModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full">
            <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Nouvelle séquence de relance</h2>
                <p className="text-sm text-slate-500 mt-0.5">J+2, J+5, J+7, J+15, J+30</p>
              </div>
              <button onClick={() => setShowRelanceModal(false)} className="p-2 hover:bg-slate-100 rounded-xl"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-2 uppercase tracking-wide">Contact *</label>
                <select value={relanceContactId} onChange={e => setRelanceContactId(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 outline-none bg-white">
                  <option value="">— Choisir un contact —</option>
                  {contacts.map(c => <option key={c.id} value={c.id}>{c.prenom} {c.nom}{c.entreprise ? ` — ${c.entreprise}` : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-2 uppercase tracking-wide">Date du premier contact (J)</label>
                <input type="date" value={relanceInteractionDate} onChange={e => setRelanceInteractionDate(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500 outline-none" />
              </div>

              {/* Preview */}
              {relanceContactId && (
                <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                  <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-3">Aperçu de la séquence</p>
                  <div className="space-y-2">
                    {ETAPES_CONFIG.map(cfg => (
                      <div key={cfg.etape} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center text-xs font-bold text-amber-700">{cfg.etape}</div>
                          <span className="font-semibold text-slate-700">{cfg.label}</span>
                        </div>
                        <span className="text-slate-600">
                          {new Date(addDays(relanceInteractionDate, cfg.jours)).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'long' })}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-amber-600 mt-3">5 tâches seront créées automatiquement dans votre agenda.</p>
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={() => setShowRelanceModal(false)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50">Annuler</button>
                <button onClick={createRelanceSequence} disabled={!relanceContactId} className="flex-1 px-4 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-semibold hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">
                  Créer la séquence
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
