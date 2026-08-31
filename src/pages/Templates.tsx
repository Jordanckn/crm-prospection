import { useEffect, useState } from 'react';
import { Plus, X, CreditCard as Edit, Trash2, Mail, MessageCircle, Phone, FileText, Copy, Eye, Send, Code, Type, Check, AlertTriangle, Zap, Paperclip } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Template, ScriptPhoning, Contact } from '../types/database';
import EmailSequences from '../components/EmailSequences';
import { usePermissions } from '../contexts/PermissionsContext';
import { useBrand } from '../contexts/BrandContext';

const TYPES = ['Email', 'WhatsApp', 'SMS'] as const;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const separatorIndex = result.indexOf(',');
      if (separatorIndex === -1) reject(new Error('Impossible de lire la pièce jointe.'));
      else resolve(result.slice(separatorIndex + 1));
    };
    reader.onerror = () => reject(new Error('Impossible de lire la pièce jointe.'));
    reader.readAsDataURL(file);
  });
}

function getTypeIcon(type: string) {
  switch (type) {
    case 'Email': return Mail;
    case 'WhatsApp': return MessageCircle;
    case 'SMS': return MessageCircle;
    default: return Mail;
  }
}

function getTypeColor(type: string) {
  switch (type) {
    case 'Email': return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'WhatsApp': return 'bg-green-100 text-green-700 border-green-200';
    case 'SMS': return 'bg-orange-100 text-orange-700 border-orange-200';
    default: return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

function replaceVariables(content: string, vars: Record<string, string>): string {
  return content.replace(/\{(\w+)\}/g, (match, key) => vars[key] || match);
}

export default function Templates() {
  const { canModify, canDelete } = usePermissions();
  const { brand } = useBrand();
  const [mainTab, setMainTab] = useState<'templates' | 'sequences'>('templates');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [scripts, setScripts] = useState<ScriptPhoning[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showScriptModal, setShowScriptModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [editingScript, setEditingScript] = useState<ScriptPhoning | null>(null);
  const [filterType, setFilterType] = useState<string>('');
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  const [previewMode, setPreviewMode] = useState<'rendered' | 'source'>('rendered');
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendSubject, setSendSubject] = useState('');
  const [sendContactId, setSendContactId] = useState('');
  const [sendAttachment, setSendAttachment] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; message: string } | null>(null);
  const [emailSenders, setEmailSenders] = useState<Array<{ code: string; country: string; from_name: string; from_email: string }>>([]);
  const [sendSenderCode, setSendSenderCode] = useState('');

  const [templateForm, setTemplateForm] = useState({
    titre: '',
    objet: '',
    type: 'Email' as Template['type'],
    contenu: '',
    variables: [] as string[],
  });

  const [scriptForm, setScriptForm] = useState({
    titre: '',
    contenu: '',
    actif: false,
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [templatesRes, scriptsRes, contactsRes, sendersRes] = await Promise.all([
        supabase.from('templates').select('*').order('created_at', { ascending: false }),
        supabase.from('scripts_phoning').select('*').order('created_at', { ascending: false }),
        supabase.from('contacts').select('*').order('nom', { ascending: true }),
        supabase.from('brand_email_senders').select('code, country, from_name, from_email').eq('active', true).order('country'),
      ]);
      setTemplates(templatesRes.data || []);
      setScripts(scriptsRes.data || []);
      setContacts(contactsRes.data || []);
      const availableSenders = sendersRes.data || [];
      setEmailSenders(availableSenders);
      setSendSenderCode(current => current || availableSenders.find(sender => sender.country === 'France')?.code || availableSenders[0]?.code || '');
    } catch (error) { console.error(error); }
    finally { setLoading(false); }
  };

  const resetTemplateForm = () => {
    setTemplateForm({ titre: '', objet: '', type: 'Email', contenu: '', variables: [] });
    setEditingTemplate(null);
  };

  const resetScriptForm = () => {
    setScriptForm({ titre: '', contenu: '', actif: false });
    setEditingScript(null);
  };

  const handleTemplateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const vars = [...new Set((templateForm.contenu.match(/\{(\w+)\}/g) || []).map(v => v.slice(1, -1)))];
      const payload = { ...templateForm, variables: vars };
      if (editingTemplate) {
        await supabase.from('templates').update(payload).eq('id', editingTemplate.id);
      } else {
        await supabase.from('templates').insert([payload]);
      }
      setShowTemplateModal(false);
      resetTemplateForm();
      loadData();
    } catch (error) { console.error(error); }
  };

  const handleScriptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingScript) {
        await supabase.from('scripts_phoning').update(scriptForm).eq('id', editingScript.id);
      } else {
        await supabase.from('scripts_phoning').insert([scriptForm]);
      }
      setShowScriptModal(false);
      resetScriptForm();
      loadData();
    } catch (error) { console.error(error); }
  };

  const handleEditTemplate = (template: Template) => {
    setEditingTemplate(template);
    setTemplateForm({ titre: template.titre, objet: template.objet || template.titre, type: template.type, contenu: template.contenu, variables: template.variables });
    setShowTemplateModal(true);
  };

  const handleEditScript = (script: ScriptPhoning) => {
    setEditingScript(script);
    setScriptForm({ titre: script.titre, contenu: script.contenu, actif: script.actif });
    setShowScriptModal(true);
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm('Supprimer ce template ?')) return;
    await supabase.from('templates').delete().eq('id', id);
    if (previewTemplate?.id === id) setPreviewTemplate(null);
    loadData();
  };

  const handleDeleteScript = async (id: string) => {
    if (!confirm('Supprimer ce script ?')) return;
    await supabase.from('scripts_phoning').delete().eq('id', id);
    loadData();
  };

  const toggleScriptActif = async (script: ScriptPhoning) => {
    await supabase.from('scripts_phoning').update({ actif: !script.actif }).eq('id', script.id);
    loadData();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const openSendModal = (template: Template) => {
    setPreviewTemplate(template);
    setSendSubject(template.objet || template.titre);
    setSendTo('');
    setSendContactId('');
    setSendAttachment(null);
    setSendSenderCode(current => current || emailSenders.find(sender => sender.country === 'France')?.code || emailSenders[0]?.code || '');
    setSendResult(null);
    setShowSendModal(true);
  };

  const getPreviewVariables = (): Record<string, string> => {
    if (sendContactId) {
      const c = contacts.find(ct => ct.id === sendContactId);
      if (c) return { prenom: c.prenom, nom: c.nom, entreprise: c.entreprise || '', email: c.email, telephone: c.telephone };
    }
    return { prenom: 'Jean', nom: 'Dupont', entreprise: 'Acme Corp', email: 'jean@exemple.com', telephone: '06 12 34 56 78' };
  };

  const handleSendEmail = async () => {
    if (!previewTemplate || !sendTo) return;
    if (brand.code === 'epiderme_ai' && !sendSenderCode) {
      setSendResult({ success: false, message: "Choisissez l'expéditeur France ou Israël avant l'envoi." });
      return;
    }
    setSending(true);
    setSendResult(null);
    try {
      const vars = getPreviewVariables();
      const html = replaceVariables(previewTemplate.contenu, vars);
      const isHtml = /<[a-z][\s\S]*>/i.test(html);

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`;
      const { data: { session } } = await supabase.auth.getSession();
      const attachment = sendAttachment ? {
        filename: sendAttachment.name,
        contentType: sendAttachment.type || 'application/octet-stream',
        contentBase64: await fileToBase64(sendAttachment),
      } : undefined;

      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          brand_code: brand.code,
          to: sendTo,
          subject: sendSubject,
          html: isHtml ? html : `<div style="font-family:sans-serif;white-space:pre-wrap;">${html}</div>`,
          text: isHtml ? undefined : html,
          attachment,
          contact_id: sendContactId || undefined,
          sender_code: brand.code === 'epiderme_ai' ? sendSenderCode : undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSendResult({ success: true, message: `Email envoyé avec succès depuis ${data.sender?.name || brand.name} <${data.sender?.email || brand.from_email}>.` });
      } else {
        setSendResult({ success: false, message: data.error || 'Erreur lors de l\'envoi' });
      }
    } catch (err) {
      setSendResult({ success: false, message: (err as Error).message });
    } finally {
      setSending(false);
    }
  };

  const filteredTemplates = filterType ? templates.filter(t => t.type === filterType) : templates;

  const handleContactSelect = (id: string) => {
    setSendContactId(id);
    const c = contacts.find(ct => ct.id === id);
    if (c && c.email) {
      setSendTo(c.email);
      if (brand.code === 'epiderme_ai') {
        const senderCountry = c.pays === 'Israël' ? 'Israël' : 'France';
        setSendSenderCode(emailSenders.find(sender => sender.country === senderCountry)?.code || '');
      }
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Templates & Sequences</h1>
          <p className="text-sm text-slate-500 mt-0.5">Modeles de communication, scripts et sequences automatiques</p>
        </div>
        {mainTab === 'templates' && (
          <div className="flex gap-2">
            <button onClick={() => { resetScriptForm(); setShowScriptModal(true); }} className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors text-sm font-semibold shadow-sm">
              <Phone className="w-4 h-4" /> Nouveau script
            </button>
            <button onClick={() => { resetTemplateForm(); setShowTemplateModal(true); }} className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors text-sm font-semibold shadow-sm">
              <Plus className="w-4 h-4" /> Nouveau template
            </button>
          </div>
        )}
      </div>

      {/* Main tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => setMainTab('templates')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${mainTab === 'templates' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <FileText className="w-4 h-4" /> Templates & Scripts
        </button>
        <button
          onClick={() => setMainTab('sequences')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${mainTab === 'sequences' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <Zap className="w-4 h-4" /> Sequences auto
        </button>
      </div>

      {mainTab === 'sequences' ? (
        <EmailSequences />
      ) : (
      <>
      {/* Main content: templates left, preview right */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Templates column */}
        <div className="xl:col-span-2 space-y-4">
          {/* Filter tabs */}
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
            <button onClick={() => setFilterType('')}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${filterType === '' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >Tous ({templates.length})</button>
            {TYPES.map(type => (
              <button key={type} onClick={() => setFilterType(type)}
                className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${filterType === type ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >{type}</button>
            ))}
          </div>

          {/* Template list */}
          <div className="space-y-3 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
            {filteredTemplates.map(template => {
              const Icon = getTypeIcon(template.type);
              const isSelected = previewTemplate?.id === template.id;
              return (
                <div
                  key={template.id}
                  onClick={() => setPreviewTemplate(template)}
                  className={`bg-white rounded-xl border p-4 cursor-pointer transition-all ${isSelected ? 'border-blue-400 shadow-md ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-8 h-8 rounded-lg ${getTypeColor(template.type)} border flex items-center justify-center flex-shrink-0`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-sm text-slate-900 truncate">{template.titre}</h3>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${getTypeColor(template.type)}`}>{template.type}</span>
                      </div>
                    </div>
                    <div className="flex gap-0.5 flex-shrink-0">
                      <button onClick={e => { e.stopPropagation(); copyToClipboard(template.contenu); }} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors" title="Copier"><Copy className="w-3.5 h-3.5" /></button>
                      {template.type === 'Email' && (
                        <button onClick={e => { e.stopPropagation(); openSendModal(template); }} className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors" title="Envoyer"><Send className="w-3.5 h-3.5" /></button>
                      )}
                      {canModify && <button onClick={e => { e.stopPropagation(); handleEditTemplate(template); }} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Modifier"><Edit className="w-3.5 h-3.5" /></button>}
                      {canDelete && <button onClick={e => { e.stopPropagation(); handleDeleteTemplate(template.id); }} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Supprimer"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                  </div>
                  {template.type === 'Email' && (
                    <p className="mt-2 truncate text-xs text-slate-600"><span className="font-semibold">Objet :</span> {template.objet || template.titre}</p>
                  )}
                  <p className="text-xs text-slate-500 mt-2 line-clamp-2 leading-relaxed">{template.contenu.replace(/<[^>]*>/g, '').slice(0, 120)}</p>
                  {template.variables.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {template.variables.map(v => (
                        <span key={v} className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded font-mono">{'{' + v + '}'}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {filteredTemplates.length === 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                <FileText className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                <p className="text-slate-400 font-medium text-sm">Aucun template</p>
              </div>
            )}
          </div>

          {/* Scripts section below */}
          <div className="border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm text-slate-900">Scripts de phoning</h3>
            </div>
            <div className="space-y-2">
              {scripts.map(script => (
                <div key={script.id} className={`bg-white rounded-xl border p-3 transition-all ${script.actif ? 'border-emerald-300 bg-emerald-50/40' : 'border-slate-200'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <Phone className={`w-4 h-4 flex-shrink-0 ${script.actif ? 'text-emerald-600' : 'text-slate-400'}`} />
                      <span className="font-medium text-sm text-slate-900 truncate">{script.titre}</span>
                      {script.actif && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-bold flex-shrink-0">ACTIF</span>}
                    </div>
                    <div className="flex gap-0.5 flex-shrink-0">
                      {canModify && <button onClick={() => toggleScriptActif(script)} className={`p-1.5 rounded-lg transition-colors ${script.actif ? 'text-slate-500 hover:bg-slate-100' : 'text-emerald-500 hover:bg-emerald-50'}`} title={script.actif ? 'Desactiver' : 'Activer'}>
                        <Check className="w-3.5 h-3.5" />
                      </button>}
                      {canModify && <button onClick={() => handleEditScript(script)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><Edit className="w-3.5 h-3.5" /></button>}
                      {canDelete && <button onClick={() => handleDeleteScript(script.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                  </div>
                </div>
              ))}
              {scripts.length === 0 && <p className="text-xs text-slate-400 text-center py-4">Aucun script</p>}
            </div>
          </div>
        </div>

        {/* Preview column */}
        <div className="xl:col-span-3">
          {previewTemplate ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden sticky top-6">
              {/* Preview header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center gap-3">
                  <div className={`w-7 h-7 rounded-lg ${getTypeColor(previewTemplate.type)} border flex items-center justify-center`}>
                    {(() => { const Icon = getTypeIcon(previewTemplate.type); return <Icon className="w-3.5 h-3.5" />; })()}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-slate-900">{previewTemplate.titre}</h3>
                    <p className="text-xs text-slate-400">Previsualisation en direct</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex bg-slate-100 rounded-lg p-0.5">
                    <button
                      onClick={() => setPreviewMode('rendered')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${previewMode === 'rendered' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                    >
                      <Eye className="w-3 h-3" /> Apercu
                    </button>
                    <button
                      onClick={() => setPreviewMode('source')}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${previewMode === 'source' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                    >
                      <Code className="w-3 h-3" /> Source
                    </button>
                  </div>
                  {previewTemplate.type === 'Email' && (
                    <button
                      onClick={() => openSendModal(previewTemplate)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors shadow-sm"
                    >
                      <Send className="w-3 h-3" /> Envoyer
                    </button>
                  )}
                  <button onClick={() => setPreviewTemplate(null)} className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors">
                    <X className="w-4 h-4 text-slate-400" />
                  </button>
                </div>
              </div>

              {/* Preview body */}
              <div className="p-0">
                {previewMode === 'rendered' ? (
                  <div className="min-h-[400px] max-h-[60vh] overflow-auto">
                    {previewTemplate.type === 'Email' ? (
                      <div className="bg-slate-100 p-6">
                        {/* Email envelope */}
                        <div className="max-w-2xl mx-auto">
                          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            {/* Email header */}
                            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 space-y-1">
                              <div className="flex items-center gap-2 text-xs">
                                <span className="font-semibold text-slate-500 w-10">De :</span>
                                {brand.code === 'epiderme_ai' ? (
                                  <select
                                    value={sendSenderCode}
                                    onChange={event => setSendSenderCode(event.target.value)}
                                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                                    aria-label="Identité d’envoi utilisée pour la prévisualisation"
                                  >
                                    {emailSenders.map(sender => (
                                      <option key={sender.code} value={sender.code}>
                                        {sender.country === 'Israël' ? '🇮🇱 Epiderm AI' : '🇫🇷 Epiderme AI'} — {sender.from_email}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="text-slate-700">{brand.from_email}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-xs">
                                <span className="font-semibold text-slate-500 w-10">A :</span>
                                <span className="text-slate-700">{getPreviewVariables().email || 'destinataire@exemple.com'}</span>
                              </div>
                              <div className="flex items-center gap-2 text-xs">
                                <span className="font-semibold text-slate-500 w-10">Objet :</span>
                                <span className="font-semibold text-slate-900">{previewTemplate.objet || previewTemplate.titre}</span>
                              </div>
                            </div>
                            {/* Email body */}
                            <div className="p-6">
                              {/<[a-z][\s\S]*>/i.test(previewTemplate.contenu) ? (
                                <div dangerouslySetInnerHTML={{ __html: replaceVariables(previewTemplate.contenu, getPreviewVariables()) }} />
                              ) : (
                                <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                                  {replaceVariables(previewTemplate.contenu, getPreviewVariables())}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-6">
                        {/* SMS / WhatsApp bubble preview */}
                        <div className={`max-w-sm mx-auto rounded-2xl p-4 ${previewTemplate.type === 'WhatsApp' ? 'bg-emerald-50' : 'bg-orange-50'}`}>
                          <div className="flex items-center gap-2 mb-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${previewTemplate.type === 'WhatsApp' ? 'bg-emerald-500' : 'bg-orange-500'}`}>
                              W
                            </div>
                            <span className="font-semibold text-sm text-slate-900">WebFitYou</span>
                          </div>
                          <div className={`rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm ${previewTemplate.type === 'WhatsApp' ? 'bg-white' : 'bg-white'}`}>
                            <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
                              {replaceVariables(previewTemplate.contenu, getPreviewVariables())}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-2 text-right">
                              {new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-4">
                    <pre className="bg-slate-900 text-slate-100 p-5 rounded-xl overflow-auto max-h-[60vh] text-xs leading-relaxed font-mono">
                      {previewTemplate.contenu}
                    </pre>
                  </div>
                )}
              </div>

              {/* Variables bar */}
              {previewTemplate.variables.length > 0 && (
                <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Variables dynamiques</p>
                  <div className="flex flex-wrap gap-2">
                    {previewTemplate.variables.map(v => (
                      <div key={v} className="flex items-center gap-1.5 text-xs">
                        <span className="font-mono px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded border border-blue-200">{'{' + v + '}'}</span>
                        <span className="text-slate-400">=</span>
                        <span className="text-slate-700 font-medium">{getPreviewVariables()[v] || '...'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center py-24 px-6 text-center sticky top-6">
              <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
                <Eye className="w-8 h-8 text-slate-300" />
              </div>
              <p className="text-slate-600 font-semibold">Selectionnez un template</p>
              <p className="text-slate-400 text-sm mt-1">Cliquez sur un template a gauche pour voir son apercu ici</p>
            </div>
          )}
        </div>
      </div>

      {/* Template Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex justify-between items-center rounded-t-2xl z-10">
              <h2 className="text-lg font-bold text-slate-900">{editingTemplate ? 'Modifier le template' : 'Nouveau template'}</h2>
              <button onClick={() => { setShowTemplateModal(false); resetTemplateForm(); }} className="p-2 hover:bg-slate-100 rounded-xl transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleTemplateSubmit} className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Titre interne *</label>
                  <input required type="text" value={templateForm.titre} onChange={e => setTemplateForm({ ...templateForm, titre: e.target.value })} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Ex: Premier contact commercial" />
                  <p className="mt-1 text-[11px] text-slate-400">Visible uniquement dans le CRM pour retrouver le modèle.</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Type *</label>
                  <div className="flex gap-2">
                    {TYPES.map(type => {
                      const Icon = getTypeIcon(type);
                      return (
                        <button key={type} type="button" onClick={() => setTemplateForm({ ...templateForm, type })}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition-colors border ${templateForm.type === type ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'}`}
                        >
                          <Icon className="w-3.5 h-3.5" />{type}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              {templateForm.type === 'Email' && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Objet du mail *</label>
                  <input required type="text" value={templateForm.objet} onChange={e => setTemplateForm({ ...templateForm, objet: e.target.value })} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Ex: Une idée pour développer votre visibilité" />
                  <p className="mt-1 text-[11px] text-slate-400">C’est cet objet que le destinataire verra dans sa boîte mail.</p>
                </div>
              )}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Contenu *</label>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400">Supporte HTML pour les emails</span>
                    <Type className="w-3 h-3 text-slate-400" />
                  </div>
                </div>
                <textarea
                  required
                  value={templateForm.contenu}
                  onChange={e => setTemplateForm({ ...templateForm, contenu: e.target.value })}
                  rows={14}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none font-mono leading-relaxed"
                  placeholder={'Bonjour {prenom},\n\nJe me permets de vous contacter...\n\nOu en HTML :\n<h1>Bonjour {prenom}</h1>\n<p>Votre entreprise {entreprise}...</p>'}
                />
                <p className="text-xs text-slate-400 mt-1.5">Variables : {'{prenom}'}, {'{nom}'}, {'{entreprise}'}, {'{email}'}, {'{telephone}'}</p>
              </div>
              {/* Live mini-preview */}
              {templateForm.contenu && templateForm.type === 'Email' && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                    <Eye className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-xs font-semibold text-slate-600">Apercu en direct</span>
                  </div>
                  <div className="p-4 max-h-48 overflow-auto bg-white">
                    {/<[a-z][\s\S]*>/i.test(templateForm.contenu) ? (
                      <div className="text-sm" dangerouslySetInnerHTML={{ __html: replaceVariables(templateForm.contenu, { prenom: 'Jean', nom: 'Dupont', entreprise: 'Acme Corp', email: 'jean@exemple.com', telephone: '06 12 34 56 78' }) }} />
                    ) : (
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{replaceVariables(templateForm.contenu, { prenom: 'Jean', nom: 'Dupont', entreprise: 'Acme Corp', email: 'jean@exemple.com', telephone: '06 12 34 56 78' })}</p>
                    )}
                  </div>
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => { setShowTemplateModal(false); resetTemplateForm(); }} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium transition-colors">Annuler</button>
                <button type="submit" className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-semibold transition-colors shadow-sm">{editingTemplate ? 'Enregistrer' : 'Creer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Script Modal */}
      {showScriptModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex justify-between items-center rounded-t-2xl z-10">
              <h2 className="text-lg font-bold text-slate-900">{editingScript ? 'Modifier le script' : 'Nouveau script'}</h2>
              <button onClick={() => { setShowScriptModal(false); resetScriptForm(); }} className="p-2 hover:bg-slate-100 rounded-xl transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleScriptSubmit} className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Titre *</label>
                <input required type="text" value={scriptForm.titre} onChange={e => setScriptForm({ ...scriptForm, titre: e.target.value })} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Script d'appel commercial B2B" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Contenu *</label>
                <textarea required value={scriptForm.contenu} onChange={e => setScriptForm({ ...scriptForm, contenu: e.target.value })} rows={16} className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none font-mono leading-relaxed" placeholder="INTRODUCTION\n-----------\nBonjour [prenom]..." />
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={scriptForm.actif} onChange={e => setScriptForm({ ...scriptForm, actif: e.target.checked })} className="w-4 h-4 rounded border-slate-300 text-blue-600" />
                <span className="text-sm font-medium text-slate-700">Definir comme script actif</span>
              </label>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => { setShowScriptModal(false); resetScriptForm(); }} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium transition-colors">Annuler</button>
                <button type="submit" className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 text-sm font-semibold transition-colors shadow-sm">{editingScript ? 'Enregistrer' : 'Creer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Send Email Modal */}
      {showSendModal && previewTemplate && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex justify-between items-center rounded-t-2xl z-10">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center">
                  <Send className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Envoyer un email</h2>
                  <p className="text-xs text-slate-500">depuis {brand.code === 'epiderme_ai' ? (emailSenders.find(sender => sender.code === sendSenderCode)?.from_email || 'expéditeur à sélectionner') : brand.from_email}</p>
                </div>
              </div>
              <button onClick={() => { setShowSendModal(false); setSendResult(null); }} className="p-2 hover:bg-slate-100 rounded-xl transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 space-y-4">
              {/* Contact selection */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Contact (optionnel)</label>
                <select value={sendContactId} onChange={e => handleContactSelect(e.target.value)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                  <option value="">-- Saisie manuelle --</option>
                  {contacts.filter(c => c.email).map(c => (
                    <option key={c.id} value={c.id}>{c.prenom} {c.nom} - {c.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Destinataire *</label>
                <input type="email" required value={sendTo} onChange={e => setSendTo(e.target.value)} placeholder="email@exemple.com" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              {brand.code === 'epiderme_ai' && (
                <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-violet-700">Expéditeur Resend *</label>
                  <select required value={sendSenderCode} onChange={event => setSendSenderCode(event.target.value)} className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-sm">
                    <option value="">Choisir France ou Israël…</option>
                    {emailSenders.map(sender => <option key={sender.code} value={sender.code}>{sender.country === 'Israël' ? '🇮🇱' : '🇫🇷'} {sender.from_name} — {sender.from_email}</option>)}
                  </select>
                  <p className="mt-1.5 text-[11px] text-violet-700">Présélection automatique selon le pays du contact. Vous pouvez la modifier pour un envoi manuel.</p>
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Objet *</label>
                <input type="text" required value={sendSubject} onChange={e => setSendSubject(e.target.value)} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Pièce jointe (optionnelle)</label>
                {sendAttachment ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <Paperclip className="h-4 w-4 flex-shrink-0 text-blue-600" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-700">{sendAttachment.name}</p>
                        <p className="text-xs text-slate-500">{(sendAttachment.size / 1024 / 1024).toFixed(2)} Mo</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => setSendAttachment(null)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-red-600" title="Retirer la pièce jointe">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-semibold text-slate-600 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700">
                    <Paperclip className="h-4 w-4" /> Ajouter un fichier
                    <input
                      type="file"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        if (file.size > MAX_ATTACHMENT_SIZE) {
                          setSendResult({ success: false, message: 'La pièce jointe ne doit pas dépasser 10 Mo.' });
                          return;
                        }
                        setSendResult(null);
                        setSendAttachment(file);
                      }}
                    />
                  </label>
                )}
                <p className="mt-1 text-[11px] text-slate-400">Un fichier maximum, limité à 10 Mo.</p>
              </div>

              {/* Mini preview */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-100">
                  <p className="text-xs font-semibold text-slate-600">Apercu du message</p>
                </div>
                <div className="p-4 max-h-48 overflow-auto bg-white text-sm">
                  {/<[a-z][\s\S]*>/i.test(previewTemplate.contenu) ? (
                    <div dangerouslySetInnerHTML={{ __html: replaceVariables(previewTemplate.contenu, getPreviewVariables()) }} />
                  ) : (
                    <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">{replaceVariables(previewTemplate.contenu, getPreviewVariables())}</p>
                  )}
                </div>
              </div>

              {/* Result banner */}
              {sendResult && (
                <div className={`flex items-center gap-3 p-4 rounded-xl ${sendResult.success ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
                  {sendResult.success ? <Check className="w-5 h-5 text-emerald-600 flex-shrink-0" /> : <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />}
                  <p className={`text-sm font-medium ${sendResult.success ? 'text-emerald-700' : 'text-red-700'}`}>{sendResult.message}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button onClick={() => { setShowSendModal(false); setSendResult(null); }} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium transition-colors">Annuler</button>
                <button
                  onClick={handleSendEmail}
                  disabled={sending || !sendTo || !sendSubject}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-semibold transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sending ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Send className="w-4 h-4" />}
                  {sending ? 'Envoi...' : 'Envoyer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
