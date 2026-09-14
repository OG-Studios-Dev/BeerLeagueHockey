import type { LeagueEvent } from './leagueContent';

export const CONTACT_LIMITS = { name: 100, email: 320, subject: 200, message: 5000 } as const;
export type ContactDraft = { name: string; email: string; subject: string; message: string };
export type ContactErrors = Partial<Record<keyof ContactDraft, string>>;

export function normalizeTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value }).format(new Date(0));
    return value;
  } catch {
    return 'UTC';
  }
}

export function eventGroups(events: LeagueEvent[], generatedAt: string) {
  const now = Date.parse(generatedAt);
  return {
    happeningNow: events.filter((event) => Date.parse(event.startTime) <= now && event.endTime !== null && Date.parse(event.endTime) >= now),
    upcoming: events.filter((event) => Date.parse(event.startTime) > now),
    recent: events.filter((event) => Date.parse(event.startTime) <= now && (event.endTime === null || Date.parse(event.endTime) < now)),
  };
}

export function contactActionUrl(kind: 'email' | 'phone' | 'website', rawValue: string | null): string | null {
  if (!rawValue || rawValue !== rawValue.trim() || /[\r\n]/.test(rawValue)) return null;
  if (kind === 'email') {
    if (rawValue.length > CONTACT_LIMITS.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawValue)) return null;
    return `mailto:${encodeURIComponent(rawValue)}`;
  }
  if (kind === 'phone') {
    if (rawValue.length > 100 || !/^\+?[0-9().\-\s]+$/.test(rawValue)) return null;
    const number = `${rawValue.startsWith('+') ? '+' : ''}${rawValue.replace(/\D/g, '')}`;
    return number.replace('+', '').length >= 7 ? `tel:${number}` : null;
  }
  try {
    const parsed = new URL(rawValue);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function validateContactDraft(draft: ContactDraft): ContactErrors {
  const errors: ContactErrors = {};
  const values = { name: draft.name.trim(), email: draft.email.trim(), subject: draft.subject.trim(), message: draft.message.trim() };
  if (!values.name) errors.name = 'Enter your name.';
  else if (draft.name.length > CONTACT_LIMITS.name) errors.name = `Name must be ${CONTACT_LIMITS.name} characters or fewer.`;
  if (!values.email || draft.email !== values.email || /[\r\n]/.test(draft.email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.email = 'Enter a valid email address.';
  else if (draft.email.length > CONTACT_LIMITS.email) errors.email = `Email must be ${CONTACT_LIMITS.email} characters or fewer.`;
  if (!values.subject) errors.subject = 'Enter a subject.';
  else if (draft.subject.length > CONTACT_LIMITS.subject) errors.subject = `Subject must be ${CONTACT_LIMITS.subject} characters or fewer.`;
  if (!values.message) errors.message = 'Enter a message.';
  else if (draft.message.length > CONTACT_LIMITS.message) errors.message = `Message must be ${CONTACT_LIMITS.message} characters or fewer.`;
  return errors;
}
