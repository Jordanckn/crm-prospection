export const DEFAULT_TIMEZONE = 'Europe/Paris';

export const TIMEZONE_OPTIONS = [
  { value: 'Europe/Paris', label: 'France · Paris (UTC+1/+2)' },
  { value: 'Asia/Jerusalem', label: 'Israël · Jérusalem (UTC+2/+3)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'Royaume-Uni · Londres' },
  { value: 'America/New_York', label: 'États-Unis · New York' },
  { value: 'America/Los_Angeles', label: 'États-Unis · Los Angeles' },
] as const;

export function safeTimezone(timezone?: string | null): string {
  if (!timezone) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: timezone }).format();
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function formatInTimezone(
  value: string | Date,
  timezone?: string | null,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: safeTimezone(timezone) }).format(new Date(value));
}

export function dateKeyInTimezone(value: string | Date, timezone?: string | null): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimezone(timezone), year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function mondayKeyInTimezone(timezone?: string | null): string {
  const today = dateKeyInTimezone(new Date(), timezone);
  const [year, month, day] = today.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1);
  return date.toISOString().slice(0, 10);
}

export function toZonedDateTimeInput(value: string | Date, timezone?: string | null): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimezone(timezone),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

/** Convertit une heure saisie sans fuseau (datetime-local) vers son instant UTC. */
export function zonedDateTimeInputToIso(localValue: string, timezone?: string | null): string {
  const match = localValue.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new Error('Date et heure invalides');
  const desired = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] || 0));
  const zone = safeTimezone(timezone);
  let instant = desired;

  // Deux passes couvrent aussi les changements d'heure été/hiver.
  for (let pass = 0; pass < 3; pass++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(instant));
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(item => item.type === type)?.value || 0);
    const represented = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
    const correction = desired - represented;
    instant += correction;
    if (correction === 0) break;
  }
  return new Date(instant).toISOString();
}
