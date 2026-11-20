import type { CountdownProps, EmbedAspectRatio, Locale } from './types';

const BANNER_HEIGHT_PATTERN = /^(?:auto|\d{1,4}px|\d{1,3}vh)$/;

export const BANNER_HEIGHT_AUTO = 'auto';

/** A banner height (`auto`, `Npx` or `Nvh`), or null when the value is not one. */
export function sanitizeBannerHeight(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return BANNER_HEIGHT_PATTERN.test(trimmed) ? trimmed : null;
}

/** An address that can be shown in an embed frame: https only. */
export function sanitizeEmbedUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (!/^https:\/\/[^\s"'<>]+$/i.test(trimmed)) return null;
  try {
    return new URL(trimmed).href;
  } catch {
    return null;
  }
}

/** The address of embed code an editor pastes: a plain URL, or the `src` of an `<iframe>`. */
export function embedUrlFromInput(input: string): string | null {
  const src = input.match(/<iframe\b[^>]*\ssrc\s*=\s*["']([^"']+)["']/i)?.[1];
  return sanitizeEmbedUrl((src ?? input).replace(/&amp;/g, '&'));
}

/** CSS `aspect-ratio` of an embed frame. */
export function embedAspectRatio(ratio: EmbedAspectRatio): string {
  return ratio.replace(':', ' / ');
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sanitizeProgramId(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

/** An ISO date-time, normalized, or null. */
export function sanitizeIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export type CountdownUnit = 'days' | 'hours' | 'minutes' | 'seconds';

export const COUNTDOWN_LABELS: Record<CountdownUnit, Record<Locale, string>> = {
  days: { en: 'Days', da: 'Dage', de: 'Tage', swe: 'Dagar' },
  hours: { en: 'Hours', da: 'Timer', de: 'Stunden', swe: 'Timmar' },
  minutes: { en: 'Minutes', da: 'Minutter', de: 'Minuten', swe: 'Minuter' },
  seconds: { en: 'Seconds', da: 'Sekunder', de: 'Sekunden', swe: 'Sekunder' },
};

/** The moment a Countdown block counts to, in ms, or null when it is unknown. */
export function countdownTarget(props: Pick<CountdownProps, 'source' | 'customDate'>, eventStartsAt: string | null | undefined): number | null {
  const value = props.source === 'custom' ? props.customDate : eventStartsAt;
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export type TimeLeft = Record<CountdownUnit, number>;

/** Whole units left until `target`; all zero once it has passed. */
export function timeLeftUntil(target: number, now: number): TimeLeft {
  const total = Math.max(0, Math.floor((target - now) / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}
