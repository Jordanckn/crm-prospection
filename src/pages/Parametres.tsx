import { useEffect, useState } from 'react';
import { Target, Save, Brain, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Objectif } from '../types/database';

const AI_MODELS = [
  { id: 'openai/gpt-4o', label: 'GPT-4o (recommande)', desc: 'Excellent rapport qualite/prix, ideal pour la reecriture' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini', desc: 'Tres economique, bonne qualite' },
  { id: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku', desc: 'Rapide et economique' },
  { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', desc: 'Haute qualite, plus couteux' },
  { id: 'mistralai/mistral-large-latest', label: 'Mistral Large', desc: 'Bon en francais, bon rapport qualite/prix' },
  { id: 'google/gemini-pro-1.5', label: 'Gemini Pro 1.5', desc: 'Polyvalent, bonne qualite' },
];

export default function Parametres() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [objectif, setObjectif] = useState<Objectif | null>(null);
  const [formData, setFormData] = useState({
    appels_objectif: 50,
    messages_objectif: 30,
  });

  // AI settings
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [aiModel, setAiModel] = useState('openai/gpt-4o');
  const [savingAi, setSavingAi] = useState(false);
  const [aiSaved, setAiSaved] = useState(false);

  useEffect(() => {
    loadObjectif();
    loadAiSettings();
  }, []);

  const loadObjectif = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const aujourdhui = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('objectifs')
        .select('*')
        .eq('date', aujourdhui)
        .eq('user_id', user.id)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      if (data) {
        setObjectif(data);
        setFormData({ appels_objectif: data.appels_objectif, messages_objectif: data.messages_objectif });
      }
    } catch (error) { console.error('Erreur:', error); }
    finally { setLoading(false); }
  };

  const loadAiSettings = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('app_settings')
        .select('cle, valeur')
        .eq('user_id', user.id)
        .in('cle', ['openrouter_api_key', 'ai_model']);
      if (data) {
        for (const row of data) {
          if (row.cle === 'openrouter_api_key') setOpenrouterKey(row.valeur);
          if (row.cle === 'ai_model') setAiModel(row.valeur);
        }
      }
    } catch (err) { console.error(err); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const aujourdhui = new Date().toISOString().split('T')[0];
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      if (objectif) {
        await supabase.from('objectifs').update(formData).eq('id', objectif.id);
      } else {
        await supabase.from('objectifs').insert([{ ...formData, date: aujourdhui, user_id: user.id }]);
      }
      await loadObjectif();
    } catch (error) { console.error('Erreur:', error); }
    finally { setSaving(false); }
  };

  const handleSaveAi = async () => {
    setSavingAi(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const upsertSetting = async (cle: string, valeur: string) => {
        const { data: existing } = await supabase
          .from('app_settings')
          .select('id')
          .eq('user_id', user.id)
          .eq('cle', cle)
          .maybeSingle();
        if (existing) {
          await supabase.from('app_settings').update({ valeur, updated_at: new Date().toISOString() }).eq('id', existing.id);
        } else {
          await supabase.from('app_settings').insert([{ user_id: user.id, cle, valeur }]);
        }
      };

      await upsertSetting('openrouter_api_key', openrouterKey);
      await upsertSetting('ai_model', aiModel);
      setAiSaved(true);
      setTimeout(() => setAiSaved(false), 2000);
    } catch (err) { console.error(err); }
    finally { setSavingAi(false); }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Parametres</h1>
        <p className="text-sm text-slate-500 mt-0.5">Configurez vos objectifs et integrations</p>
      </div>

      {/* AI Configuration */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 bg-gradient-to-br from-violet-500 to-blue-600 rounded-xl flex items-center justify-center">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Intelligence Artificielle</h2>
            <p className="text-xs text-slate-500">Configuration OpenRouter pour la reecriture des emails de sequence</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wide">Cle API OpenRouter *</label>
            <input
              type="password"
              value={openrouterKey}
              onChange={e => setOpenrouterKey(e.target.value)}
              placeholder="sk-or-v1-..."
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Obtenez votre cle sur <span className="font-semibold text-blue-600">openrouter.ai/keys</span> - Necessite un compte OpenRouter
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wide">Modele IA</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {AI_MODELS.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setAiModel(m.id)}
                  className={`text-left px-3 py-2.5 rounded-xl border transition-all ${
                    aiModel === m.id
                      ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-100'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <p className={`text-xs font-semibold ${aiModel === m.id ? 'text-blue-800' : 'text-slate-800'}`}>{m.label}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{m.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-xs text-amber-800 font-medium leading-relaxed">
              L'IA reecrit chaque email de sequence en gardant le meme sens mais en variant le texte.
              Cela empeche Gmail/Outlook de detecter un pattern de sequencage et evite les spams.
              GPT-4o est recommande : rapide, bon en francais, et economique (~$0.003 par email reecrit).
            </p>
          </div>

          <button
            onClick={handleSaveAi}
            disabled={savingAi || !openrouterKey}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-semibold transition-colors shadow-sm disabled:opacity-50"
          >
            {aiSaved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {aiSaved ? 'Sauvegarde !' : savingAi ? 'Sauvegarde...' : 'Sauvegarder la config IA'}
          </button>
        </div>
      </div>

      {/* Objectifs */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 bg-blue-100 rounded-xl flex items-center justify-center">
            <Target className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Objectifs du jour</h2>
            <p className="text-xs text-slate-500">Definissez vos objectifs d'activite quotidienne</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wide">Appels / jour</label>
              <input
                type="number"
                min="0"
                required
                value={formData.appels_objectif}
                onChange={(e) => setFormData({ ...formData, appels_objectif: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wide">Messages / jour</label>
              <input
                type="number"
                min="0"
                required
                value={formData.messages_objectif}
                onChange={(e) => setFormData({ ...formData, messages_objectif: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between">
            <span className="text-sm text-slate-600">Total interactions cible</span>
            <span className="text-lg font-bold text-slate-900">{formData.appels_objectif + formData.messages_objectif}</span>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-semibold transition-colors shadow-sm disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Sauvegarde...' : 'Sauvegarder les objectifs'}
          </button>
        </form>
      </div>
    </div>
  );
}
