import { useState, useMemo } from 'react';
import { X, Maximize2 } from 'lucide-react';
import { Interaction } from '../types/database';

type Props = {
  interactions: Interaction[];
  selectedDate: string;
  filterPeriod: 'day' | 'week' | 'month';
};

const CHANNEL_COLORS: Record<string, string> = {
  Appel: '#3b82f6',
  WhatsApp: '#22c55e',
  SMS: '#f97316',
  Email: '#ef4444',
  Facebook: '#1d4ed8',
  Instagram: '#ec4899',
};

const ALL_CHANNELS = ['Appel', 'WhatsApp', 'SMS', 'Email', 'Facebook', 'Instagram'];

type DataPoint = { label: string; date: Date; counts: Record<string, number> };

function buildDataPoints(interactions: Interaction[], selectedDate: string, filterPeriod: 'day' | 'week' | 'month'): DataPoint[] {
  const base = new Date(selectedDate);
  const points: DataPoint[] = [];

  if (filterPeriod === 'day') {
    for (let h = 0; h < 24; h++) {
      const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, 0, 0);
      const end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, 59, 59, 999);
      const counts: Record<string, number> = {};
      ALL_CHANNELS.forEach((c) => (counts[c] = 0));
      interactions.forEach((i) => {
        const d = new Date(i.date_heure);
        if (d >= start && d <= end) counts[i.type] = (counts[i.type] || 0) + 1;
      });
      points.push({ label: `${String(h).padStart(2, '0')}h`, date: start, counts });
    }
  } else if (filterPeriod === 'week') {
    const dayOfWeek = base.getDay();
    const diff = base.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const monday = new Date(base);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);
    const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    for (let d = 0; d < 7; d++) {
      const start = new Date(monday);
      start.setDate(monday.getDate() + d);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      const counts: Record<string, number> = {};
      ALL_CHANNELS.forEach((c) => (counts[c] = 0));
      interactions.forEach((i) => {
        const id = new Date(i.date_heure);
        if (id >= start && id <= end) counts[i.type] = (counts[i.type] || 0) + 1;
      });
      points.push({ label: dayNames[d], date: start, counts });
    }
  } else {
    const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const start = new Date(base.getFullYear(), base.getMonth(), d, 0, 0, 0);
      const end = new Date(base.getFullYear(), base.getMonth(), d, 23, 59, 59, 999);
      const counts: Record<string, number> = {};
      ALL_CHANNELS.forEach((c) => (counts[c] = 0));
      interactions.forEach((i) => {
        const id = new Date(i.date_heure);
        if (id >= start && id <= end) counts[i.type] = (counts[i.type] || 0) + 1;
      });
      points.push({ label: `${d}`, date: start, counts });
    }
  }

  return points;
}

function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cpx = (prev.x + curr.x) / 2;
    d += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
  }
  return d;
}

type ChartContentProps = {
  data: DataPoint[];
  activeChannels: Set<string>;
  width: number;
  height: number;
  padL?: number;
  padR?: number;
  padT?: number;
  padB?: number;
};

function ChartContent({ data, activeChannels, width, height, padL = 32, padR = 16, padT = 16, padB = 28 }: ChartContentProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; counts: Record<string, number> } | null>(null);

  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  const maxVal = useMemo(() => {
    let m = 1;
    data.forEach((p) => {
      ALL_CHANNELS.forEach((c) => {
        if (activeChannels.has(c) && p.counts[c] > m) m = p.counts[c];
      });
    });
    return m;
  }, [data, activeChannels]);

  const stepX = data.length > 1 ? chartW / (data.length - 1) : chartW;

  const getY = (val: number) => padT + chartH - (val / maxVal) * chartH;
  const getX = (i: number) => padL + i * stepX;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * maxVal));
  const uniqueGrid = [...new Set(gridLines)];

  const labelStep = Math.max(1, Math.ceil(data.length / 10));

  return (
    <svg
      width={width}
      height={height}
      onMouseLeave={() => setTooltip(null)}
      className="overflow-visible"
    >
      {uniqueGrid.map((v) => {
        const y = getY(v);
        return (
          <g key={v}>
            <line x1={padL} y1={y} x2={padL + chartW} y2={y} stroke="#e5e7eb" strokeWidth={1} />
            <text x={padL - 4} y={y + 4} textAnchor="end" fontSize={9} fill="#9ca3af">{v}</text>
          </g>
        );
      })}

      {data.map((p, i) => {
        if (i % labelStep !== 0 && i !== data.length - 1) return null;
        return (
          <text key={i} x={getX(i)} y={height - 4} textAnchor="middle" fontSize={9} fill="#9ca3af">
            {p.label}
          </text>
        );
      })}

      {ALL_CHANNELS.filter((c) => activeChannels.has(c)).map((channel) => {
        const pts = data.map((p, i) => ({ x: getX(i), y: getY(p.counts[channel] || 0) }));
        const path = smoothPath(pts);
        const color = CHANNEL_COLORS[channel];

        const areaPath = path + ` L ${pts[pts.length - 1].x} ${padT + chartH} L ${pts[0].x} ${padT + chartH} Z`;

        return (
          <g key={channel}>
            <path d={areaPath} fill={color} fillOpacity={0.08} stroke="none" />
            <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {pts.map((pt, i) => (
              data[i].counts[channel] > 0 && (
                <circle key={i} cx={pt.x} cy={pt.y} r={3} fill={color} />
              )
            ))}
          </g>
        );
      })}

      {data.map((p, i) => (
        <rect
          key={i}
          x={getX(i) - stepX / 2}
          y={padT}
          width={stepX}
          height={chartH}
          fill="transparent"
          onMouseEnter={() => {
            setTooltip({ x: getX(i), y: padT, label: p.label, counts: p.counts });
          }}
        />
      ))}

      {tooltip && (
        <g>
          <line x1={tooltip.x} y1={padT} x2={tooltip.x} y2={padT + chartH} stroke="#d1d5db" strokeWidth={1} strokeDasharray="3,3" />
          <foreignObject
            x={tooltip.x + 8 > padL + chartW - 110 ? tooltip.x - 118 : tooltip.x + 8}
            y={padT}
            width={110}
            height={ALL_CHANNELS.filter((c) => activeChannels.has(c) && tooltip.counts[c] > 0).length * 20 + 32}
          >
            <div
              style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 10px', fontSize: 11, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4, color: '#374151', fontSize: 11 }}>{tooltip.label}</div>
              {ALL_CHANNELS.filter((c) => activeChannels.has(c) && tooltip.counts[c] > 0).map((c) => (
                <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: CHANNEL_COLORS[c], flexShrink: 0 }} />
                  <span style={{ color: '#6b7280' }}>{c}:</span>
                  <span style={{ fontWeight: 600, color: '#111827' }}>{tooltip.counts[c]}</span>
                </div>
              ))}
            </div>
          </foreignObject>
        </g>
      )}
    </svg>
  );
}

export default function StatsChart({ interactions, selectedDate, filterPeriod }: Props) {
  const [activeChannels, setActiveChannels] = useState<Set<string>>(new Set(ALL_CHANNELS));
  const [expanded, setExpanded] = useState(false);

  const data = useMemo(() => buildDataPoints(interactions, selectedDate, filterPeriod), [interactions, selectedDate, filterPeriod]);

  const hasAnyData = data.some((p) => ALL_CHANNELS.some((c) => p.counts[c] > 0));

  const toggleChannel = (channel: string) => {
    setActiveChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channel)) {
        if (next.size > 1) next.delete(channel);
      } else {
        next.add(channel);
      }
      return next;
    });
  };

  const periodLabel = filterPeriod === 'day' ? 'par heure' : filterPeriod === 'week' ? 'par jour' : 'par jour du mois';

  return (
    <>
      <div className="bg-white rounded-xl shadow-md p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Evolution des canaux</h3>
            <p className="text-xs text-gray-500">{periodLabel}</p>
          </div>
          <button
            onClick={() => setExpanded(true)}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
            title="Agrandir"
          >
            <Maximize2 className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="flex flex-wrap gap-1 mb-3">
          {ALL_CHANNELS.map((channel) => (
            <button
              key={channel}
              onClick={() => toggleChannel(channel)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-all border ${
                activeChannels.has(channel)
                  ? 'text-white border-transparent'
                  : 'bg-white text-gray-400 border-gray-200'
              }`}
              style={activeChannels.has(channel) ? { background: CHANNEL_COLORS[channel], borderColor: CHANNEL_COLORS[channel] } : {}}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: activeChannels.has(channel) ? 'white' : CHANNEL_COLORS[channel] }} />
              {channel}
            </button>
          ))}
        </div>

        {!hasAnyData ? (
          <div className="flex items-center justify-center h-24 text-gray-400 text-xs">
            Aucune donnée pour cette période
          </div>
        ) : (
          <ChartContent data={data} activeChannels={activeChannels} width={280} height={140} padL={28} padR={12} padT={12} padB={24} />
        )}
      </div>

      {expanded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setExpanded(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-[90vw] max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-800">Evolution des canaux de communication</h2>
                <p className="text-sm text-gray-500 capitalize">{periodLabel}</p>
              </div>
              <button
                onClick={() => setExpanded(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            <div className="flex flex-wrap gap-2 mb-5">
              {ALL_CHANNELS.map((channel) => (
                <button
                  key={channel}
                  onClick={() => toggleChannel(channel)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${
                    activeChannels.has(channel)
                      ? 'text-white border-transparent'
                      : 'bg-white text-gray-400 border-gray-200'
                  }`}
                  style={activeChannels.has(channel) ? { background: CHANNEL_COLORS[channel], borderColor: CHANNEL_COLORS[channel] } : {}}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: activeChannels.has(channel) ? 'white' : CHANNEL_COLORS[channel] }} />
                  {channel}
                </button>
              ))}
            </div>

            {!hasAnyData ? (
              <div className="flex items-center justify-center h-64 text-gray-400">
                Aucune donnée pour cette période
              </div>
            ) : (
              <div className="w-full">
                <ChartContent data={data} activeChannels={activeChannels} width={800} height={340} padL={36} padR={20} padT={16} padB={32} />
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-3 md:grid-cols-6 gap-3">
              {ALL_CHANNELS.filter((c) => activeChannels.has(c)).map((channel) => {
                const total = data.reduce((sum, p) => sum + (p.counts[channel] || 0), 0);
                return (
                  <div key={channel} className="text-center">
                    <div className="w-3 h-3 rounded-full mx-auto mb-1" style={{ background: CHANNEL_COLORS[channel] }} />
                    <p className="text-xs text-gray-500">{channel}</p>
                    <p className="text-lg font-bold text-gray-800">{total}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
