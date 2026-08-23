import { Check, Clock, X } from 'lucide-react';

export type RelanceEtape = {
  etape: number;
  label: string;
  jours: number;
  date_relance: string;
  statut: 'en_attente' | 'fait' | 'ignore';
  id: string;
  isPast: boolean;
  isToday: boolean;
};

const ETAPES_CONFIG = [
  { etape: 1, label: 'J+2', jours: 2 },
  { etape: 2, label: 'J+5', jours: 5 },
  { etape: 3, label: 'J+7', jours: 7 },
  { etape: 4, label: 'J+15', jours: 15 },
  { etape: 5, label: 'J+30', jours: 30 },
];

export { ETAPES_CONFIG };

type Props = {
  etapes: RelanceEtape[];
  onMarkDone?: (id: string) => void;
  onMarkIgnore?: (id: string) => void;
  onMarkPending?: (id: string) => void;
  compact?: boolean;
};

export default function RelanceTimeline({ etapes, onMarkDone, onMarkIgnore, onMarkPending, compact = false }: Props) {
  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });

  if (compact) {
    return (
      <div className="flex items-center gap-1">
        {etapes.map((e, i) => {
          const color =
            e.statut === 'fait' ? 'bg-emerald-500' :
            e.statut === 'ignore' ? 'bg-slate-200' :
            e.isToday ? 'bg-amber-400 ring-2 ring-amber-300 ring-offset-1' :
            e.isPast ? 'bg-red-400' :
            'bg-slate-200';
          return (
            <div key={e.id} className="flex items-center gap-1">
              <div className={`w-2.5 h-2.5 rounded-full ${color} flex-shrink-0`} title={`${e.label} — ${fmtDate(e.date_relance)}`} />
              {i < etapes.length - 1 && <div className="w-3 h-px bg-slate-200 flex-shrink-0" />}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Ligne de fond */}
      <div className="absolute top-5 left-5 right-5 h-0.5 bg-slate-100" />

      <div className="relative flex items-start justify-between gap-2">
        {etapes.map((e) => {
          const isDone = e.statut === 'fait';
          const isIgnored = e.statut === 'ignore';
          const isPending = e.statut === 'en_attente';

          const dotColor =
            isDone ? 'bg-emerald-500 border-emerald-500' :
            isIgnored ? 'bg-slate-200 border-slate-200' :
            e.isToday ? 'bg-amber-400 border-amber-400 ring-4 ring-amber-100' :
            e.isPast ? 'bg-red-400 border-red-400' :
            'bg-white border-slate-300';

          const labelColor =
            isDone ? 'text-emerald-600' :
            isIgnored ? 'text-slate-400' :
            e.isToday ? 'text-amber-600 font-bold' :
            e.isPast ? 'text-red-500 font-semibold' :
            'text-slate-500';

          return (
            <div key={e.id} className="flex flex-col items-center gap-2 flex-1">
              {/* Dot */}
              <div className={`relative w-10 h-10 rounded-full border-2 flex items-center justify-center z-10 ${dotColor} transition-all`}>
                {isDone && <Check className="w-4 h-4 text-white" />}
                {isIgnored && <X className="w-3.5 h-3.5 text-slate-400" />}
                {isPending && e.isToday && <Clock className="w-4 h-4 text-amber-600" />}
                {isPending && e.isPast && !e.isToday && <Clock className="w-4 h-4 text-red-500" />}
              </div>

              {/* Label */}
              <div className="text-center">
                <p className={`text-xs font-semibold ${labelColor}`}>{e.label}</p>
                <p className={`text-xs mt-0.5 ${isIgnored ? 'text-slate-300' : 'text-slate-400'}`}>
                  {fmtDate(e.date_relance)}
                </p>
                {e.isToday && <p className="text-xs text-amber-500 font-bold mt-0.5">Aujourd'hui</p>}
                {e.isPast && !e.isToday && isPending && <p className="text-xs text-red-500 mt-0.5">En retard</p>}
                {isDone && <p className="text-xs text-emerald-500 mt-0.5">Fait</p>}
              </div>

              {/* Actions */}
              {isPending && onMarkDone && onMarkIgnore && (
                <div className="flex gap-1">
                  <button
                    onClick={() => onMarkDone(e.id)}
                    className="p-1 text-xs text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                    title="Marquer comme fait"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onMarkIgnore(e.id)}
                    className="p-1 text-xs text-slate-400 hover:bg-slate-100 rounded-lg transition-colors"
                    title="Ignorer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {(isDone || isIgnored) && onMarkPending && (
                <button
                  onClick={() => onMarkPending(e.id)}
                  className="text-xs text-slate-400 hover:text-slate-600 underline"
                  title="Remettre en attente"
                >
                  Annuler
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
