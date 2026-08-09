import { useEffect, useState, useCallback } from 'react';
import {
  BarChart2, Phone, Mail, MessageCircle, TrendingUp, Users, CheckSquare,
  Download, Target, Clock, Award, Activity,
  Facebook as FacebookIcon, Instagram as InstagramIcon
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Contact, Interaction, Tache } from '../types/database';

type Period = 'day' | 'week' | 'month' | 'year';

type KPI = {
  totalInteractions: number;
  appels: number;
  emails: number;
  whatsapp: number;
  sms: number;
  facebook: number;
  instagram: number;
  interesses: number;
  repondus: number;
  nonInteresses: number;
  pasDeReponse: number;
  relances: number;
  tauxReponse: number;
  tauxInteret: number;
  tauxConversion: number;
  nouveauxContacts: number;
  contactsConverti: number;
  tachesTerminees: number;
  tachesEnAttente: number;
  dureeTotaleAppels: number;
  minutesTravail: number;
  sessionsTravail: number;
};

const emptyKPI = (): KPI => ({
  totalInteractions: 0, appels: 0, emails: 0, whatsapp: 0, sms: 0,
  facebook: 0, instagram: 0, interesses: 0, repondus: 0, nonInteresses: 0,
  pasDeReponse: 0, relances: 0, tauxReponse: 0, tauxInteret: 0, tauxConversion: 0,
  nouveauxContacts: 0, contactsConverti: 0, tachesTerminees: 0, tachesEnAttente: 0,
  dureeTotaleAppels: 0, minutesTravail: 0, sessionsTravail: 0,
});

const PERIOD_LABELS: Record<Period, string> = {
  day: "Aujourd'hui",
  week: 'Cette semaine',
  month: 'Ce mois',
  year: 'Cette année',
};

function getPeriodRange(period: Period): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (period === 'day') {
    start.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    start.setHours(0, 0, 0, 0);
    const endDay = new Date(start);
    endDay.setDate(start.getDate() + 6);
    endDay.setHours(23, 59, 59, 999);
    return { start, end: endDay };
  } else if (period === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(end.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
  } else {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(11, 31);
    end.setHours(23, 59, 59, 999);
  }
  return { start, end };
}

function fmtMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export default function Rapport() {
  const [period, setPeriod] = useState<Period>('week');
  const [kpi, setKpi] = useState<KPI>(emptyKPI());
  const [loading, setLoading] = useState(true);
  const [chartData, setChartData] = useState<{ label: string; appels: number; messages: number; interesses: number }[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const { start, end } = getPeriodRange(period);

    const [interRes, contRes, tacheRes, sessionRes] = await Promise.all([
      supabase.from('interactions').select('*').gte('date_heure', start.toISOString()).lte('date_heure', end.toISOString()),
      supabase.from('contacts').select('statut, created_at').gte('created_at', start.toISOString()).lte('created_at', end.toISOString()),
      supabase.from('taches').select('statut, updated_at'),
      supabase.from('sessions_travail').select('debut, fin, duree_minutes').gte('debut', start.toISOString()).lte('debut', end.toISOString()),
    ]);

    const interactions: Interaction[] = interRes.data || [];
    const contacts: Pick<Contact, 'statut' | 'created_at'>[] = contRes.data || [];
    const taches: Pick<Tache, 'statut' | 'updated_at'>[] = (tacheRes.data || []) as any;
    const sessions = sessionRes.data || [];

    const k = emptyKPI();
    k.totalInteractions = interactions.length;
    k.appels = interactions.filter(i => i.type === 'Appel').length;
    k.emails = interactions.filter(i => i.type === 'Email').length;
    k.whatsapp = interactions.filter(i => i.type === 'WhatsApp').length;
    k.sms = interactions.filter(i => i.type === 'SMS').length;
    k.facebook = interactions.filter(i => i.type === 'Facebook').length;
    k.instagram = interactions.filter(i => i.type === 'Instagram').length;
    k.interesses = interactions.filter(i => i.resultat === 'Intéressé').length;
    k.repondus = interactions.filter(i => i.resultat === 'Répondu').length;
    k.nonInteresses = interactions.filter(i => i.resultat === 'Non intéressé').length;
    k.pasDeReponse = interactions.filter(i => i.resultat === 'Pas de réponse').length;
    k.relances = interactions.filter(i => i.resultat === 'Relance').length;
    k.dureeTotaleAppels = interactions.filter(i => i.type === 'Appel').reduce((sum, i) => sum + (i.duree || 0), 0);
    k.tauxReponse = k.totalInteractions > 0 ? Math.round(((k.repondus + k.interesses) / k.totalInteractions) * 100) : 0;
    k.tauxInteret = k.totalInteractions > 0 ? Math.round((k.interesses / k.totalInteractions) * 100) : 0;
    k.tauxConversion = k.totalInteractions > 0 ? Math.round(((k.interesses + k.repondus) / k.totalInteractions) * 100) : 0;
    k.nouveauxContacts = contacts.length;
    k.contactsConverti = contacts.filter(c => c.statut === 'Converti').length;
    k.tachesTerminees = taches.filter(t => t.statut === 'Terminé').length;
    k.tachesEnAttente = taches.filter(t => t.statut === 'En attente').length;
    k.sessionsTravail = sessions.length;
    k.minutesTravail = sessions.reduce((sum, s) => {
      if (s.duree_minutes) return sum + s.duree_minutes;
      if (s.fin) return sum + Math.round((new Date(s.fin).getTime() - new Date(s.debut).getTime()) / 60000);
      return sum;
    }, 0);

    setKpi(k);

    // Build chart data per day/week segment
    const chart: typeof chartData = [];
    if (period === 'day') {
      for (let h = 0; h < 24; h += 2) {
        const label = `${String(h).padStart(2, '0')}h`;
        const from = new Date(start); from.setHours(h, 0, 0, 0);
        const to = new Date(start); to.setHours(h + 2, 0, 0, 0);
        chart.push({
          label,
          appels: interactions.filter(i => i.type === 'Appel' && new Date(i.date_heure) >= from && new Date(i.date_heure) < to).length,
          messages: interactions.filter(i => i.type !== 'Appel' && new Date(i.date_heure) >= from && new Date(i.date_heure) < to).length,
          interesses: interactions.filter(i => i.resultat === 'Intéressé' && new Date(i.date_heure) >= from && new Date(i.date_heure) < to).length,
        });
      }
    } else if (period === 'week') {
      const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
      for (let d = 0; d < 7; d++) {
        const from = new Date(start); from.setDate(start.getDate() + d); from.setHours(0, 0, 0, 0);
        const to = new Date(from); to.setDate(from.getDate() + 1);
        chart.push({
          label: days[d],
          appels: interactions.filter(i => i.type === 'Appel' && new Date(i.date_heure) >= from && new Date(i.date_heure) < to).length,
          messages: interactions.filter(i => i.type !== 'Appel' && new Date(i.date_heure) >= from && new Date(i.date_heure) < to).length,
          interesses: interactions.filter(i => i.resultat === 'Intéressé' && new Date(i.date_heure) >= from && new Date(i.date_heure) < to).length,
        });
      }
    } else if (period === 'month') {
      const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
      for (let w = 0; w < Math.ceil(daysInMonth / 7); w++) {
        const wStart = new Date(start); wStart.setDate(1 + w * 7);
        const wEnd = new Date(wStart); wEnd.setDate(wStart.getDate() + 7);
        chart.push({
          label: `S${w + 1}`,
          appels: interactions.filter(i => i.type === 'Appel' && new Date(i.date_heure) >= wStart && new Date(i.date_heure) < wEnd).length,
          messages: interactions.filter(i => i.type !== 'Appel' && new Date(i.date_heure) >= wStart && new Date(i.date_heure) < wEnd).length,
          interesses: interactions.filter(i => i.resultat === 'Intéressé' && new Date(i.date_heure) >= wStart && new Date(i.date_heure) < wEnd).length,
        });
      }
    } else {
      const months = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
      for (let m = 0; m < 12; m++) {
        const mStart = new Date(start.getFullYear(), m, 1);
        const mEnd = new Date(start.getFullYear(), m + 1, 1);
        chart.push({
          label: months[m],
          appels: interactions.filter(i => i.type === 'Appel' && new Date(i.date_heure) >= mStart && new Date(i.date_heure) < mEnd).length,
          messages: interactions.filter(i => i.type !== 'Appel' && new Date(i.date_heure) >= mStart && new Date(i.date_heure) < mEnd).length,
          interesses: interactions.filter(i => i.resultat === 'Intéressé' && new Date(i.date_heure) >= mStart && new Date(i.date_heure) < mEnd).length,
        });
      }
    }
    setChartData(chart);
    setLoading(false);
  }, [period]);

  useEffect(() => { loadData(); }, [loadData]);

  const { start, end } = getPeriodRange(period);

  const exportCSV = () => {
    const rows = [
      ['Métrique', 'Valeur'],
      ['Période', PERIOD_LABELS[period]],
      ['Du', fmtDate(start)],
      ['Au', fmtDate(end)],
      [''],
      ['=== INTERACTIONS ==='],
      ['Total interactions', kpi.totalInteractions],
      ['Appels', kpi.appels],
      ['Emails', kpi.emails],
      ['WhatsApp', kpi.whatsapp],
      ['SMS', kpi.sms],
      ['Facebook', kpi.facebook],
      ['Instagram', kpi.instagram],
      [''],
      ['=== RÉSULTATS ==='],
      ['Intéressés', kpi.interesses],
      ['Répondus', kpi.repondus],
      ['Non intéressés', kpi.nonInteresses],
      ['Pas de réponse', kpi.pasDeReponse],
      ['Relances', kpi.relances],
      ['Taux de réponse', `${kpi.tauxReponse}%`],
      ['Taux d\'intérêt', `${kpi.tauxInteret}%`],
      [''],
      ['=== CONTACTS ==='],
      ['Nouveaux contacts', kpi.nouveauxContacts],
      ['Contacts convertis', kpi.contactsConverti],
      [''],
      ['=== TÂCHES ==='],
      ['Tâches terminées', kpi.tachesTerminees],
      ['Tâches en attente', kpi.tachesEnAttente],
      [''],
      ['=== TEMPS DE TRAVAIL ==='],
      ['Sessions de travail', kpi.sessionsTravail],
      ['Temps total de travail', fmtMinutes(kpi.minutesTravail)],
      ['Durée totale des appels', fmtMinutes(kpi.dureeTotaleAppels)],
    ];
    const csv = rows.map(r => r.join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `rapport-${period}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const maxBar = Math.max(...chartData.map(d => d.appels + d.messages), 1);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Rapport & KPI</h1>
          <p className="text-slate-500 mt-1 text-sm">
            {fmtDate(start)} — {fmtDate(end)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-4 py-2.5 text-sm font-medium transition-colors ${
                  period === p
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <button
            onClick={exportCSV}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors shadow-sm"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Top KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon={Activity} color="blue" label="Total interactions" value={kpi.totalInteractions} sub={`+${kpi.nouveauxContacts} nouveaux contacts`} />
            <KpiCard icon={TrendingUp} color="green" label="Taux de réponse" value={`${kpi.tauxReponse}%`} sub={`${kpi.repondus + kpi.interesses} réponses reçues`} />
            <KpiCard icon={Award} color="amber" label="Taux d'intérêt" value={`${kpi.tauxInteret}%`} sub={`${kpi.interesses} prospects intéressés`} />
            <KpiCard icon={Clock} color="slate" label="Temps travaillé" value={fmtMinutes(kpi.minutesTravail)} sub={`${kpi.sessionsTravail} session${kpi.sessionsTravail > 1 ? 's' : ''}`} />
          </div>

          {/* Bar chart */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <BarChart2 className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-semibold text-slate-900">Activité par période</h2>
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-500 inline-block" />Appels</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500 inline-block" />Messages</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-400 inline-block" />Intéressés</span>
              </div>
            </div>
            <div className="flex items-end gap-2 h-48 overflow-x-auto pb-2">
              {chartData.map((d, i) => {
                const totalH = ((d.appels + d.messages) / maxBar) * 100;
                const appelsH = (d.appels / maxBar) * 100;
                const msgH = (d.messages / maxBar) * 100;
                return (
                  <div key={i} className="flex-1 min-w-[28px] flex flex-col items-center gap-1 group">
                    <div className="w-full flex flex-col justify-end gap-0.5" style={{ height: 160 }}>
                      {d.appels > 0 && (
                        <div
                          className="w-full bg-blue-500 rounded-t transition-all duration-300 group-hover:opacity-80"
                          style={{ height: `${appelsH}%` }}
                          title={`${d.appels} appels`}
                        />
                      )}
                      {d.messages > 0 && (
                        <div
                          className="w-full bg-emerald-500 rounded-t transition-all duration-300 group-hover:opacity-80"
                          style={{ height: `${msgH}%` }}
                          title={`${d.messages} messages`}
                        />
                      )}
                      {totalH === 0 && (
                        <div className="w-full bg-slate-100 rounded-t" style={{ height: '8px' }} />
                      )}
                    </div>
                    {d.interesses > 0 && (
                      <div className="w-2 h-2 bg-amber-400 rounded-full" title={`${d.interesses} intéressés`} />
                    )}
                    <span className="text-xs text-slate-400 font-medium">{d.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3 columns: Interactions breakdown, Results, Time */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Interactions par type */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-center gap-3 mb-5">
                <MessageCircle className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold text-slate-900">Par canal</h3>
              </div>
              <div className="space-y-3">
                <BreakdownRow icon={Phone} label="Appels" value={kpi.appels} total={kpi.totalInteractions} color="blue" sub={`${fmtMinutes(kpi.dureeTotaleAppels)} au total`} />
                <BreakdownRow icon={Mail} label="Emails" value={kpi.emails} total={kpi.totalInteractions} color="violet" />
                <BreakdownRow icon={MessageCircle} label="WhatsApp" value={kpi.whatsapp} total={kpi.totalInteractions} color="green" />
                <BreakdownRow icon={MessageCircle} label="SMS" value={kpi.sms} total={kpi.totalInteractions} color="orange" />
                <BreakdownRow icon={FacebookIcon} label="Facebook" value={kpi.facebook} total={kpi.totalInteractions} color="blue" />
                <BreakdownRow icon={InstagramIcon} label="Instagram" value={kpi.instagram} total={kpi.totalInteractions} color="pink" />
              </div>
            </div>

            {/* Résultats */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-center gap-3 mb-5">
                <Target className="w-5 h-5 text-emerald-600" />
                <h3 className="font-semibold text-slate-900">Résultats</h3>
              </div>
              <div className="space-y-3">
                <ResultRow label="Intéressés" value={kpi.interesses} total={kpi.totalInteractions} color="bg-emerald-500" />
                <ResultRow label="Répondus" value={kpi.repondus} total={kpi.totalInteractions} color="bg-blue-500" />
                <ResultRow label="Relances" value={kpi.relances} total={kpi.totalInteractions} color="bg-amber-400" />
                <ResultRow label="Pas de réponse" value={kpi.pasDeReponse} total={kpi.totalInteractions} color="bg-slate-300" />
                <ResultRow label="Non intéressés" value={kpi.nonInteresses} total={kpi.totalInteractions} color="bg-red-400" />
              </div>
              <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-600">{kpi.tauxReponse}%</p>
                  <p className="text-xs text-slate-500 mt-0.5">Taux de réponse</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600">{kpi.tauxInteret}%</p>
                  <p className="text-xs text-slate-500 mt-0.5">Taux d'intérêt</p>
                </div>
              </div>
            </div>

            {/* Contacts & Temps */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-center gap-3 mb-5">
                <Users className="w-5 h-5 text-slate-600" />
                <h3 className="font-semibold text-slate-900">Contacts & Temps</h3>
              </div>
              <div className="space-y-3 mb-5">
                <div className="flex items-center justify-between p-3 bg-blue-50 rounded-xl">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-medium text-slate-700">Nouveaux contacts</span>
                  </div>
                  <span className="text-lg font-bold text-blue-600">{kpi.nouveauxContacts}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-xl">
                  <div className="flex items-center gap-2">
                    <Award className="w-4 h-4 text-emerald-600" />
                    <span className="text-sm font-medium text-slate-700">Convertis</span>
                  </div>
                  <span className="text-lg font-bold text-emerald-600">{kpi.contactsConverti}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-amber-50 rounded-xl">
                  <div className="flex items-center gap-2">
                    <CheckSquare className="w-4 h-4 text-amber-600" />
                    <span className="text-sm font-medium text-slate-700">Tâches terminées</span>
                  </div>
                  <span className="text-lg font-bold text-amber-600">{kpi.tachesTerminees}</span>
                </div>
              </div>
              <div className="pt-4 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Temps de travail</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Sessions</span>
                    <span className="font-semibold text-slate-900">{kpi.sessionsTravail}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Temps total</span>
                    <span className="font-semibold text-slate-900">{fmtMinutes(kpi.minutesTravail)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Durée appels</span>
                    <span className="font-semibold text-slate-900">{fmtMinutes(kpi.dureeTotaleAppels)}</span>
                  </div>
                  {kpi.sessionsTravail > 0 && kpi.minutesTravail > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Moy. par session</span>
                      <span className="font-semibold text-slate-900">{fmtMinutes(Math.round(kpi.minutesTravail / kpi.sessionsTravail))}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ icon: Icon, color, label, value, sub }: {
  icon: React.ComponentType<{ className?: string }>;
  color: 'blue' | 'green' | 'amber' | 'slate';
  label: string;
  value: string | number;
  sub?: string;
}) {
  const cfg = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    slate: 'bg-slate-100 text-slate-600',
  }[color];
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition-shadow">
      <div className={`w-10 h-10 rounded-xl ${cfg} flex items-center justify-center mb-3`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-2xl font-bold text-slate-900 leading-none">{value}</p>
      <p className="text-sm font-medium text-slate-600 mt-1">{label}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function BreakdownRow({ icon: Icon, label, value, total, color, sub }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: number; total: number; color: string; sub?: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const colors: Record<string, string> = {
    blue: 'bg-blue-500', green: 'bg-emerald-500', orange: 'bg-orange-500',
    violet: 'bg-violet-500', pink: 'bg-pink-500', slate: 'bg-slate-400',
  };
  return (
    <div className="flex items-center gap-3">
      <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
        <Icon className="w-3.5 h-3.5 text-slate-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center mb-0.5">
          <span className="text-sm text-slate-700 font-medium">{label}</span>
          <span className="text-sm font-bold text-slate-900">{value}</span>
        </div>
        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full ${colors[color] || 'bg-blue-500'} rounded-full transition-all`} style={{ width: `${pct}%` }} />
        </div>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
      <span className="text-xs text-slate-400 flex-shrink-0 w-9 text-right">{pct}%</span>
    </div>
  );
}

function ResultRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-slate-700 font-medium">{label}</span>
        <span className="font-bold text-slate-900">{value} <span className="text-slate-400 font-normal text-xs">({pct}%)</span></span>
      </div>
      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
