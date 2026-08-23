import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Phone, Plus, Trash2, Play, Square, ChevronUp, ChevronDown, Search, X, Check, SlidersHorizontal, Users, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Contact } from '../types/database';
import ContactSearchSelect from '../components/ContactSearchSelect';
import QuickInteractionModal from '../components/QuickInteractionModal';
import { usePermissions } from '../contexts/PermissionsContext';

type ListeAppel = {
  id: string;
  user_id: string;
  contact_id: string;
  ordre: number;
  notes_prep: string;
  statut: 'en_attente' | 'en_cours' | 'traite';
  created_at: string;
  contact?: Contact;
};

type LastContactFilter = 'all' | 'never' | 'today' | 'not_today' | 'over_7_days' | 'over_30_days';
type PhoneFilter = 'with_phone' | 'mobile' | 'all';

const CONTACT_STATUSES: Contact['statut'][] = ['Nouveau', 'En cours', 'Converti', 'Perdu'];

function isMobileNumber(phone: string): boolean {
  const clean = phone.replace(/[\s.\-()]/g, '');
  return /^(\+336|\+337|06|07)/.test(clean);
}

function liveSeconds(start: Date): number {
  return Math.floor((Date.now() - start.getTime()) / 1000);
}

function fmtChrono(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function ProgrammationAppels({ onOpenContact }: { onOpenContact?: (id: string) => void }) {
  const { canModify, canDelete } = usePermissions();
  const [liste, setListe] = useState<ListeAppel[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [addContactId, setAddContactId] = useState('');
  const [addNotes, setAddNotes] = useState('');
  const [bulkSearch, setBulkSearch] = useState('');
  const [bulkPays, setBulkPays] = useState('');
  const [bulkStatut, setBulkStatut] = useState('');
  const [bulkSecteur, setBulkSecteur] = useState('');
  const [bulkTag, setBulkTag] = useState('');
  const [bulkLastContact, setBulkLastContact] = useState<LastContactFilter>('all');
  const [bulkPhone, setBulkPhone] = useState<PhoneFilter>('with_phone');
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkAdding, setBulkAdding] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [callStart, setCallStart] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [quickModalItem, setQuickModalItem] = useState<ListeAppel | null>(null);
  const [editNoteId, setEditNoteId] = useState<string | null>(null);
  const [editNoteVal, setEditNoteVal] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const [{ data: la }, { data: c }] = await Promise.all([
      supabase
        .from('liste_appels')
        .select('*, contact:contacts(*)')
        .eq('user_id', user.id)
        .neq('statut', 'traite')
        .order('ordre', { ascending: true }),
      supabase.from('contacts').select('*').order('nom', { ascending: true }),
    ]);

    setListe((la || []) as ListeAppel[]);
    setContacts(c || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (activeCallId && callStart) {
      tickRef.current = setInterval(() => setElapsed(liveSeconds(callStart)), 1000);
    } else {
      if (tickRef.current) clearInterval(tickRef.current);
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [activeCallId, callStart]);

  const addContact = async () => {
    if (!userId || !addContactId) return;
    const maxOrdre = liste.reduce((m, l) => Math.max(m, l.ordre), -1) + 1;
    await supabase.from('liste_appels').insert([{
      user_id: userId,
      contact_id: addContactId,
      ordre: maxOrdre,
      notes_prep: addNotes.trim(),
      statut: 'en_attente',
    }]);
    setAddContactId('');
    setAddNotes('');
    setShowAdd(false);
    loadData();
  };

  const activeContactIds = useMemo(
    () => new Set(liste.map(item => item.contact_id)),
    [liste],
  );

  const availableContacts = useMemo(
    () => contacts.filter(contact => !activeContactIds.has(contact.id)),
    [contacts, activeContactIds],
  );

  const paysOptions = useMemo(
    () => [...new Set(contacts.map(contact => contact.pays).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')),
    [contacts],
  );

  const secteurOptions = useMemo(
    () => [...new Set(contacts.map(contact => contact.secteur_activite).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')),
    [contacts],
  );

  const tagOptions = useMemo(
    () => [...new Set(contacts.flatMap(contact => contact.tags || []))].sort((a, b) => a.localeCompare(b, 'fr')),
    [contacts],
  );

  const bulkMatches = useMemo(() => {
    const normalizedSearch = bulkSearch.trim().toLocaleLowerCase('fr');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    return availableContacts.filter(contact => {
      if (normalizedSearch) {
        const haystack = [contact.prenom, contact.nom, contact.entreprise, contact.email, contact.telephone, contact.ville]
          .join(' ')
          .toLocaleLowerCase('fr');
        if (!haystack.includes(normalizedSearch)) return false;
      }
      if (bulkPays && contact.pays !== bulkPays) return false;
      if (bulkStatut && contact.statut !== bulkStatut) return false;
      if (bulkSecteur && contact.secteur_activite !== bulkSecteur) return false;
      if (bulkTag && !(contact.tags || []).includes(bulkTag)) return false;
      if (bulkPhone === 'with_phone' && !contact.telephone?.trim()) return false;
      if (bulkPhone === 'mobile' && (!contact.telephone || !isMobileNumber(contact.telephone))) return false;

      const lastInteraction = contact.derniere_interaction ? new Date(contact.derniere_interaction) : null;
      if (bulkLastContact === 'never' && lastInteraction) return false;
      if (bulkLastContact === 'today' && (!lastInteraction || lastInteraction < today)) return false;
      if (bulkLastContact === 'not_today' && lastInteraction && lastInteraction >= today) return false;
      if (bulkLastContact === 'over_7_days' && lastInteraction && lastInteraction >= sevenDaysAgo) return false;
      if (bulkLastContact === 'over_30_days' && lastInteraction && lastInteraction >= thirtyDaysAgo) return false;
      return true;
    });
  }, [availableContacts, bulkSearch, bulkPays, bulkStatut, bulkSecteur, bulkTag, bulkLastContact, bulkPhone]);

  useEffect(() => {
    if (!showBulkAdd) return;
    setBulkSelected(new Set(bulkMatches.map(contact => contact.id)));
  }, [showBulkAdd, bulkMatches]);

  const resetBulkFilters = () => {
    setBulkSearch('');
    setBulkPays('');
    setBulkStatut('');
    setBulkSecteur('');
    setBulkTag('');
    setBulkLastContact('all');
    setBulkPhone('with_phone');
    setBulkError('');
  };

  const toggleBulkContact = (contactId: string) => {
    setBulkSelected(previous => {
      const next = new Set(previous);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  };

  const addFilteredContacts = async () => {
    if (!userId || bulkSelected.size === 0 || bulkAdding) return;
    setBulkAdding(true);
    setBulkError('');

    try {
      const selectedContacts = bulkMatches.filter(contact => bulkSelected.has(contact.id));
      const maxOrdre = liste.reduce((max, item) => Math.max(max, item.ordre), -1);
      const rows = selectedContacts.map((contact, index) => ({
        user_id: userId,
        contact_id: contact.id,
        ordre: maxOrdre + index + 1,
        notes_prep: '',
        statut: 'en_attente' as const,
      }));
      const { error } = await supabase.from('liste_appels').insert(rows);
      if (error) throw error;
      setShowBulkAdd(false);
      resetBulkFilters();
      await loadData();
    } catch (error) {
      console.error(error);
      setBulkError("Impossible d'ajouter cette sélection. Réessayez dans un instant.");
    } finally {
      setBulkAdding(false);
    }
  };

  const removeItem = async (id: string) => {
    await supabase.from('liste_appels').delete().eq('id', id);
    if (activeCallId === id) { setActiveCallId(null); setCallStart(null); setElapsed(0); }
    setListe(prev => prev.filter(l => l.id !== id));
  };

  const startCall = (item: ListeAppel) => {
    if (activeCallId) return;
    setActiveCallId(item.id);
    setCallStart(new Date());
    setElapsed(0);
    supabase.from('liste_appels').update({ statut: 'en_cours' }).eq('id', item.id);
    setListe(prev => prev.map(l => l.id === item.id ? { ...l, statut: 'en_cours' } : l));
  };

  const stopCall = (item: ListeAppel) => {
    setActiveCallId(null);
    setCallStart(null);
    setQuickModalItem(item);
  };

  const markDone = async (item: ListeAppel) => {
    await supabase.from('liste_appels').update({ statut: 'traite' }).eq('id', item.id);
    setListe(prev => prev.filter(l => l.id !== item.id));
    if (activeCallId === item.id) { setActiveCallId(null); setCallStart(null); setElapsed(0); }
  };

  const saveNote = async (id: string) => {
    await supabase.from('liste_appels').update({ notes_prep: editNoteVal }).eq('id', id);
    setListe(prev => prev.map(l => l.id === id ? { ...l, notes_prep: editNoteVal } : l));
    setEditNoteId(null);
  };

  const moveItem = async (id: string, dir: 'up' | 'down') => {
    const idx = liste.findIndex(l => l.id === id);
    if (dir === 'up' && idx === 0) return;
    if (dir === 'down' && idx === liste.length - 1) return;
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    const newListe = [...liste];
    [newListe[idx], newListe[swapIdx]] = [newListe[swapIdx], newListe[idx]];
    const updated = newListe.map((l, i) => ({ ...l, ordre: i }));
    setListe(updated);
    await Promise.all(updated.map(l => supabase.from('liste_appels').update({ ordre: l.ordre }).eq('id', l.id)));
  };

  const filtered = searchTerm
    ? liste.filter(l => {
        const c = l.contact;
        return c && (`${c.prenom} ${c.nom}`.toLowerCase().includes(searchTerm.toLowerCase()) || (c.entreprise || '').toLowerCase().includes(searchTerm.toLowerCase()));
      })
    : liste;

  const activeItem = liste.find(l => l.id === activeCallId);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Programmation d'appels</h1>
          <p className="text-slate-500 text-sm mt-0.5">{liste.length} contact{liste.length > 1 ? 's' : ''} à appeler</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setShowBulkAdd(open => !open); setShowAdd(false); setBulkError(''); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-semibold transition-colors shadow-sm shadow-blue-500/30"
          >
            <SlidersHorizontal className="w-4 h-4" />
            Créer avec des filtres
          </button>
          <button
            onClick={() => { setShowAdd(open => !open); setShowBulkAdd(false); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-white text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 text-sm font-semibold transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Ajout manuel
          </button>
        </div>
      </div>

      {/* Filtered bulk add panel */}
      {showBulkAdd && (
        <div className="bg-white rounded-2xl border border-blue-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-600" />
                Créer une liste de contacts
              </h3>
              <p className="text-xs text-slate-500 mt-1">Les contacts déjà présents dans la liste sont automatiquement exclus.</p>
            </div>
            <button onClick={() => setShowBulkAdd(false)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="relative sm:col-span-2 lg:col-span-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={bulkSearch}
                  onChange={event => setBulkSearch(event.target.value)}
                  placeholder="Nom, entreprise, ville, email ou téléphone..."
                  className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <select value={bulkPays} onChange={event => setBulkPays(event.target.value)} className="px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                <option value="">Tous les pays</option>
                {paysOptions.map(pays => <option key={pays} value={pays}>{pays}</option>)}
              </select>
              <select value={bulkStatut} onChange={event => setBulkStatut(event.target.value)} className="px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                <option value="">Tous les statuts</option>
                {CONTACT_STATUSES.map(statut => <option key={statut} value={statut}>{statut}</option>)}
              </select>
              <select value={bulkSecteur} onChange={event => setBulkSecteur(event.target.value)} className="px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                <option value="">Tous les secteurs</option>
                {secteurOptions.map(secteur => <option key={secteur} value={secteur}>{secteur}</option>)}
              </select>
              <select value={bulkTag} onChange={event => setBulkTag(event.target.value)} className="px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                <option value="">Tous les tags</option>
                {tagOptions.map(tag => <option key={tag} value={tag}>{tag}</option>)}
              </select>
              <select value={bulkLastContact} onChange={event => setBulkLastContact(event.target.value as LastContactFilter)} className="px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                <option value="all">Toute dernière interaction</option>
                <option value="never">Jamais contactés</option>
                <option value="today">Contactés aujourd'hui</option>
                <option value="not_today">Non contactés aujourd'hui</option>
                <option value="over_7_days">Non contactés depuis 7 jours</option>
                <option value="over_30_days">Non contactés depuis 30 jours</option>
              </select>
              <select value={bulkPhone} onChange={event => setBulkPhone(event.target.value as PhoneFilter)} className="px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                <option value="with_phone">Avec un téléphone</option>
                <option value="mobile">Portable uniquement</option>
                <option value="all">Avec ou sans téléphone</option>
              </select>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-sm text-slate-600">
                <span className="font-bold text-slate-900">{bulkMatches.length}</span> résultat{bulkMatches.length > 1 ? 's' : ''} · <span className="font-semibold text-blue-700">{bulkSelected.size} sélectionné{bulkSelected.size > 1 ? 's' : ''}</span>
              </p>
              <button onClick={resetBulkFilters} className="text-xs text-slate-500 hover:text-blue-700">Réinitialiser les filtres</button>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <label className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={bulkMatches.length > 0 && bulkSelected.size === bulkMatches.length}
                  onChange={event => setBulkSelected(event.target.checked ? new Set(bulkMatches.map(contact => contact.id)) : new Set())}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Tout sélectionner</span>
              </label>
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                {bulkMatches.length === 0 ? (
                  <div className="py-10 text-center text-sm text-slate-400">Aucun contact ne correspond à ces filtres.</div>
                ) : bulkMatches.map(contact => (
                  <label key={contact.id} className="flex items-center gap-3 px-4 py-3 hover:bg-blue-50/50 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={bulkSelected.has(contact.id)}
                      onChange={() => toggleBulkContact(contact.id)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{contact.prenom} {contact.nom}</p>
                      <p className="text-xs text-slate-500 truncate">{[contact.entreprise, contact.telephone].filter(Boolean).join(' · ') || 'Aucune coordonnée'}</p>
                    </div>
                    <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
                      {contact.secteur_activite && <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-xs">{contact.secteur_activite}</span>}
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs">{contact.statut}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {bulkError && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{bulkError}</p>}

            <div className="flex flex-col-reverse sm:flex-row gap-3">
              <button onClick={() => setShowBulkAdd(false)} className="sm:flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm hover:bg-slate-50 transition-colors">Annuler</button>
              <button
                onClick={addFilteredContacts}
                disabled={bulkSelected.size === 0 || bulkAdding}
                className="sm:flex-[2] flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bulkAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                Ajouter {bulkSelected.size} contact{bulkSelected.size > 1 ? 's' : ''} à la liste
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add contact panel */}
      {showAdd && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          <h3 className="font-semibold text-slate-900 text-sm">Ajouter à la liste d'appels</h3>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Contact</label>
            <ContactSearchSelect contacts={contacts} value={addContactId} onChange={setAddContactId} required />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Note de préparation (optionnel)</label>
            <textarea
              value={addNotes}
              onChange={e => setAddNotes(e.target.value)}
              rows={2}
              placeholder="Ex : Rappel devis envoyé le 20/05, mentionner la promo..."
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
            />
          </div>
          <div className="flex gap-3">
            <button onClick={() => { setShowAdd(false); setAddContactId(''); setAddNotes(''); }} className="flex-1 px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-sm hover:bg-slate-50 transition-colors">Annuler</button>
            <button onClick={addContact} disabled={!addContactId} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50">Ajouter</button>
          </div>
        </div>
      )}

      {/* Active call banner */}
      {activeCallId && activeItem && (
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl p-5 text-white shadow-lg shadow-emerald-500/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                <Phone className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <p className="text-emerald-100 text-xs font-semibold uppercase tracking-wider mb-0.5">Appel en cours</p>
                <p className="text-xl font-bold leading-tight">
                  {activeItem.contact?.prenom} {activeItem.contact?.nom}
                </p>
                {activeItem.contact?.entreprise && (
                  <p className="text-emerald-200 text-sm">{activeItem.contact.entreprise}</p>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="text-4xl font-bold font-mono tracking-widest">{fmtChrono(elapsed)}</p>
              <button
                onClick={() => stopCall(activeItem)}
                className="mt-2 flex items-center gap-2 px-4 py-2 bg-white text-emerald-700 rounded-xl text-sm font-semibold hover:bg-emerald-50 transition-colors"
              >
                <Square className="w-4 h-4" />
                Terminer & noter
              </button>
            </div>
          </div>
          {activeItem.notes_prep && (
            <div className="mt-4 pt-4 border-t border-white/20">
              <p className="text-xs font-semibold text-emerald-200 uppercase tracking-wider mb-1">Préparation</p>
              <p className="text-sm text-emerald-100">{activeItem.notes_prep}</p>
            </div>
          )}
        </div>
      )}

      {/* Search */}
      {liste.length > 3 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Rechercher dans la liste..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white shadow-sm"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          )}
        </div>
      )}

      {/* List */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center py-20 text-center px-6">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
            <Phone className="w-8 h-8 text-slate-300" />
          </div>
          <p className="text-slate-600 font-semibold">Aucun appel programmé</p>
          <p className="text-slate-400 text-sm mt-1">Ajoutez des contacts à appeler ci-dessus</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item, idx) => {
            const c = item.contact;
            const isActive = item.id === activeCallId;
            const initials = c ? `${c.prenom?.[0] || ''}${c.nom?.[0] || ''}`.toUpperCase() : '?';
            return (
              <div
                key={item.id}
                className={`bg-white rounded-2xl border transition-all ${
                  isActive
                    ? 'border-emerald-300 shadow-md shadow-emerald-100'
                    : 'border-slate-200 shadow-sm hover:border-slate-300'
                }`}
              >
                <div className="p-4 flex items-center gap-4">
                  {/* Position */}
                  <div className="flex flex-col gap-0.5 flex-shrink-0">
                    <button
                      onClick={() => moveItem(item.id, 'up')}
                      disabled={!canModify || idx === 0 || !!activeCallId}
                      className="p-0.5 text-slate-300 hover:text-slate-600 disabled:opacity-20 transition-colors"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-xs font-bold text-slate-400 text-center leading-none">{idx + 1}</span>
                    <button
                      onClick={() => moveItem(item.id, 'down')}
                      disabled={!canModify || idx === filtered.length - 1 || !!activeCallId}
                      className="p-0.5 text-slate-300 hover:text-slate-600 disabled:opacity-20 transition-colors"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Avatar */}
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${
                    isActive ? 'bg-emerald-600' : 'bg-blue-600'
                  }`}>
                    {initials}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => c && onOpenContact && onOpenContact(c.id)}
                        className="font-semibold text-slate-900 text-sm hover:text-blue-600 transition-colors"
                      >
                        {c?.prenom} {c?.nom}
                      </button>
                      {isActive && (
                        <span className="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-semibold animate-pulse">
                          En appel
                        </span>
                      )}
                    </div>
                    {c?.entreprise && <p className="text-xs text-slate-500">{c.entreprise}</p>}
                    {c?.telephone && (
                      <p className="text-xs text-slate-400 font-mono mt-0.5">{c.telephone}</p>
                    )}
                    {item.notes_prep && !isActive && (
                      editNoteId === item.id ? (
                        <div className="flex items-center gap-2 mt-1.5">
                          <input
                            autoFocus
                            value={editNoteVal}
                            onChange={e => setEditNoteVal(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveNote(item.id); if (e.key === 'Escape') setEditNoteId(null); }}
                            className="flex-1 text-xs px-2 py-1 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                          />
                          <button onClick={() => saveNote(item.id)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-lg"><Check className="w-3 h-3" /></button>
                          <button onClick={() => setEditNoteId(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded-lg"><X className="w-3 h-3" /></button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditNoteId(item.id); setEditNoteVal(item.notes_prep); }}
                          className="text-xs text-slate-400 italic mt-0.5 text-left hover:text-slate-600 transition-colors truncate max-w-full block"
                        >
                          {item.notes_prep}
                        </button>
                      )
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isActive ? (
                      <button
                        onClick={() => stopCall(item)}
                        className="flex items-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm"
                      >
                        <Square className="w-3.5 h-3.5" />
                        Terminer
                      </button>
                    ) : (
                      <button
                        onClick={() => startCall(item)}
                        disabled={!canModify || !!activeCallId}
                        className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Appeler
                      </button>
                    )}
                    {canModify && <button
                      onClick={() => markDone(item)}
                      disabled={isActive}
                      className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors disabled:opacity-30"
                      title="Marquer comme traité"
                    >
                      <Check className="w-4 h-4" />
                    </button>}
                    {canDelete && <button
                      onClick={() => removeItem(item.id)}
                      disabled={isActive}
                      className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors disabled:opacity-30"
                      title="Retirer de la liste"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Quick interaction modal (after call end) */}
      {quickModalItem && quickModalItem.contact && (
        <QuickInteractionModal
          contact={quickModalItem.contact}
          initialDuration={Math.round(elapsed / 60)}
          initialType="Appel"
          onClose={() => { setQuickModalItem(null); setElapsed(0); }}
          onSaved={async () => {
            await markDone(quickModalItem);
            setQuickModalItem(null);
            setElapsed(0);
          }}
        />
      )}
    </div>
  );
}
