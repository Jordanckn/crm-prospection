import { useState, useRef, useCallback } from 'react';
import { Upload, X, Check, AlertTriangle, ChevronDown, ArrowRight, FileSpreadsheet, Loader2, GitMerge, RefreshCw, Ban } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Contact } from '../types/database';
import { usePermissions } from '../contexts/PermissionsContext';

// CRM field definitions with aliases for auto-detection
const CRM_FIELDS = [
  { key: 'prenom', label: 'Prénom', aliases: ['prenom', 'firstname', 'first_name', 'prénom', 'given name'] },
  { key: 'nom', label: 'Nom', aliases: ['nom', 'lastname', 'last_name', 'surname', 'name', 'family name', 'nom de famille'] },
  { key: 'email', label: 'Email', aliases: ['email', 'mail', 'e-mail', 'courriel', 'adresse mail', 'adresse email'] },
  { key: 'telephone', label: 'Téléphone', aliases: ['telephone', 'téléphone', 'tel', 'phone', 'mobile', 'portable', 'tél', 'phone number'] },
  { key: 'entreprise', label: 'Entreprise', aliases: ['entreprise', 'company', 'société', 'societe', 'organization', 'organisation', 'raison sociale'] },
  { key: 'secteur_activite', label: "Secteur d'activité", aliases: ['secteur', 'secteur_activite', 'secteur activite', 'industry', 'sector', 'activite', 'activité', 'métier', 'metier'] },
  { key: 'statut', label: 'Statut', aliases: ['statut', 'status', 'état', 'etat'] },
  { key: 'pays', label: 'Pays', aliases: ['pays', 'country', 'nation'] },
  { key: 'adresse', label: 'Adresse', aliases: ['adresse', 'address', 'rue', 'street', 'adresse postale'] },
  { key: 'ville', label: 'Ville', aliases: ['ville', 'city', 'commune', 'localite', 'localité', 'town'] },
  { key: 'code_postal', label: 'Code postal', aliases: ['code_postal', 'code postal', 'cp', 'postal code', 'zip', 'zipcode', 'postcode'] },
  { key: 'site_web', label: 'Site web', aliases: ['site_web', 'site web', 'website', 'url', 'web', 'site', 'www'] },
  { key: 'siren_siret', label: 'SIREN/SIRET', aliases: ['siren', 'siret', 'siren_siret', 'numero siren', 'numéro siret'] },
  { key: 'notes_entreprise', label: 'Notes entreprise', aliases: ['notes', 'notes_entreprise', 'note', 'commentaire', 'description', 'remarques'] },
  { key: 'linkedin', label: 'LinkedIn', aliases: ['linkedin', 'linked_in', 'profil linkedin'] },
  { key: 'instagram', label: 'Instagram', aliases: ['instagram', 'insta'] },
  { key: 'facebook', label: 'Facebook', aliases: ['facebook', 'fb'] },
  { key: 'twitter', label: 'Twitter', aliases: ['twitter', 'x', 'tweet'] },
  { key: '_ignore', label: '— Ignorer —', aliases: [] },
] as const;

type CrmFieldKey = typeof CRM_FIELDS[number]['key'];
type Mapping = Record<string, CrmFieldKey>;

type ImportRow = Record<string, string>;
type PreparedContact = { index: number; rowNumber: number; payload: Record<string, any> };
type DuplicateCandidate = {
  incoming_index: number;
  contact_id: string;
  match_types: Array<'entreprise' | 'siren_siret' | 'telephone' | 'site_web' | 'email'>;
  existing_contact: Contact;
};
type DuplicateIssue = {
  incoming: PreparedContact;
  candidates: DuplicateCandidate[];
  csvTarget?: PreparedContact;
  matchTypes: DuplicateCandidate['match_types'];
};
type DuplicateAction = 'merge' | 'replace' | 'skip';
type ImportResult = {
  success: number;
  inserted: number;
  merged: number;
  replaced: number;
  skipped: number;
  errors: { row: number; msg: string }[];
};

function parseCsv(text: string): { headers: string[]; rows: ImportRow[] } {
  // Detect delimiter: semicolon or comma
  const firstLine = text.split('\n')[0] || '';
  const delimiter = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';

  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]).map(h => h.replace(/^\uFEFF/, '')); // strip BOM
  const rows = lines.slice(1).map(line => {
    const values = parseRow(line);
    const row: ImportRow = {};
    headers.forEach((h, i) => { row[h] = values[i] || ''; });
    return row;
  }).filter(row => Object.values(row).some(v => v.trim()));

  return { headers, rows };
}

function autoDetectMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const usedKeys = new Set<string>();

  for (const header of headers) {
    const normalized = header.toLowerCase().trim().replace(/[_\s-]+/g, ' ');
    let bestKey: CrmFieldKey = '_ignore';

    for (const field of CRM_FIELDS) {
      if (field.key === '_ignore') continue;
      if (usedKeys.has(field.key)) continue;
      if (field.aliases.some(a => a === normalized || normalized.includes(a) || a.includes(normalized))) {
        bestKey = field.key;
        break;
      }
    }

    mapping[header] = bestKey;
    if (bestKey !== '_ignore') usedKeys.add(bestKey);
  }
  return mapping;
}

function normalizeStatut(val: string): 'Nouveau' | 'En cours' | 'Converti' | 'Perdu' {
  const v = val.toLowerCase().trim();
  if (v.includes('cours') || v.includes('progress')) return 'En cours';
  if (v.includes('converti') || v.includes('convert') || v.includes('won')) return 'Converti';
  if (v.includes('perdu') || v.includes('lost')) return 'Perdu';
  return 'Nouveau';
}

function normalizePays(val: string): 'France' | 'Israël' {
  if (val.toLowerCase().includes('israel') || val.toLowerCase().includes('israël')) return 'Israël';
  return 'France';
}

const normalizeText = (value: unknown) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizeDigits = (value: unknown) => String(value || '').replace(/[^0-9]/g, '');
const normalizeWebsite = (value: unknown) => String(value || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[\/#?].*$/, '');

function comparePreparedContacts(a: PreparedContact, b: PreparedContact): DuplicateCandidate['match_types'] {
  const matches: DuplicateCandidate['match_types'] = [];
  const companyA = normalizeText(a.payload.entreprise || `${a.payload.prenom} ${a.payload.nom}`);
  const companyB = normalizeText(b.payload.entreprise || `${b.payload.prenom} ${b.payload.nom}`);
  const sirenA = normalizeDigits(a.payload.siren_siret);
  const sirenB = normalizeDigits(b.payload.siren_siret);
  const phoneA = normalizeDigits(a.payload.telephone);
  const phoneB = normalizeDigits(b.payload.telephone);
  const websiteA = normalizeWebsite(a.payload.site_web);
  const websiteB = normalizeWebsite(b.payload.site_web);
  const genericSites = new Set(['facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'youtube.com', 'tiktok.com']);
  const emailA = String(a.payload.email || '').trim().toLowerCase();
  const emailB = String(b.payload.email || '').trim().toLowerCase();
  if (companyA.length >= 4 && companyA === companyB) matches.push('entreprise');
  if (sirenA.length >= 9 && sirenA === sirenB) matches.push('siren_siret');
  if (phoneA.length >= 9 && phoneB.length >= 9 && phoneA.slice(-9) === phoneB.slice(-9)) matches.push('telephone');
  if (websiteA.length >= 4 && websiteA === websiteB && !genericSites.has(websiteA)) matches.push('site_web');
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailA) && emailA === emailB) matches.push('email');
  return matches;
}

type Props = { onClose: () => void; onImported: () => void };

type Step = 'drop' | 'mapping' | 'preview' | 'checking' | 'duplicates' | 'importing' | 'done';

export default function CsvImport({ onClose, onImported }: Props) {
  const { canModify } = usePermissions();
  const [step, setStep] = useState<Step>('drop');
  const [dragging, setDragging] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [result, setResult] = useState<ImportResult>({ success: 0, inserted: 0, merged: 0, replaced: 0, skipped: 0, errors: [] });
  const [preparedContacts, setPreparedContacts] = useState<PreparedContact[]>([]);
  const [duplicateIssues, setDuplicateIssues] = useState<DuplicateIssue[]>([]);
  const [decisions, setDecisions] = useState<Record<number, DuplicateAction>>({});
  const [selectedCandidates, setSelectedCandidates] = useState<Record<number, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') return;
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      const { headers: h, rows: r } = parseCsv(text);
      setHeaders(h);
      setRows(r);
      setMapping(autoDetectMapping(h));
      setStep('mapping');
    };
    reader.readAsText(file, 'UTF-8');
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const prepareImport = () => {
    const errors: { row: number; msg: string }[] = [];
    const contacts = rows.map((row, i): PreparedContact | null => {
      const obj: Record<string, any> = {
        prenom: '', nom: '', email: '', telephone: '', entreprise: '',
        adresse: '', ville: '', code_postal: '', tags: [],
        statut: 'Nouveau', pays: 'France', secteur_activite: '',
        instagram: '', facebook: '', linkedin: '', twitter: '',
        siren_siret: '', notes_entreprise: '', site_web: '',
      };

      for (const [header, fieldKey] of Object.entries(mapping)) {
        if (fieldKey === '_ignore') continue;
        const val = (row[header] || '').trim();
        if (fieldKey === 'statut') obj.statut = normalizeStatut(val);
        else if (fieldKey === 'pays') obj.pays = normalizePays(val);
        else obj[fieldKey] = val;
      }

      if (!obj.nom && !obj.prenom && !obj.email && !obj.telephone) {
        errors.push({ row: i + 2, msg: 'Ligne vide ou sans données identifiables' });
        return null;
      }
      return { index: i, rowNumber: i + 2, payload: obj };
    }).filter((contact): contact is PreparedContact => Boolean(contact));
    return { contacts, errors };
  };

  const executeImport = async (
    contacts: PreparedContact[],
    initialErrors: { row: number; msg: string }[],
    issues: DuplicateIssue[] = [],
    selectedDecisions: Record<number, DuplicateAction> = {},
  ) => {
    setStep('importing');
    const errors = [...initialErrors];
    let inserted = 0;
    let merged = 0;
    let replaced = 0;
    let skipped = 0;
    const BATCH = 50;
    const duplicateIndexes = new Set(issues.map(issue => issue.incoming.index));
    const workingContacts = contacts.map(contact => ({ ...contact, payload: { ...contact.payload } }));
    const mappedFieldKeys = [...new Set(Object.values(mapping).filter(value => value !== '_ignore'))];

    for (const issue of issues) {
      const action = selectedDecisions[issue.incoming.index];
      if (action === 'skip') { skipped++; continue; }
      if (issue.csvTarget) {
        const target = workingContacts.find(contact => contact.index === issue.csvTarget?.index);
        if (!target || (action !== 'merge' && action !== 'replace')) {
          errors.push({ row: issue.incoming.rowNumber, msg: 'Décision de doublon CSV incomplète' });
          continue;
        }
        if (action === 'replace') target.payload = { ...issue.incoming.payload };
        else {
          for (const [key, value] of Object.entries(issue.incoming.payload)) {
            if (key === 'notes_entreprise') {
              const notes = [...new Set([target.payload[key], value].map(note => String(note || '').trim()).filter(Boolean))];
              target.payload[key] = notes.join('\n\n');
            } else if (!String(target.payload[key] ?? '').trim() && String(value ?? '').trim()) target.payload[key] = value;
          }
        }
        if (action === 'merge') merged++; else replaced++;
        continue;
      }
      const contactId = selectedCandidates[issue.incoming.index] || issue.candidates[0]?.contact_id;
      if (!contactId || (action !== 'merge' && action !== 'replace')) {
        errors.push({ row: issue.incoming.rowNumber, msg: 'Décision de doublon incomplète' });
        continue;
      }
      const { error } = await supabase.rpc('resolve_csv_contact_duplicate', {
        p_contact_id: contactId,
        p_incoming: issue.incoming.payload,
        p_action: action,
        p_mapped_fields: mappedFieldKeys,
      });
      if (error) errors.push({ row: issue.incoming.rowNumber, msg: error.message });
      else if (action === 'merge') merged++;
      else replaced++;
    }

    const toInsert = workingContacts.filter(contact => !duplicateIndexes.has(contact.index));

    for (let i = 0; i < toInsert.length; i += BATCH) {
      const batch = toInsert.slice(i, i + BATCH);
      const { error, data } = await supabase.from('contacts').insert(batch.map(contact => contact.payload)).select('id');
      if (error) {
        batch.forEach(contact => errors.push({ row: contact.rowNumber, msg: error.message }));
      } else {
        inserted += data?.length || 0;
      }
    }

    const success = inserted + merged + replaced;
    setResult({ success, inserted, merged, replaced, skipped, errors });
    setStep('done');
    if (success > 0) onImported();
  };

  const analyzeAndImport = async () => {
    const prepared = prepareImport();
    setPreparedContacts(prepared.contacts);
    setStep('checking');
    const payload = prepared.contacts.map(contact => ({ index: contact.index, ...contact.payload }));
    const { data, error } = await supabase.rpc('find_csv_contact_duplicates', { p_rows: payload });
    if (error) {
      setResult({ success: 0, inserted: 0, merged: 0, replaced: 0, skipped: 0, errors: [{ row: 1, msg: error.message }] });
      setStep('done');
      return;
    }

    const candidates = (data || []) as DuplicateCandidate[];
    const grouped = new Map<number, DuplicateCandidate[]>();
    for (const candidate of candidates) grouped.set(candidate.incoming_index, [...(grouped.get(candidate.incoming_index) || []), candidate]);
    const databaseIssues: DuplicateIssue[] = prepared.contacts
      .filter(contact => grouped.has(contact.index))
      .map(contact => {
        const contactCandidates = grouped.get(contact.index) || [];
        return { incoming: contact, candidates: contactCandidates, matchTypes: contactCandidates[0]?.match_types || [] };
      });

    // Controle aussi les repetitions contenues dans le fichier lui-meme.
    const databaseIndexes = new Set(databaseIssues.map(issue => issue.incoming.index));
    const csvIssues: DuplicateIssue[] = [];
    const csvRepresentatives: PreparedContact[] = [];
    for (const contact of prepared.contacts.filter(item => !databaseIndexes.has(item.index))) {
      const match = csvRepresentatives
        .map(target => ({ target, criteria: comparePreparedContacts(contact, target) }))
        .find(item => item.criteria.length > 0);
      if (match) csvIssues.push({ incoming: contact, candidates: [], csvTarget: match.target, matchTypes: match.criteria });
      else csvRepresentatives.push(contact);
    }
    const issues = [...databaseIssues, ...csvIssues].sort((a, b) => a.incoming.index - b.incoming.index);

    if (!issues.length) {
      await executeImport(prepared.contacts, prepared.errors);
      return;
    }

    setDuplicateIssues(issues);
    setDecisions({});
    setSelectedCandidates(Object.fromEntries(databaseIssues.map(issue => [issue.incoming.index, issue.candidates[0].contact_id])));
    setResult(current => ({ ...current, errors: prepared.errors }));
    setStep('duplicates');
  };

  const applyDecisionToAll = (action: DuplicateAction) => {
    setDecisions(Object.fromEntries(duplicateIssues.map(issue => [issue.incoming.index, action])));
  };

  const confirmDuplicateChoices = async () => {
    if (duplicateIssues.some(issue => !decisions[issue.incoming.index])) return;
    await executeImport(preparedContacts, result.errors, duplicateIssues, decisions);
  };

  const mappedFields = new Set(Object.values(mapping).filter(v => v !== '_ignore'));
  const hasNom = mappedFields.has('nom') || mappedFields.has('prenom');
  const allDuplicatesResolved = duplicateIssues.every(issue => Boolean(decisions[issue.incoming.index]));
  const hasDatabaseDuplicates = duplicateIssues.some(issue => !issue.csvTarget);
  const criterionLabels: Record<DuplicateCandidate['match_types'][number], string> = {
    entreprise: 'Entreprise', siren_siret: 'SIREN/SIRET', telephone: 'Téléphone', site_web: 'Site web', email: 'Email',
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900">Importer des contacts CSV</h2>
              <p className="text-xs text-slate-500">
                {step === 'drop' && 'Glissez votre fichier ou cliquez pour parcourir'}
                {step === 'mapping' && `${rows.length} contacts détectés — vérifiez la correspondance des colonnes`}
                {step === 'preview' && `Aperçu des ${Math.min(rows.length, 5)} premiers contacts`}
                {step === 'checking' && 'Recherche de correspondances dans le CRM...'}
                {step === 'duplicates' && `${duplicateIssues.length} doublon(s) potentiel(s) à examiner`}
                {step === 'importing' && 'Import en cours...'}
                {step === 'done' && 'Import terminé'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Steps indicator */}
        {(step === 'mapping' || step === 'preview' || step === 'duplicates') && (
          <div className="px-6 py-3 border-b border-slate-100 flex items-center gap-2 text-xs flex-shrink-0">
            {[['mapping', '1. Correspondance'], ['preview', '2. Aperçu'], ['duplicates', '3. Doublons']].map(([s, label], i) => (
              <div key={s} className="flex items-center gap-2">
                {i > 0 && <ArrowRight className="w-3 h-3 text-slate-300" />}
                <span className={`px-2.5 py-1 rounded-full font-semibold ${step === s ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}`}>{label}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">

          {/* ── STEP: DROP ── */}
          {step === 'drop' && (
            <div className="p-8">
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition-all ${
                  dragging ? 'border-blue-400 bg-blue-50 scale-[1.01]' : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                }`}
              >
                <Upload className={`w-14 h-14 mx-auto mb-4 transition-colors ${dragging ? 'text-blue-500' : 'text-slate-300'}`} />
                <p className="text-lg font-semibold text-slate-700 mb-1">Glissez votre fichier CSV ici</p>
                <p className="text-sm text-slate-400 mb-4">ou cliquez pour parcourir</p>
                <span className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold">
                  Choisir un fichier
                </span>
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </div>
              <div className="mt-6 bg-slate-50 rounded-xl p-4 border border-slate-200">
                <p className="text-xs font-bold text-slate-600 mb-2 uppercase tracking-wide">Colonnes reconnues automatiquement</p>
                <div className="flex flex-wrap gap-1.5">
                  {CRM_FIELDS.filter(f => f.key !== '_ignore').map(f => (
                    <span key={f.key} className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs text-slate-600">{f.label}</span>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-2">Séparateur virgule ou point-virgule, encodage UTF-8. La première ligne doit contenir les en-têtes.</p>
              </div>
            </div>
          )}

          {/* ── STEP: MAPPING ── */}
          {step === 'mapping' && (
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {headers.map(header => {
                  const sample = rows.slice(0, 3).map(r => r[header]).filter(Boolean).join(', ');
                  const isIgnored = mapping[header] === '_ignore';
                  return (
                    <div key={header} className={`border rounded-xl p-3 ${isIgnored ? 'border-slate-100 bg-slate-50 opacity-60' : 'border-slate-200 bg-white'}`}>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-700 truncate">{header}</p>
                          {sample && <p className="text-xs text-slate-400 truncate">{sample}</p>}
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
                        <div className="relative flex-shrink-0">
                          <select
                            value={mapping[header] || '_ignore'}
                            onChange={e => setMapping(prev => ({ ...prev, [header]: e.target.value as CrmFieldKey }))}
                            className={`appearance-none pl-2.5 pr-6 py-1.5 text-xs font-semibold rounded-lg border outline-none cursor-pointer ${
                              isIgnored ? 'border-slate-200 bg-slate-100 text-slate-400' : 'border-blue-200 bg-blue-50 text-blue-700'
                            }`}
                          >
                            {CRM_FIELDS.map(f => (
                              <option key={f.key} value={f.key}>{f.label}</option>
                            ))}
                          </select>
                          <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {!hasNom && (
                <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  Mappez au moins une colonne "Prénom" ou "Nom" pour identifier les contacts.
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep('drop')} className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50">Retour</button>
                <button
                  onClick={() => setStep('preview')}
                  disabled={!hasNom}
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Aperçu ({rows.length} contacts)
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: PREVIEW ── */}
          {step === 'preview' && (
            <div className="p-6 space-y-4">
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      {headers.filter(h => mapping[h] !== '_ignore').map(h => (
                        <th key={h} className="px-3 py-2.5 text-left font-semibold text-slate-600 whitespace-nowrap">
                          {CRM_FIELDS.find(f => f.key === mapping[h])?.label || h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.slice(0, 8).map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        {headers.filter(h => mapping[h] !== '_ignore').map(h => (
                          <td key={h} className="px-3 py-2 text-slate-700 max-w-32 truncate">{row[h] || <span className="text-slate-300">—</span>}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 8 && (
                  <div className="px-4 py-2.5 bg-slate-50 text-xs text-slate-400 border-t border-slate-200">
                    + {rows.length - 8} autres contacts non affichés
                  </div>
                )}
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-700 font-medium">
                Le CRM vérifiera d’abord l’entreprise, le SIREN/SIRET, le téléphone, le site internet et l’email. Aucun doublon potentiel ne sera ajouté sans votre décision.
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep('mapping')} className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50">Retour</button>
                <button onClick={() => void analyzeAndImport()} className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 shadow-sm">
                  Analyser puis importer {rows.length} contacts
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: DUPLICATE CHECK ── */}
          {step === 'checking' && (
            <div className="p-16 text-center">
              <Loader2 className="w-12 h-12 text-violet-600 animate-spin mx-auto mb-4" />
              <p className="font-semibold text-slate-700">Analyse des doublons avant import...</p>
              <p className="text-sm text-slate-400 mt-1">Comparaison avec l’espace actif et entre les lignes du fichier</p>
            </div>
          )}

          {/* ── STEP: DUPLICATE REVIEW ── */}
          {step === 'duplicates' && (
            <div className="p-6 space-y-5">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
                  <div>
                    <p className="font-bold text-amber-900">{duplicateIssues.length} doublon(s) potentiel(s) détecté(s)</p>
                    <p className="mt-1 text-sm text-amber-700">Choisissez une action pour chaque ligne. Les contacts sans correspondance seront ajoutés normalement.</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="self-center text-xs font-semibold text-slate-500">Appliquer à tous :</span>
                <button onClick={() => applyDecisionToAll('merge')} disabled={!canModify && hasDatabaseDuplicates} className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-bold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">Fusionner</button>
                <button onClick={() => applyDecisionToAll('replace')} disabled={!canModify && hasDatabaseDuplicates} className="rounded-lg border border-orange-200 px-3 py-1.5 text-xs font-bold text-orange-700 disabled:cursor-not-allowed disabled:opacity-40">Remplacer</button>
                <button onClick={() => applyDecisionToAll('skip')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Ne pas ajouter</button>
              </div>

              {!canModify && hasDatabaseDuplicates && (
                <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">Votre rôle permet l’ajout mais pas la modification des fiches existantes. Vous pouvez ne pas ajouter les doublons ; un administrateur ou un éditeur peut les fusionner ou les remplacer.</p>
              )}

              <div className="space-y-4">
                {duplicateIssues.map(issue => {
                  const selectedId = selectedCandidates[issue.incoming.index] || issue.candidates[0]?.contact_id;
                  const candidate = issue.candidates.find(item => item.contact_id === selectedId) || issue.candidates[0];
                  const incoming = issue.incoming.payload;
                  const existing = candidate?.existing_contact || issue.csvTarget?.payload;
                  const displayedCriteria = candidate?.match_types || issue.matchTypes;
                  return (
                    <div key={issue.incoming.index} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
                        <p className="text-sm font-bold text-slate-800">Ligne CSV {issue.incoming.rowNumber} · {incoming.entreprise || [incoming.prenom, incoming.nom].filter(Boolean).join(' ') || 'Sans nom'}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {displayedCriteria.map(type => <span key={type} className="rounded-full bg-violet-100 px-2 py-1 text-[11px] font-bold text-violet-700">{criterionLabels[type]}</span>)}
                        </div>
                      </div>
                      <div className="grid gap-3 p-4 md:grid-cols-2">
                        <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs leading-5 text-slate-700">
                          <p className="mb-1 font-bold text-blue-800">Données du CSV</p>
                          <p><strong>Entreprise :</strong> {incoming.entreprise || '—'}</p>
                          <p><strong>Contact :</strong> {[incoming.prenom, incoming.nom].filter(Boolean).join(' ') || '—'}</p>
                          <p><strong>Email :</strong> {incoming.email || '—'}</p>
                          <p><strong>Téléphone :</strong> {incoming.telephone || '—'}</p>
                          <p><strong>Notes :</strong> {incoming.notes_entreprise || '—'}</p>
                        </div>
                        <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3 text-xs leading-5 text-slate-700">
                          <p className="mb-1 font-bold text-amber-800">{issue.csvTarget ? `Autre ligne du CSV (ligne ${issue.csvTarget.rowNumber})` : 'Fiche déjà présente'}</p>
                          {issue.candidates.length > 1 && (
                            <select value={selectedId} onChange={event => setSelectedCandidates(current => ({ ...current, [issue.incoming.index]: event.target.value }))} className="mb-2 w-full rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-xs">
                              {issue.candidates.map(item => <option key={item.contact_id} value={item.contact_id}>{item.existing_contact.entreprise || `${item.existing_contact.prenom} ${item.existing_contact.nom}`} · {item.match_types.length} critère(s)</option>)}
                            </select>
                          )}
                          <p><strong>Entreprise :</strong> {existing?.entreprise || '—'}</p>
                          <p><strong>Contact :</strong> {[existing?.prenom, existing?.nom].filter(Boolean).join(' ') || '—'}</p>
                          <p><strong>Email :</strong> {existing?.email || '—'}</p>
                          <p><strong>Téléphone :</strong> {existing?.telephone || '—'}</p>
                          <p><strong>Notes :</strong> {existing?.notes_entreprise || '—'}</p>
                        </div>
                      </div>
                      <div className="grid gap-2 border-t border-slate-100 p-4 sm:grid-cols-3">
                        <button onClick={() => setDecisions(current => ({ ...current, [issue.incoming.index]: 'merge' }))} disabled={!canModify && !issue.csvTarget}
                          className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40 ${decisions[issue.incoming.index] === 'merge' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'}`}>
                          <GitMerge className="h-4 w-4" />Fusionner les éléments manquants
                        </button>
                        <button onClick={() => setDecisions(current => ({ ...current, [issue.incoming.index]: 'replace' }))} disabled={!canModify && !issue.csvTarget}
                          className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40 ${decisions[issue.incoming.index] === 'replace' ? 'border-orange-600 bg-orange-600 text-white' : 'border-orange-200 text-orange-700 hover:bg-orange-50'}`}>
                          <RefreshCw className="h-4 w-4" />Remplacer par le CSV
                        </button>
                        <button onClick={() => setDecisions(current => ({ ...current, [issue.incoming.index]: 'skip' }))}
                          className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold ${decisions[issue.incoming.index] === 'skip' ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                          <Ban className="h-4 w-4" />Ne pas ajouter
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="sticky bottom-0 flex gap-3 border-t border-slate-100 bg-white pt-4">
                <button onClick={() => setStep('preview')} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Retour</button>
                <button onClick={() => void confirmDuplicateChoices()} disabled={!allDuplicatesResolved} className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">
                  Confirmer les choix et terminer l’import
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: IMPORTING ── */}
          {step === 'importing' && (
            <div className="p-16 text-center">
              <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
              <p className="font-semibold text-slate-700">Import en cours...</p>
              <p className="text-sm text-slate-400 mt-1">Veuillez patienter</p>
            </div>
          )}

          {/* ── STEP: DONE ── */}
          {step === 'done' && (
            <div className="p-8 space-y-5">
              <div className={`rounded-2xl p-6 text-center ${result.success > 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
                <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 ${result.success > 0 ? 'bg-emerald-100' : 'bg-red-100'}`}>
                  <Check className={`w-7 h-7 ${result.success > 0 ? 'text-emerald-600' : 'text-red-600'}`} />
                </div>
                <p className={`text-2xl font-bold mb-1 ${result.success > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {result.success} contact{result.success > 1 ? 's' : ''} traité{result.success > 1 ? 's' : ''}
                </p>
                {result.errors.length > 0 && (
                  <p className="text-sm text-amber-600">{result.errors.length} ligne(s) ignorée(s)</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
                <div className="rounded-xl bg-blue-50 p-3"><strong className="block text-lg text-blue-700">{result.inserted}</strong><span className="text-blue-600">Ajouté(s)</span></div>
                <div className="rounded-xl bg-emerald-50 p-3"><strong className="block text-lg text-emerald-700">{result.merged}</strong><span className="text-emerald-600">Fusionné(s)</span></div>
                <div className="rounded-xl bg-orange-50 p-3"><strong className="block text-lg text-orange-700">{result.replaced}</strong><span className="text-orange-600">Remplacé(s)</span></div>
                <div className="rounded-xl bg-slate-100 p-3"><strong className="block text-lg text-slate-700">{result.skipped}</strong><span className="text-slate-600">Non ajouté(s)</span></div>
              </div>

              {result.errors.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 max-h-40 overflow-y-auto">
                  <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-2">Erreurs</p>
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-amber-700 mb-1">Ligne {e.row} : {e.msg}</p>
                  ))}
                </div>
              )}

              <button onClick={onClose} className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700">
                Fermer et voir les contacts
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
