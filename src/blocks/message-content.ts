import { CALENDAR_BUTTON_LABELS, eventInfoSource, removePersonalTicketTags, TICKET_BUTTON_LABELS, type EventInfoRow } from './event-blocks';
import { FILES_DEFAULT_LABELS, sanitizeShareId } from './files';
import { escapeAttribute, escapeHtml, isBlankHtml, parseTagOnlyValue, sanitizeUrl, stripHtml } from './html';
import { textKeyForBlock } from './keys';
import { sanitizeEmbedUrl } from './page-blocks';
import { sanitizeCalendarCode, type TextField } from './registry';
import { readLocalized, type TextMap } from './texts';
import type { BlockDocument, BlockNode, CalendarProps, Locale } from './types';

/** The links of one set of calendar buttons. */
export type CalendarLinks = { google?: string | null; outlook?: string | null; ics?: string | null };

/**
 * What a message or page shows that does not live in its own texts, filled in by the server for the
 * reader. Plain JSON, so it can be sent to the apps as is.
 */
export type BlockContentContext = {
  /** When & where rows that show the event's own date and place, as plain text. */
  eventInfo?: Partial<Record<EventInfoRow, string | null>>;
  /** Calendar buttons by calendar code (`event.add_to_calendar` or a `calendar.custom:…` code). */
  calendarLinks?: Record<string, CalendarLinks>;
  /** Where the Ticket block's button goes in the app. Null when the reader has no ticket. */
  ticketUrl?: string | null;
  /** Download page of each attached-files link, by share id. */
  fileShareUrls?: Record<string, string>;
  /** When the event starts (ISO), for Countdown blocks that count to it. */
  eventStartsAt?: string | null;
};

/** How to read a document's texts. Texts may be raw (editor) or already filled in for a reader (server). */
export type ContentReadOptions = {
  ownerKey: string;
  texts: TextMap;
  lang: Locale;
  fallbacks?: readonly Locale[];
};

export const EVENT_CALENDAR_CODE = 'event.add_to_calendar';

/** The calendar code a Calendar block shows, or null when its custom date is missing. */
export function calendarCodeFor(props: Pick<CalendarProps, 'source' | 'customCode'>): string | null {
  return props.source === 'custom' ? sanitizeCalendarCode(props.customCode) : EVENT_CALENDAR_CODE;
}

export function readContentText(block: BlockNode, field: TextField, options: ContentReadOptions): string {
  return readLocalized(options.texts[textKeyForBlock(options.ownerKey, block, field)], options.lang, options.fallbacks ?? []);
}

/** Blocks in reading order: containers are replaced by their children, column by column. */
export function readingOrder(document: BlockDocument): BlockNode[] {
  const result: BlockNode[] = [];
  const visit = (ids: readonly string[]) => {
    for (const id of ids) {
      const block = document.blocks[id];
      if (!block) continue;
      if (block.children) {
        if (block.type === 'cover') result.push(block);
        for (const region of block.children) visit(region);
      } else {
        result.push(block);
      }
    }
  };
  visit(document.root.childIds);
  return result;
}

/** A link that can be followed as is: a plain URL, not a tag left for the server to fill in. */
function followableUrl(value: string): string {
  const url = sanitizeUrl(value);
  return url && !parseTagOnlyValue(url) ? url : '';
}

function fallbackButton(label: string, href: string): string {
  const url = followableUrl(href);
  const text = escapeHtml(label);
  return url ? `<p><a class="event-button" href="${escapeAttribute(url)}">${text}</a></p>` : `<p>${text}</p>`;
}

/** Inline heading HTML without paragraph tags, or empty when there is nothing to show. */
function inlineHeading(html: string): string {
  return isBlankHtml(html) ? '' : html.replace(/<\/?p\b[^>]*>/gi, '');
}

function plainToHtml(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

/**
 * Simple HTML for readers that cannot show blocks (older app versions): headings, text, images and
 * links shown as event buttons, in reading order. Styling comes from the reader.
 */
export function documentFallbackHtml(document: BlockDocument, options: ContentReadOptions & { context?: BlockContentContext }): string {
  const { context, lang } = options;
  const parts: string[] = [];
  for (const block of readingOrder(document)) {
    switch (block.type) {
      case 'heading': {
        const html = inlineHeading(readContentText(block, 'html', options));
        if (html) parts.push(`<h${block.props.level}>${html}</h${block.props.level}>`);
        break;
      }
      case 'text':
      case 'classic':
      case 'callout': {
        const html = readContentText(block, 'html', options);
        if (!isBlankHtml(html)) parts.push(block.type === 'callout' ? `<blockquote>${html}</blockquote>` : html);
        break;
      }
      case 'image': {
        const src = readContentText(block, 'src', options).trim();
        if (!/^https:\/\//i.test(src)) break;
        const image = `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(readContentText(block, 'alt', options))}">`;
        const href = followableUrl(readContentText(block, 'href', options));
        parts.push(href ? `<p><a href="${escapeAttribute(href)}">${image}</a></p>` : `<p>${image}</p>`);
        break;
      }
      case 'cover': {
        const src = block.style.backgroundImage;
        if (src && /^https:\/\//i.test(src)) parts.push(`<p><img src="${escapeAttribute(src)}" alt=""></p>`);
        break;
      }
      case 'button': {
        const label = readContentText(block, 'label', options).trim();
        if (label) parts.push(fallbackButton(label, readContentText(block, 'href', options)));
        break;
      }
      case 'files': {
        const shareId = sanitizeShareId(block.props.shareId);
        const url = shareId ? context?.fileShareUrls?.[shareId] : undefined;
        if (url) parts.push(fallbackButton(readContentText(block, 'label', options).trim() || FILES_DEFAULT_LABELS[lang], url));
        break;
      }
      case 'divider':
        parts.push('<hr>');
        break;
      case 'event_info': {
        const rows = (['when', 'where'] as const)
          .map((row) => {
            const source = eventInfoSource(block.props, row);
            const value = source === 'event' ? (context?.eventInfo?.[row] ?? '') : source === 'custom' ? readContentText(block, row, options) : '';
            return value.trim() ? `${row === 'when' ? '&#128197;' : '&#128205;'} ${plainToHtml(value.trim())}` : '';
          })
          .filter(Boolean);
        if (rows.length > 0) parts.push(`<p>${rows.join('<br>')}</p>`);
        break;
      }
      case 'calendar': {
        const code = calendarCodeFor(block.props);
        const links = code ? context?.calendarLinks?.[code] : undefined;
        if (!links) break;
        const buttons = (['google', 'outlook', 'ics'] as const)
          .map((kind) => {
            const url = links[kind] ? followableUrl(links[kind] ?? '') : '';
            const label = CALENDAR_BUTTON_LABELS[kind === 'ics' ? 'download' : kind][lang];
            return url ? `<a class="event-button" href="${escapeAttribute(url)}">${escapeHtml(label)}</a>` : '';
          })
          .filter(Boolean);
        if (buttons.length > 0) parts.push(`<p>${buttons.join(' ')}</p>`);
        break;
      }
      case 'ticket':
        if (context?.ticketUrl) parts.push(fallbackButton(TICKET_BUTTON_LABELS[lang], context.ticketUrl));
        break;
      case 'banner': {
        const src = readContentText(block, 'src', options).trim();
        if (/^https:\/\//i.test(src)) parts.push(`<p><img src="${escapeAttribute(src)}" alt="${escapeAttribute(readContentText(block, 'alt', options))}"></p>`);
        break;
      }
      case 'countdown': {
        const html = inlineHeading(readContentText(block, 'html', options));
        if (html) parts.push(`<h2>${html}</h2>`);
        break;
      }
      case 'embed': {
        const url = sanitizeEmbedUrl(readContentText(block, 'src', options));
        if (url) parts.push(`<p><a href="${escapeAttribute(url)}">${escapeHtml(url)}</a></p>`);
        break;
      }
      default:
        break;
    }
  }
  return parts.join('');
}

export const PUSH_TEXT_MAX_LENGTH = 178;

const ENDS_SENTENCE = /[.!?:…)\]"'»]$|\p{Extended_Pictographic}$/u;

/** Shortens text at a word boundary and marks the cut with an ellipsis. */
export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const cut = value.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s,;:.\-–—]+$/, '')}…`;
}

/** Plain text of rich text, without QR codes from personal ticket tags. */
function readableText(html: string): string {
  return stripHtml(removePersonalTicketTags(html).replace(/<li\b[^>]*>/gi, ' · ').replace(/<(table|svg)\b[\s\S]*?<\/\1>/gi, ' '))
    .replace(/^·\s*/, '')
    .trim();
}

/**
 * The text of a notification or a message list preview: headings, text, callouts and classic content
 * in reading order. Buttons, downloads, calendar and ticket buttons and images are left out, so the
 * text reads as a message. Headings are closed with a full stop when they end without punctuation.
 * Use it on texts that are already filled in for the reader.
 */
export function documentPushText(document: BlockDocument, options: ContentReadOptions & { maxLength?: number }): string {
  const parts: string[] = [];
  for (const block of readingOrder(document)) {
    if (block.type !== 'heading' && block.type !== 'text' && block.type !== 'classic' && block.type !== 'callout') continue;
    const text = readableText(readContentText(block, 'html', options));
    if (!text) continue;
    parts.push(block.type === 'heading' && !ENDS_SENTENCE.test(text) ? `${text}.` : text);
  }
  return truncateText(parts.join(' ').replace(/\s+/g, ' ').trim(), options.maxLength ?? PUSH_TEXT_MAX_LENGTH);
}

/** The same cleanup for content written before blocks: one HTML body. */
export function htmlPushText(html: string, maxLength = PUSH_TEXT_MAX_LENGTH): string {
  return truncateText(readableText(html).replace(/\s+/g, ' ').trim(), maxLength);
}

const IMAGE_SRC_PATTERN = /<img\b[^>]*\ssrc\s*=\s*["'](https:\/\/[^"']+)["']/i;

/** The first picture of the document (an image block, or an image in rich text), for the notification. */
export function documentPushImage(document: BlockDocument, options: ContentReadOptions): string | null {
  for (const block of readingOrder(document)) {
    if (block.type === 'image') {
      const src = readContentText(block, 'src', options).trim();
      if (/^https:\/\//i.test(src)) return src;
    } else if (block.type === 'cover') {
      const src = block.style.backgroundImage;
      if (src && /^https:\/\//i.test(src)) return src;
    } else if (block.type === 'text' || block.type === 'classic' || block.type === 'callout') {
      const html = removePersonalTicketTags(readContentText(block, 'html', options));
      const match = html.match(IMAGE_SRC_PATTERN);
      if (match?.[1]) return match[1];
    }
  }
  return null;
}
