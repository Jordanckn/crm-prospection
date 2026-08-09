import { useEffect, useState, useRef } from 'react';
import { Phone, Mail, MessageCircle, TrendingUp, Target, Calendar, CheckSquare, ChevronDown, Globe } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Contact, Tache } from '../types/database';

type Stats = {
  appelsAujourdhui: number;
  messagesAujourdhui: number;
  reponsesAujourdhui: number;
  tauxConversion: number;
  objectifAppels: number;
  objectifMessages: number;
};

type RecentActivity = {
  type: string;
  contact: string;
  time: string;
  result: string;
};

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    appelsAujourdhui: 0,
    messagesAujourdhui: 0,
    reponsesAujourdhui: 0,
    tauxConversion: 0,
    objectifAppels: 50,
    objectifMessages: 30,
  });
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);
  const [tachesEnAttente, setTachesEnAttente] = useState<(Tache & { contacts?: Contact | null })[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPays, setFilterPays] = useState<string>('');
  const [contactsByPays, setContactsByPays] = useState<Record<string, number>>({});
  const [paysDropdownOpen, setPaysDropdownOpen] = useState(false);
  const paysDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadDashboardData();
  }, [filterPays]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (paysDropdownRef.current && !paysDropdownRef.current.contains(e.target as Node)) {
        setPaysDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const loadDashboardData = async () => {
    try {
      const aujourdhui = new Date();
      aujourdhui.setHours(0, 0, 0, 0);
      const demain = new Date(aujourdhui);
      demain.setDate(demain.getDate() + 1);

      let interactionsQuery = supabase
        .from('interactions')
        .select('*, contacts(prenom, nom, pays)')
        .gte('date_heure', aujourdhui.toISOString())
        .lt('date_heure', demain.toISOString());

      if (filterPays) {
        interactionsQuery = interactionsQuery.eq('contacts.pays', filterPays);
      }

      const { data: interactions } = await interactionsQuery.order('date_heure', { ascending: false });

      const { data: allContacts } = await supabase
        .from('contacts')
        .select('pays');

      if (allContacts) {
        const counts: Record<string, number> = {};
        allContacts.forEach(c => {
          if (c.pays) counts[c.pays] = (counts[c.pays] || 0) + 1;
        });
        setContactsByPays(counts);
      }

      const { data: taches } = await supabase
        .from('taches')
        .select('*, contacts(*)')
        .eq('statut', 'En attente')
        .order('date_echeance', { ascending: true })
        .limit(5);

      if (taches) {
        setTachesEnAttente(taches);
      }

      const { data: { user } } = await supabase.auth.getUser();
      const objectifQuery = supabase
        .from('objectifs')
        .select('*')
        .eq('date', aujourdhui.toISOString().split('T')[0]);
      const { data: objectif } = user
        ? await objectifQuery.eq('user_id', user.id).maybeSingle()
        : { data: null };

      if (interactions) {
        const appels = interactions.filter(i => i.type === 'Appel').length;
        const messages = interactions.filter(i =>
          i.type === 'Email' || i.type === 'WhatsApp' || i.type === 'SMS'
        ).length;
        const reponses = interactions.filter(i =>
          i.resultat === 'Répondu' || i.resultat === 'Intéressé'
        ).length;

        const taux = interactions.length > 0
          ? Math.round((reponses / interactions.length) * 100)
          : 0;

        setStats({
          appelsAujourdhui: appels,
          messagesAujourdhui: messages,
          reponsesAujourdhui: reponses,
          tauxConversion: taux,
          objectifAppels: objectif?.appels_objectif || 50,
          objectifMessages: objectif?.messages_objectif || 30,
        });

        const activities: RecentActivity[] = interactions.slice(0, 5).map(i => ({
          type: i.type,
          contact: (i.contacts as any)?.prenom + ' ' + (i.contacts as any)?.nom || 'Inconnu',
          time: new Date(i.date_heure).toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit'
          }),
          result: i.resultat || 'En cours',
        }));
        setRecentActivities(activities);
      }
    } catch (error) {
      console.error('Erreur:', error);
    } finally {
      setLoading(false);
    }
  };

  const progressAppels = Math.min((stats.appelsAujourdhui / stats.objectifAppels) * 100, 100);
  const progressMessages = Math.min((stats.messagesAujourdhui / stats.objectifMessages) * 100, 100);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-500">Chargement...</div>
      </div>
    );
  }

  const PAYS_FLAGS: Record<string, string> = {
    'France': '🇫🇷',
    'Israël': '🇮🇱',
  };

  const getPaysFlag = (pays: string) => PAYS_FLAGS[pays] || '🌍';

  const paysOptions = Object.keys(contactsByPays).sort();
  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Tableau de bord</h1>
            <p className="text-slate-600 mt-2">Vue d'ensemble de votre activité aujourd'hui</p>
          </div>
          <div className="relative" ref={paysDropdownRef}>
            <button
              onClick={() => setPaysDropdownOpen(o => !o)}
              className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm min-w-40"
            >
              {filterPays ? (
                <>
                  <span>{getPaysFlag(filterPays)}</span>
                  <span className="flex-1 text-left">{filterPays}</span>
                </>
              ) : (
                <>
                  <Globe className="w-4 h-4 text-slate-400" />
                  <span className="flex-1 text-left">Tous les pays</span>
                </>
              )}
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${paysDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {paysDropdownOpen && (
              <div className="absolute right-0 mt-1.5 w-52 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                <button
                  onClick={() => { setFilterPays(''); setPaysDropdownOpen(false); }}
                  className={`w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                    filterPays === '' ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Globe className="w-4 h-4 text-slate-400" />
                  <span className="flex-1">Tous les pays</span>
                  <span className="text-xs text-slate-400">{Object.values(contactsByPays).reduce((a, b) => a + b, 0)}</span>
                </button>
                <div className="border-t border-slate-100" />
                {paysOptions.map(pays => (
                  <button
                    key={pays}
                    onClick={() => { setFilterPays(pays); setPaysDropdownOpen(false); }}
                    className={`w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                      filterPays === pays ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>{getPaysFlag(pays)}</span>
                    <span className="flex-1">{pays}</span>
                    <span className="text-xs text-slate-400">{contactsByPays[pays]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={Phone}
          label="Appels aujourd'hui"
          value={stats.appelsAujourdhui}
          color="blue"
        />
        <StatCard
          icon={MessageCircle}
          label="Messages envoyés"
          value={stats.messagesAujourdhui}
          color="green"
        />
        <StatCard
          icon={Mail}
          label="Réponses reçues"
          value={stats.reponsesAujourdhui}
          color="purple"
        />
        <StatCard
          icon={TrendingUp}
          label="Taux de conversion"
          value={`${stats.tauxConversion}%`}
          color="orange"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-6">
            <Target className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-semibold text-slate-900">Objectifs du jour</h2>
          </div>

          <div className="space-y-6">
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-slate-700">Appels</span>
                <span className="text-sm font-bold text-slate-900">
                  {stats.appelsAujourdhui} / {stats.objectifAppels}
                </span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-blue-600 h-full rounded-full transition-all duration-500"
                  style={{ width: `${progressAppels}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {progressAppels >= 100 ? 'Objectif atteint!' : `${Math.round(progressAppels)}% complété`}
              </p>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-slate-700">Messages</span>
                <span className="text-sm font-bold text-slate-900">
                  {stats.messagesAujourdhui} / {stats.objectifMessages}
                </span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-green-600 h-full rounded-full transition-all duration-500"
                  style={{ width: `${progressMessages}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {progressMessages >= 100 ? 'Objectif atteint!' : `${Math.round(progressMessages)}% complété`}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-6">
            <Calendar className="w-6 h-6 text-green-600" />
            <h2 className="text-xl font-semibold text-slate-900">Activité récente</h2>
          </div>

          {recentActivities.length === 0 ? (
            <p className="text-slate-500 text-center py-8">Aucune activité aujourd'hui</p>
          ) : (
            <div className="space-y-3">
              {recentActivities.map((activity, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    activity.type === 'Appel' ? 'bg-blue-100' :
                    activity.type === 'Email' ? 'bg-purple-100' :
                    activity.type === 'WhatsApp' ? 'bg-green-100' : 'bg-orange-100'
                  }`}>
                    {activity.type === 'Appel' && <Phone className="w-5 h-5 text-blue-600" />}
                    {activity.type === 'Email' && <Mail className="w-5 h-5 text-purple-600" />}
                    {activity.type === 'WhatsApp' && <MessageCircle className="w-5 h-5 text-green-600" />}
                    {activity.type === 'SMS' && <MessageCircle className="w-5 h-5 text-orange-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{activity.contact}</p>
                    <p className="text-xs text-slate-500">{activity.type} • {activity.result}</p>
                  </div>
                  <span className="text-xs text-slate-400">{activity.time}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <CheckSquare className="w-6 h-6 text-orange-600" />
            <h2 className="text-xl font-semibold text-slate-900">Tâches à réaliser</h2>
          </div>
          <span className="text-sm text-slate-500">{tachesEnAttente.length} en attente</span>
        </div>

        {tachesEnAttente.length === 0 ? (
          <p className="text-slate-500 text-center py-8">Aucune tâche en attente</p>
        ) : (
          <div className="space-y-3">
            {tachesEnAttente.map((tache) => {
              const contact = tache.contacts;
              const isOverdue = tache.date_echeance && new Date(tache.date_echeance) < new Date();

              return (
                <div
                  key={tache.id}
                  className={`p-4 rounded-lg border transition-colors ${
                    isOverdue
                      ? 'bg-red-50 border-red-200 hover:bg-red-100'
                      : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <h3 className={`font-semibold mb-1 ${isOverdue ? 'text-red-900' : 'text-slate-900'}`}>
                        {tache.titre}
                      </h3>
                      {contact && (
                        <p className="text-sm text-slate-600 mb-2">
                          Contact: {contact.prenom} {contact.nom}
                        </p>
                      )}
                      {tache.date_echeance && (
                        <div className={`flex items-center gap-2 text-xs ${
                          isOverdue ? 'text-red-600 font-semibold' : 'text-slate-500'
                        }`}>
                          <Calendar className="w-3 h-3" />
                          {new Date(tache.date_echeance).toLocaleDateString('fr-FR', {
                            day: '2-digit',
                            month: 'long',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                          {isOverdue && (
                            <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-semibold">
                              En retard
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

type StatCardProps = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  color: 'blue' | 'green' | 'purple' | 'orange';
};

function StatCard({ icon: Icon, label, value, color }: StatCardProps) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    green: 'bg-green-50 text-green-600 border-green-200',
    purple: 'bg-purple-50 text-purple-600 border-purple-200',
    orange: 'bg-orange-50 text-orange-600 border-orange-200',
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 hover:shadow-md transition-shadow">
      <div className={`w-12 h-12 rounded-lg ${colorClasses[color]} border flex items-center justify-center mb-4`}>
        <Icon className="w-6 h-6" />
      </div>
      <p className="text-slate-600 text-sm font-medium mb-1">{label}</p>
      <p className="text-3xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
