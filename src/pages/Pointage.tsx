import { useEffect, useState, useRef, useCallback } from 'react';
import {
  Clock, Play, Square, Trash2, CreditCard as Edit3, Check, X, Timer,
  Phone, Briefcase, TrendingUp, BarChart2, ChevronDown, ChevronUp,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePermissions } from '../contexts/PermissionsContext';
import { dateKeyInTimezone, formatInTimezone, mondayKeyInTimezone, safeTimezone } from '../lib/timezone';

type TypeSession = 'travail' | 'prospection';

type Session = {
  id: string;
  user_id: string;
  debut: string;
  fin: string | null;
  duree_minutes: number | null;
  notes: string;
  type_session: TypeSession;
  created_at: string;
};

function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${String(m).padStart(2, '0')}min` : `${h}h`;
}

function fmtTime(iso: string, timezone: string): string {
  return formatInTimezone(iso, timezone, { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso: string, timezone: string): string {
  return formatInTimezone(iso, timezone, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function liveMinutes(debut: string): number {
  return Math.floor((Date.now() - new Date(debut).getTime()) / 60000);
}

function groupByDate(sessions: Session[], timezone: string): { date: string; items: Session[] }[] {
  const map = new Map<string, Session[]>();
  for (const s of sessions) {
    const d = dateKeyInTimezone(s.debut, timezone);
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(s);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, items]) => ({ date, items }));
}

function pct(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
}

export default function Pointage({ timezone: requestedTimezone }: { timezone?: string }) {
  const timezone = safeTimezone(requestedTimezone);
  const { canDelete } = usePermissions();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [editId, setEditId] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<TypeSession>('travail');
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadSessions = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);
    const { data } = await supabase
      .from('sessions_travail')
      .select('*')
      .eq('user_id', user.id)
      .order('debut', { ascending: false })
      .limit(200);
    const all: Session[] = (data || []).map(s => ({ ...s, type_session: s.type_session || 'travail' }));
    setSessions(all);
    const running = all.find(s => !s.fin);
    setActiveSession(running || null);
    if (running) setElapsed(liveMinutes(running.debut));
    // Expand today by default
    const today = dateKeyInTimezone(new Date(), timezone);
    setExpandedDates(new Set([today]));
    setLoading(false);
  }, [timezone]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  useEffect(() => {
    if (activeSession) {
      tickRef.current = setInterval(() => {
        setElapsed(liveMinutes(activeSession.debut));
      }, 10000);
    } else {
      if (tickRef.current) clearInterval(tickRef.current);
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [activeSession]);

  const upsertRecap = async (date: string, allSessions: Session[]) => {
    if (!userId) return;
    const daySessions = allSessions.filter(s => dateKeyInTimezone(s.debut, timezone) === date && s.fin);
    const minutes_travail = daySessions
      .filter(s => s.type_session === 'travail')
      .reduce((sum, s) => sum + (s.duree_minutes || 0), 0);
    const minutes_prospection = daySessions
      .filter(s => s.type_session === 'prospection')
      .reduce((sum, s) => sum + (s.duree_minutes || 0), 0);
    await supabase.from('recaps_journaliers').upsert(
      { user_id: userId, jour: date, minutes_travail, minutes_prospection },
      { onConflict: 'brand_id,user_id,jour' }
    );
  };

  const startSession = async () => {
    if (!userId || activeSession) return;
    const { data, error } = await supabase
      .from('sessions_travail')
      .insert([{ user_id: userId, debut: new Date().toISOString(), notes: '', type_session: selectedType }])
      .select()
      .single();
    if (!error && data) {
      const s = { ...data, type_session: data.type_session || selectedType } as Session;
      setActiveSession(s);
      setElapsed(0);
      setSessions(prev => [s, ...prev]);
    }
  };

  const stopSession = async () => {
    if (!activeSession) return;
    const fin = new Date().toISOString();
    const duree = Math.round((new Date(fin).getTime() - new Date(activeSession.debut).getTime()) / 60000);
    const { error } = await supabase
      .from('sessions_travail')
      .update({ fin, duree_minutes: duree })
      .eq('id', activeSession.id);
    if (!error) {
      const updated = sessions.map(s =>
        s.id === activeSession.id ? { ...s, fin, duree_minutes: duree } : s
      );
      setSessions(updated);
      await upsertRecap(dateKeyInTimezone(activeSession.debut, timezone), updated);
      setActiveSession(null);
      setElapsed(0);
    }
  };

  const deleteSession = async (id: string) => {
    const s = sessions.find(s => s.id === id);
    await supabase.from('sessions_travail').delete().eq('id', id);
    const updated = sessions.filter(s => s.id !== id);
    setSessions(updated);
    if (s) await upsertRecap(dateKeyInTimezone(s.debut, timezone), updated);
    if (activeSession?.id === id) { setActiveSession(null); setElapsed(0); }
  };

  const saveNotes = async (id: string) => {
    await supabase.from('sessions_travail').update({ notes: editNotes }).eq('id', id);
    setSessions(prev => prev.map(s => s.id === id ? { ...s, notes: editNotes } : s));
    setEditId(null);
  };

  const toggleDate = (date: string) => {
    setExpandedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const grouped = groupByDate(sessions, timezone);
  const today = dateKeyInTimezone(new Date(), timezone);

  const todaySessions = sessions.filter(s => dateKeyInTimezone(s.debut, timezone) === today);
  const todayTravail = todaySessions
    .filter(s => s.type_session === 'travail')
    .reduce((sum, s) => sum + (s.duree_minutes || (s.fin ? 0 : liveMinutes(s.debut))), 0);
  const todayProspection = todaySessions
    .filter(s => s.type_session === 'prospection')
    .reduce((sum, s) => sum + (s.duree_minutes || (s.fin ? 0 : liveMinutes(s.debut))), 0);
  const todayTotal = todayTravail + todayProspection;

  const monday = mondayKeyInTimezone(timezone);
  const weekSessions = sessions.filter(s => dateKeyInTimezone(s.debut, timezone) >= monday);
  const weekTravail = weekSessions.filter(s => s.type_session === 'travail').reduce((sum, s) => sum + (s.duree_minutes || 0), 0);
  const weekProspection = weekSessions.filter(s => s.type_session === 'prospection').reduce((sum, s) => sum + (s.duree_minutes || 0), 0);
  const weekTotal = weekTravail + weekProspection;

  const elapsedDisplay = elapsed < 60
    ? `${elapsed} min`
    : `${Math.floor(elapsed / 60)}h ${String(elapsed % 60).padStart(2, '0')}min`;

  const isProspection = activeSession?.type_session === 'prospection' || (!activeSession && selectedType === 'prospection');

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Pointage</h1>
        <p className="text-slate-500 mt-1">Suivi du temps de travail et de la prospection commerciale · {timezone}</p>
      </div>

      {/* Type selector + Timer card */}
      <div className={`rounded-2xl border-2 p-8 text-center transition-all duration-300 ${
        activeSession
          ? isProspection
            ? 'border-emerald-300 bg-gradient-to-br from-emerald-50 to-teal-50 shadow-lg shadow-emerald-100'
            : 'border-blue-300 bg-gradient-to-br from-blue-50 to-sky-50 shadow-lg shadow-blue-100'
          : 'border-slate-200 bg-white'
      }`}>

        {/* Type toggle (only when no active session) */}
        {!activeSession && (
          <div className="flex items-center justify-center gap-2 mb-6">
            <span className="text-sm font-medium text-slate-500 mr-2">Type de session :</span>
            <button
              onClick={() => setSelectedType('travail')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                selectedType === 'travail'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Briefcase className="w-4 h-4" />
              Travail effectif
            </button>
            <button
              onClick={() => setSelectedType('prospection')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                selectedType === 'prospection'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Phone className="w-4 h-4" />
              Appels & Prospection
            </button>
          </div>
        )}

        {activeSession && (
          <div className="flex items-center justify-center gap-2 mb-2">
            {isProspection
              ? <Phone className="w-5 h-5 text-emerald-600 animate-pulse" />
              : <Timer className="w-5 h-5 text-blue-600 animate-pulse" />
            }
            <span className={`text-sm font-semibold uppercase tracking-widest ${isProspection ? 'text-emerald-600' : 'text-blue-600'}`}>
              {isProspection ? 'Appels & Prospection en cours' : 'Session de travail en cours'}
            </span>
          </div>
        )}

        {!activeSession && (
          <div className="flex items-center justify-center gap-2 mb-2">
            <Timer className="w-5 h-5 text-slate-400" />
            <span className="text-sm font-semibold uppercase tracking-widest text-slate-400">Prêt à démarrer</span>
          </div>
        )}

        <div className={`text-6xl font-bold tracking-tight mb-2 transition-all ${
          activeSession
            ? isProspection ? 'text-emerald-700' : 'text-blue-700'
            : 'text-slate-300'
        }`}>
          {activeSession ? elapsedDisplay : '0 min'}
        </div>

        {activeSession && (
          <p className={`text-sm mb-6 ${isProspection ? 'text-emerald-500' : 'text-blue-500'}`}>
            Démarrée à {fmtTime(activeSession.debut, timezone)}
          </p>
        )}

        <div className="flex items-center justify-center gap-4 mt-4">
          {!activeSession ? (
            <button
              onClick={startSession}
              className={`flex items-center gap-3 px-8 py-4 text-white rounded-2xl font-semibold text-lg transition-all shadow-lg hover:scale-105 ${
                selectedType === 'prospection'
                  ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/30 hover:shadow-emerald-500/50'
                  : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/30 hover:shadow-blue-500/50'
              }`}
            >
              <Play className="w-6 h-6" />
              Démarrer
            </button>
          ) : (
            <button
              onClick={stopSession}
              className="flex items-center gap-3 px-8 py-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-semibold text-lg transition-all shadow-lg shadow-red-500/30 hover:scale-105"
            >
              <Square className="w-6 h-6" />
              Terminer la session
            </button>
          )}
        </div>
      </div>

      {/* Stats aujourd'hui */}
      <div>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Aujourd'hui</h2>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 bg-slate-100 rounded-lg flex items-center justify-center">
                <Clock className="w-4 h-4 text-slate-600" />
              </div>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Total</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{fmtDuration(todayTotal)}</p>
            <p className="text-xs text-slate-400 mt-0.5">temps cumulé</p>
          </div>
          <div className="bg-white rounded-2xl border border-blue-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center">
                <Briefcase className="w-4 h-4 text-blue-600" />
              </div>
              <span className="text-xs font-semibold text-blue-500 uppercase tracking-wide">Travail</span>
            </div>
            <p className="text-2xl font-bold text-blue-700">{fmtDuration(todayTravail)}</p>
            <p className="text-xs text-blue-400 mt-0.5">{pct(todayTravail, todayTotal)}% du total</p>
          </div>
          <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 bg-emerald-100 rounded-lg flex items-center justify-center">
                <Phone className="w-4 h-4 text-emerald-600" />
              </div>
              <span className="text-xs font-semibold text-emerald-500 uppercase tracking-wide">Prospection</span>
            </div>
            <p className="text-2xl font-bold text-emerald-700">{fmtDuration(todayProspection)}</p>
            <p className="text-xs text-emerald-400 mt-0.5">{pct(todayProspection, todayTotal)}% du total</p>
          </div>
        </div>

        {/* Barre de répartition */}
        {todayTotal > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-500">Répartition du temps</span>
              <span className="text-xs text-slate-400">{fmtDuration(todayTotal)}</span>
            </div>
            <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
              {todayTravail > 0 && (
                <div
                  className="bg-blue-500 rounded-full transition-all"
                  style={{ width: `${pct(todayTravail, todayTotal)}%` }}
                  title={`Travail : ${fmtDuration(todayTravail)}`}
                />
              )}
              {todayProspection > 0 && (
                <div
                  className="bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${pct(todayProspection, todayTotal)}%` }}
                  title={`Prospection : ${fmtDuration(todayProspection)}`}
                />
              )}
            </div>
            <div className="flex items-center gap-4 mt-2">
              <span className="flex items-center gap-1.5 text-xs text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 flex-shrink-0" />
                Travail effectif
              </span>
              <span className="flex items-center gap-1.5 text-xs text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" />
                Appels & Prospection
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Stats semaine */}
      <div>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Cette semaine</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 bg-slate-100 rounded-lg flex items-center justify-center">
                <BarChart2 className="w-4 h-4 text-slate-600" />
              </div>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Total semaine</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{fmtDuration(weekTotal)}</p>
          </div>
          <div className="bg-white rounded-2xl border border-blue-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center">
                <Briefcase className="w-4 h-4 text-blue-600" />
              </div>
              <span className="text-xs font-semibold text-blue-500 uppercase tracking-wide">Travail</span>
            </div>
            <p className="text-2xl font-bold text-blue-700">{fmtDuration(weekTravail)}</p>
            <p className="text-xs text-blue-400 mt-0.5">{pct(weekTravail, weekTotal)}% du total</p>
          </div>
          <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 bg-emerald-100 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              </div>
              <span className="text-xs font-semibold text-emerald-500 uppercase tracking-wide">Prospection</span>
            </div>
            <p className="text-2xl font-bold text-emerald-700">{fmtDuration(weekProspection)}</p>
            <p className="text-xs text-emerald-400 mt-0.5">{pct(weekProspection, weekTotal)}% du total</p>
          </div>
        </div>
      </div>

      {/* Sessions list */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 text-slate-600" />
            <h2 className="font-semibold text-slate-900">Historique des sessions</h2>
          </div>
          <span className="text-sm text-slate-400">{sessions.filter(s => s.fin).length} sessions</span>
        </div>

        {grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <Clock className="w-12 h-12 text-slate-200 mb-3" />
            <p className="text-slate-500 font-medium">Aucune session enregistrée</p>
            <p className="text-slate-400 text-sm mt-1">Démarrez votre première session ci-dessus</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {grouped.map(({ date, items }) => {
              const dayTravail = items
                .filter(s => s.type_session === 'travail')
                .reduce((sum, s) => sum + (s.duree_minutes || (s.fin ? 0 : liveMinutes(s.debut))), 0);
              const dayProspection = items
                .filter(s => s.type_session === 'prospection')
                .reduce((sum, s) => sum + (s.duree_minutes || (s.fin ? 0 : liveMinutes(s.debut))), 0);
              const dayTotal = dayTravail + dayProspection;
              const isExpanded = expandedDates.has(date);

              return (
                <div key={date}>
                  {/* Day header */}
                  <button
                    onClick={() => toggleDate(date)}
                    className="w-full px-6 py-3 bg-slate-50 hover:bg-slate-100 transition-colors flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-slate-700 capitalize">{fmtDate(date + 'T12:00:00Z', timezone)}</span>
                      {isExpanded
                        ? <ChevronUp className="w-4 h-4 text-slate-400" />
                        : <ChevronDown className="w-4 h-4 text-slate-400" />
                      }
                    </div>
                    <div className="flex items-center gap-3">
                      {dayTravail > 0 && (
                        <span className="flex items-center gap-1 text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                          <Briefcase className="w-3 h-3" />
                          {fmtDuration(dayTravail)}
                        </span>
                      )}
                      {dayProspection > 0 && (
                        <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                          <Phone className="w-3 h-3" />
                          {fmtDuration(dayProspection)}
                        </span>
                      )}
                      <span className="text-sm font-bold text-slate-700">{fmtDuration(dayTotal)}</span>
                    </div>
                  </button>

                  {isExpanded && items.map(session => {
                    const dur = session.duree_minutes ?? (session.fin ? null : elapsed);
                    const isActive = !session.fin;
                    const isProsp = session.type_session === 'prospection';
                    return (
                      <div
                        key={session.id}
                        className={`px-6 py-4 flex items-start gap-4 hover:bg-slate-50 transition-colors border-t border-slate-50 ${
                          isActive ? (isProsp ? 'bg-emerald-50/40' : 'bg-blue-50/40') : ''
                        }`}
                      >
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                          isActive
                            ? isProsp ? 'bg-emerald-100' : 'bg-blue-100'
                            : isProsp ? 'bg-emerald-50' : 'bg-slate-100'
                        }`}>
                          {isProsp
                            ? <Phone className={`w-4 h-4 ${isActive ? 'text-emerald-600' : 'text-emerald-500'}`} />
                            : <Clock className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-slate-500'}`} />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-sm font-semibold ${
                              isActive ? (isProsp ? 'text-emerald-700' : 'text-blue-700') : 'text-slate-900'
                            }`}>
                              {fmtTime(session.debut, timezone)}
                              {session.fin && <> → {fmtTime(session.fin, timezone)}</>}
                              {isActive && (
                                <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-medium ${
                                  isProsp ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                                }`}>En cours</span>
                              )}
                            </span>
                            {dur !== null && (
                              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                                isActive
                                  ? isProsp ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'
                                  : isProsp ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-600'
                              }`}>
                                {fmtDuration(dur)}
                              </span>
                            )}
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                              isProsp
                                ? 'text-emerald-600 border-emerald-200 bg-emerald-50'
                                : 'text-blue-600 border-blue-200 bg-blue-50'
                            }`}>
                              {isProsp ? 'Prospection' : 'Travail'}
                            </span>
                          </div>
                          {editId === session.id ? (
                            <div className="flex items-center gap-2 mt-2">
                              <input
                                autoFocus
                                value={editNotes}
                                onChange={e => setEditNotes(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveNotes(session.id); if (e.key === 'Escape') setEditId(null); }}
                                placeholder="Ajouter une note..."
                                className="flex-1 text-sm px-3 py-1.5 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                              />
                              <button onClick={() => saveNotes(session.id)} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg"><Check className="w-4 h-4" /></button>
                              <button onClick={() => setEditId(null)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4" /></button>
                            </div>
                          ) : (
                            session.notes && <p className="text-xs text-slate-500 mt-1 italic">{session.notes}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => { setEditId(session.id); setEditNotes(session.notes || ''); }}
                            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            title="Modifier la note"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          {canDelete && <button
                            onClick={() => deleteSession(session.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Supprimer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
