import { useState, useEffect } from 'react';
import { X, Phone, Mail, MessageCircle, Clock, Check, Plus, Sparkles, ChevronDown, Send, FileText } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Contact, Interaction, Template } from '../types/database';

const TYPES = ['Appel', 'Email', 'WhatsApp', 'SMS', 'Facebook', 'Instagram'] as const;
const RESULTATS = ['Pas de réponse', 'Répondu', 'Intéressé', 'Non intéressé', 'Relance'] as const;

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'Appel': Phone,
  'Email': Mail,
  'WhatsApp': MessageCircle,
  'SMS': MessageCircle,
  'Facebook': MessageCircle,
  'Instagram': MessageCircle,
};

function aiSuggestTask(resultat: string, notes: string, contact: Contact): string {
  const n = notes.toLowerCase();
  const name = `${contact.prenom} ${contact.nom}`;

  if (resultat === 'Intéressé') {
    if (n.includes('devis') || n.includes('prix') || n.includes('tarif')) return `Envoyer un devis personnalisé à ${name}`;
    if (n.includes('rdv') || n.includes('rendez-vous') || n.includes('rappel')) return `Confirmer le rendez-vous avec ${name}`;
    if (n.includes('site') || n.includes('web')) return `Préparer une proposition site web pour ${name}`;
    return `Envoyer une proposition commerciale à ${name}`;
  }
  if (resultat === 'Relance') {
    if (n.includes('semaine') || n.includes('lundi') || n.includes('vendredi')) return `Relancer ${name} en fin de semaine`;
    return `Relancer ${name} dans 3 jours`;
  }
  if (resultat === 'Pas de réponse') {
    return `Retenter l'appel de ${name} (pas de réponse)`;
  }
  if (resultat === 'Répondu') {
    if (n.includes('email') || n.includes('mail') || n.includes('envoyer')) return `Envoyer l'email de suivi à ${name}`;
    return `Faire un suivi avec ${name}`;
  }
  if (resultat === 'Non intéressé') {
    return `Archiver ${name} et noter la raison du refus`;
  }
  if (notes.trim()) {
    return `Faire le suivi suite à l'échange avec ${name}`;
  }
  return `Rappeler ${name}`;
}

function replaceVariables(content: string, contact: Contact): string {
  return content
    .replace(/\{prenom\}/g, contact.prenom || '')
    .replace(/\{nom\}/g, contact.nom || '')
    .replace(/\{entreprise\}/g, contact.entreprise || '')
    .replace(/\{email\}/g, contact.email || '')
    .replace(/\{telephone\}/g, contact.telephone || '');
}

type Props = {
  contact: Contact;
  initialDuration?: number;
  initialType?: Interaction['type'];
  onClose: () => void;
  onSaved: () => void;
};

export default function QuickInteractionModal({ contact, initialDuration = 0, initialType = 'Appel', onClose, onSaved }: Props) {
  const today = new Date();
  const defaultEcheance = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [type, setType] = useState<Interaction['type']>(initialType);
  const [resultat, setResultat] = useState<Interaction['resultat']>('');
  const [notes, setNotes] = useState('');
  const [duree, setDuree] = useState(initialDuration);
  const [addTask, setAddTask] = useState(false);
  const [taskTitre, setTaskTitre] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskEcheance, setTaskEcheance] = useState(defaultEcheance);
  const [aiSuggestion, setAiSuggestion] = useState('');
  const [showAi, setShowAi] = useState(false);
  const [saving, setSaving] = useState(false);

  // Quick send email state
  const [emailTemplates, setEmailTemplates] = useState<Template[]>([]);
  const [showEmailPanel, setShowEmailPanel] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('templates').select('*').eq('type', 'Email').order('titre').then(({ data }) => {
      setEmailTemplates(data || []);
    });
  }, []);

  const handleResultatChange = (r: Interaction['resultat']) => {
    setResultat(r);
    if (r) {
      const suggestion = aiSuggestTask(r, notes, contact);
      setAiSuggestion(suggestion);
      setShowAi(true);
      setAddTask(true);
      setTaskTitre(suggestion);
    }
  };

  const handleNotesChange = (v: string) => {
    setNotes(v);
    if (resultat) {
      const suggestion = aiSuggestTask(resultat, v, contact);
      setAiSuggestion(suggestion);
      if (showAi) setTaskTitre(suggestion);
    }
  };

  const acceptAiSuggestion = () => {
    setTaskTitre(aiSuggestion);
    setAddTask(true);
    setShowAi(false);
  };

  const handleQuickSendEmail = async (template: Template) => {
    if (!contact.email) {
      setEmailSent('Pas d\'email pour ce contact');
      return;
    }
    setSendingEmail(true);
    setSelectedTemplate(template);
    try {
      const html = replaceVariables(template.contenu, contact);
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
          to: contact.email,
          subject: template.objet || template.titre,
          html: isHtml ? html : `<div style="font-family:sans-serif;white-space:pre-wrap;">${html}</div>`,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setEmailSent('sent');
        setType('Email');
        setNotes((prev) => prev ? `${prev}\n[Email envoye: ${template.titre}]` : `[Email envoye: ${template.titre}]`);
        // Auto-log the interaction
        await supabase.from('interactions').insert([{
          contact_id: contact.id,
          type: 'Email',
          date_heure: new Date().toISOString(),
          duree: 0,
          resultat: '',
          notes: `Email envoye depuis template: ${template.titre}`,
        }]);
        await supabase.from('contacts').update({ derniere_interaction: new Date().toISOString() }).eq('id', contact.id);
      } else {
        setEmailSent(data.error || 'Erreur envoi');
      }
    } catch (err) {
      setEmailSent((err as Error).message);
    } finally {
      setSendingEmail(false);
      setTimeout(() => setEmailSent(null), 4000);
    }
  };

  const handleSave = async () => {
    if (!notes.trim() && !resultat) return;
    setSaving(true);
    try {
      await supabase.from('interactions').insert([{
        contact_id: contact.id,
        type,
        date_heure: new Date().toISOString(),
        duree,
        resultat: resultat || '',
        notes: notes.trim(),
      }]);

      await supabase.from('contacts').update({ derniere_interaction: new Date().toISOString() }).eq('id', contact.id);

      if (addTask && taskTitre.trim()) {
        await supabase.from('taches').insert([{
          contact_id: contact.id,
          titre: taskTitre.trim(),
          description: taskDesc.trim(),
          date_echeance: taskEcheance || null,
          statut: 'En attente',
        }]);
      }

      onSaved();
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const initials = `${contact.prenom?.[0] || ''}${contact.nom?.[0] || ''}`.toUpperCase();

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
              {initials}
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 leading-tight">Note d'interaction</h2>
              <p className="text-xs text-slate-500">{contact.prenom} {contact.nom} · {contact.entreprise}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Quick Email Send */}
          {contact.email && emailTemplates.length > 0 && (
            <div className="border border-blue-200 rounded-xl overflow-hidden bg-blue-50/30">
              <button
                onClick={() => setShowEmailPanel(o => !o)}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-blue-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Send className={`w-4 h-4 ${showEmailPanel ? 'text-blue-600' : 'text-blue-500'}`} />
                  <span className="text-sm font-semibold text-blue-800">Envoyer un email (1 clic)</span>
                </div>
                <ChevronDown className={`w-4 h-4 text-blue-400 transition-transform ${showEmailPanel ? 'rotate-180' : ''}`} />
              </button>
              {showEmailPanel && (
                <div className="px-4 pb-3 pt-1 border-t border-blue-100 space-y-2">
                  {emailSent && (
                    <div className={`text-xs px-3 py-2 rounded-lg font-medium ${emailSent === 'sent' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                      {emailSent === 'sent' ? 'Email envoye avec succes !' : emailSent}
                    </div>
                  )}
                  <p className="text-xs text-blue-600">Choisissez un template pour envoyer instantanement a {contact.email}</p>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {emailTemplates.map(t => (
                      <button
                        key={t.id}
                        onClick={() => handleQuickSendEmail(t)}
                        disabled={sendingEmail}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-left transition-all ${
                          selectedTemplate?.id === t.id && sendingEmail
                            ? 'border-blue-300 bg-blue-50'
                            : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50'
                        } disabled:opacity-50`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                          <span className="text-xs font-medium text-slate-800 truncate">{t.titre}</span>
                        </div>
                        {selectedTemplate?.id === t.id && sendingEmail ? (
                          <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                        ) : (
                          <Send className="w-3 h-3 text-slate-400 flex-shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Type */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Type</label>
            <div className="flex flex-wrap gap-2">
              {TYPES.map(t => {
                const Icon = TYPE_ICONS[t] || MessageCircle;
                return (
                  <button
                    key={t}
                    onClick={() => setType(t)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
                      type === t
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />{t}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Duration */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-slate-500">
              <Clock className="w-4 h-4" />
              <span className="text-xs font-semibold uppercase tracking-wide">Duree</span>
            </div>
            <input
              type="number"
              min="0"
              value={duree}
              onChange={e => setDuree(parseInt(e.target.value) || 0)}
              className="w-20 px-3 py-1.5 border border-slate-200 rounded-xl text-sm text-center focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <span className="text-sm text-slate-500">min</span>
          </div>

          {/* Result */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Resultat</label>
            <div className="flex flex-wrap gap-2">
              {RESULTATS.map(r => (
                <button
                  key={r}
                  onClick={() => handleResultatChange(resultat === r ? '' : r as Interaction['resultat'])}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
                    resultat === r
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Notes</label>
            <textarea
              value={notes}
              onChange={e => handleNotesChange(e.target.value)}
              rows={3}
              placeholder={`Resume de l'echange avec ${contact.prenom}...`}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none leading-relaxed"
            />
          </div>

          {/* AI suggestion banner */}
          {showAi && aiSuggestion && (
            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <div className="w-7 h-7 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-4 h-4 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-1">Suggestion de tache</p>
                <p className="text-sm text-amber-800 leading-snug">{aiSuggestion}</p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={acceptAiSuggestion}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700 transition-colors"
                >
                  <Check className="w-3 h-3" /> Ajouter
                </button>
                <button
                  onClick={() => setShowAi(false)}
                  className="p-1.5 text-amber-500 hover:bg-amber-100 rounded-lg transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Task section */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setAddTask(o => !o)}
              className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Plus className={`w-4 h-4 transition-transform ${addTask ? 'rotate-45 text-red-500' : 'text-slate-500'}`} />
                <span className="text-sm font-semibold text-slate-700">
                  {addTask ? 'Retirer la tache' : 'Ajouter une tache de suivi'}
                </span>
              </div>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${addTask ? 'rotate-180' : ''}`} />
            </button>

            {addTask && (
              <div className="p-4 space-y-3 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Titre de la tache *</label>
                  <input
                    type="text"
                    value={taskTitre}
                    onChange={e => setTaskTitre(e.target.value)}
                    placeholder="Ex : Envoyer un devis..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Description (optionnel)</label>
                  <input
                    type="text"
                    value={taskDesc}
                    onChange={e => setTaskDesc(e.target.value)}
                    placeholder="Details supplementaires..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Echeance</label>
                  <input
                    type="date"
                    value={taskEcheance}
                    onChange={e => setTaskEcheance(e.target.value)}
                    className="px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={saving || (!notes.trim() && !resultat)}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-semibold transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
              Enregistrer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
