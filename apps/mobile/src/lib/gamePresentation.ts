export type GamePresentationStatus = {
  label: 'Scheduled' | 'Live' | 'Final' | 'Awaiting Review' | 'Postponed' | 'Cancelled' | 'Status unavailable';
  showScore: boolean;
  canUseCalendar: boolean;
  canQuickCheckIn: boolean;
};

export type GamePresentationInput = {
  scheduled_at: string;
  location: string | null;
  status: string | null | undefined;
  away_score: number | null | undefined;
  home_score: number | null | undefined;
};

export type GamePresentationFacts = {
  dateLabel: string | null;
  timeLabel: string | null;
  locationLabel: string | null;
  statusLabel: GamePresentationStatus['label'];
  showScore: boolean;
  awayScoreLabel: string | null;
  homeScoreLabel: string | null;
  canUseCalendar: boolean;
  canQuickCheckIn: boolean;
};

export function normalizeGameStatus(status: string | null | undefined): GamePresentationStatus {
  switch (status) {
    case 'scheduled':
      return { label: 'Scheduled', showScore: false, canUseCalendar: true, canQuickCheckIn: true };
    case 'in_progress':
      return { label: 'Live', showScore: true, canUseCalendar: false, canQuickCheckIn: false };
    case 'completed':
      return { label: 'Final', showScore: true, canUseCalendar: false, canQuickCheckIn: false };
    case 'pending_verification':
      return { label: 'Awaiting Review', showScore: false, canUseCalendar: false, canQuickCheckIn: false };
    case 'postponed':
      return { label: 'Postponed', showScore: false, canUseCalendar: false, canQuickCheckIn: false };
    case 'cancelled':
      return { label: 'Cancelled', showScore: false, canUseCalendar: false, canQuickCheckIn: false };
    default:
      return { label: 'Status unavailable', showScore: false, canUseCalendar: false, canQuickCheckIn: false };
  }
}

function formatPresentationPart(value: Date, timezone: string, kind: 'date' | 'time') {
  try {
    const options: Intl.DateTimeFormatOptions = kind === 'date'
      ? { timeZone: timezone, month: 'short', day: 'numeric' }
      : { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true };
    const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(value);
    const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
    if (kind === 'date') {
      const month = read('month');
      const day = read('day');
      return month && day ? `${month} ${day}` : null;
    }
    const hour = read('hour');
    const minute = read('minute');
    const dayPeriod = read('dayPeriod');
    return hour && minute && dayPeriod ? `${hour}:${minute} ${dayPeriod}` : null;
  } catch {
    return null;
  }
}

export function buildGamePresentation(game: GamePresentationInput, timezone: string | null): GamePresentationFacts {
  const instant = new Date(game.scheduled_at);
  const validInstant = Number.isFinite(instant.getTime());
  const validTimezone = timezone?.trim() || null;
  const status = normalizeGameStatus(game.status);
  return {
    dateLabel: validInstant && validTimezone ? formatPresentationPart(instant, validTimezone, 'date') : null,
    timeLabel: validInstant && validTimezone ? formatPresentationPart(instant, validTimezone, 'time') : null,
    locationLabel: game.location?.trim() || null,
    statusLabel: status.label,
    showScore: status.showScore,
    awayScoreLabel: status.showScore && game.away_score != null ? String(game.away_score) : null,
    homeScoreLabel: status.showScore && game.home_score != null ? String(game.home_score) : null,
    canUseCalendar: status.canUseCalendar,
    canQuickCheckIn: status.canQuickCheckIn,
  };
}

function safeAccentColor(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(trimmed)) return null;
  if (trimmed.length === 4) return `#${trimmed.slice(1).split('').map((part) => `${part}${part}`).join('')}`.toUpperCase();
  return trimmed.toUpperCase();
}

export function resolveGameAccentColors(
  away: string | null | undefined,
  home: string | null | undefined,
  leagueFallback: string | null | undefined,
) {
  const fallback = safeAccentColor(leagueFallback) ?? '#7C8798';
  return { away: safeAccentColor(away) ?? fallback, home: safeAccentColor(home) ?? fallback };
}
