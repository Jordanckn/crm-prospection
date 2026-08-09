import { useState, useRef, useCallback } from 'react';
import { Upload, X, Check, AlertTriangle, ChevronDown, ArrowRight, FileSpreadsheet, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

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
type ImportResult = { success: number; errors: { row: number; msg: string }[] };

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

type Props = { onClose: () => void; onImported: () => void };

type Step = 'drop' | 'mapping' | 'preview' | 'importing' | 'done';

export default function CsvImport({ onClose, onImported }: Props) {
  const [step, setStep] = useState<Step>('drop');
  const [dragging, setDragging] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [result, setResult] = useState<ImportResult>({ success: 0, errors: [] });
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

  const doImport = async () => {
    setStep('importing');
    const errors: { row: number; msg: string }[] = [];
    let success = 0;
    const BATCH = 50;

    const toInsert = rows.map((row, i) => {
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
      return obj;
    }).filter(Boolean);

    for (let i = 0; i < toInsert.length; i += BATCH) {
      const batch = toInsert.slice(i, i + BATCH);
      const { error, data } = await supabase.from('contacts').insert(batch).select('id');
      if (error) {
        batch.forEach((_, j) => errors.push({ row: i + j + 2, msg: error.message }));
      } else {
        success += data?.length || 0;
      }
    }

    setResult({ success, errors });
    setStep('done');
    if (success > 0) onImported();
  };

  const mappedFields = new Set(Object.values(mapping).filter(v => v !== '_ignore'));
  const hasNom = mappedFields.has('nom') || mappedFields.has('prenom');

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
        {(step === 'mapping' || step === 'preview') && (
          <div className="px-6 py-3 border-b border-slate-100 flex items-center gap-2 text-xs flex-shrink-0">
            {[['mapping', '1. Correspondance'], ['preview', '2. Aperçu']].map(([s, label], i) => (
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
                {rows.length} contacts seront importés dans votre CRM.
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep('mapping')} className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50">Retour</button>
                <button onClick={doImport} className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 shadow-sm">
                  Importer {rows.length} contacts
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
                  {result.success} contact{result.success > 1 ? 's' : ''} importé{result.success > 1 ? 's' : ''}
                </p>
                {result.errors.length > 0 && (
                  <p className="text-sm text-amber-600">{result.errors.length} ligne(s) ignorée(s)</p>
                )}
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
