import { z } from 'zod';
import { normalizeColor } from './colors';
import { sanitizeShareId } from './files';
import { sanitizeBackgroundImageUrl } from './html';
import { EDGE_SHAPES, imageEditStateSchema } from './image-edits';
import { BANNER_HEIGHT_AUTO, sanitizeBannerHeight, sanitizeIsoDate, sanitizeProgramId } from './page-blocks';
import {
  CALLOUT_VARIANTS,
  COLUMN_LAYOUTS,
  EMBED_ASPECT_RATIOS,
  EVENT_INFO_SOURCES,
  RSVP_DECLINE_STYLES,
  type BlockDocument,
  type BlockNode,
  type BlockPropsByType,
  type BlockStyle,
  type BlockType,
  type ColumnsLayout,
  type HeadingLevel,
  type ImageBlock,
  type Padding,
  type Surface,
  TEXT_SIZES,
} from './types';

const colorSchema = z
  .string()
  .nullable()
  .catch(null)
  .transform((value) => normalizeColor(value));

const alignSchema = z.enum(['left', 'center', 'right']).catch('left');

const intIn = (min: number, max: number, fallback: number) =>
  z
    .number()
    .catch(fallback)
    .transform((value) => Math.round(Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback))));

export const PADDING_MAX = 200;

const paddingSchema = (fallback: Padding) =>
  z
    .object({
      top: intIn(0, PADDING_MAX, fallback.top),
      right: intIn(0, PADDING_MAX, fallback.right),
      bottom: intIn(0, PADDING_MAX, fallback.bottom),
      left: intIn(0, PADDING_MAX, fallback.left),
    })
    .catch(fallback);

const styleSchema = (fallback: BlockStyle) =>
  z
    .object({
      padding: paddingSchema(fallback.padding),
      backgroundColor: colorSchema.default(null),
      backgroundImage: z
        .string()
        .nullable()
        .catch(null)
        .transform((value) => sanitizeBackgroundImageUrl(value))
        .default(null),
      fullWidth: z.boolean().catch(false).default(false),
    })
    .catch(fallback);

/** Horizontal inset that lines block content up with the legacy email body (570px card, 35px sides). */
export const EMAIL_CONTENT_INSET = 35;

/** Default side spacing of a document (`RootStyle.paddingX`). */
export const defaultSideInset = (surface: Surface) => (surface === 'email' ? EMAIL_CONTENT_INSET : 0);

const padded = (vertical: number): BlockStyle => ({
  padding: { top: vertical, right: 0, bottom: vertical, left: 0 },
  backgroundColor: null,
  backgroundImage: null,
  fullWidth: false,
});

/**
 * Which card edges a top-level block sits against: the first block when there is no space above
 * it, the last when there is no space or footer below it. Its background meets the card corners there.
 */
export function blockCardEdges(block: BlockNode, document: Pick<BlockDocument, 'root'>, nested: boolean): { top: boolean; bottom: boolean } {
  if (nested) return { top: false, bottom: false };
  const { childIds, style } = document.root;
  return {
    top: style.paddingTop === 0 && childIds[0] === block.id,
    bottom: style.paddingBottom === 0 && !style.showFooter && childIds[childIds.length - 1] === block.id,
  };
}

/**
 * Corner radii (top, bottom) an image block's picture takes so it follows a rounded card: a
 * full-width picture against a card edge gets the card radius there, or its own if that is larger.
 */
export function imageCornerRadii(block: ImageBlock, document: Pick<BlockDocument, 'root'>, nested: boolean, cardRadius: number): { top: number; bottom: number } {
  const own = block.props.radius;
  if (cardRadius <= 0) return { top: own, bottom: own };
  const padding = resolveBlockPadding(block, document, nested);
  const spansCard = block.props.width === 100 && padding.left === 0 && padding.right === 0;
  const edges = blockCardEdges(block, document, nested);
  return {
    top: spansCard && edges.top && padding.top === 0 ? Math.max(own, cardRadius) : own,
    bottom: spansCard && edges.bottom && padding.bottom === 0 ? Math.max(own, cardRadius) : own,
  };
}

/**
 * The padding a block renders with: its own top/bottom, the document's side spacing for top-level
 * blocks, none on the sides for full-width blocks and blocks inside columns. An image that opens the
 * document has no space of its own above it, so the document's top spacing alone decides the gap.
 */
export function resolveBlockPadding(block: BlockNode, document: Pick<BlockDocument, 'root'>, nested: boolean): Padding {
  // An image with text always spans the card (its image is the background); the side spacing insets its content.
  const side = nested || (block.style.fullWidth && block.type !== 'cover') ? 0 : document.root.style.paddingX;
  const opensWithImage = !nested && block.type === 'image' && document.root.childIds[0] === block.id;
  return { top: opensWithImage ? 0 : block.style.padding.top, right: side, bottom: block.style.padding.bottom, left: side };
}

/** A translatable value of a block, stored in `event_text`. */
export type TextField = 'html' | 'label' | 'href' | 'src' | 'alt' | 'declineLabel' | 'when' | 'where' | 'videoSrc' | 'endedText';

export type TextFieldKind = 'rich' | 'inline' | 'plain' | 'url';

export type BlockDefinition<T extends BlockType = BlockType> = {
  type: T;
  label: string;
  description: string;
  surfaces: readonly Surface[];
  /** Offered in the "+" menu. Classic blocks only come from legacy content. */
  insertable: boolean;
  /** Container blocks hold child blocks in regions (columns). */
  container: boolean;
  textFields: readonly { field: TextField; kind: TextFieldKind; label: string }[];
  propsSchema: z.ZodType<BlockPropsByType[T]>;
  defaultProps: () => BlockPropsByType[T];
  defaultStyle: (surface: Surface) => BlockStyle;
};

/** Pixel sizes for heading levels 1–5. The body sizes (normal / small) live on the email theme. */
export const HEADING_SIZES: Record<HeadingLevel, number> = { 1: 32, 2: 24, 3: 20, 4: 16, 5: 14 };

export function headingFontSize(level: HeadingLevel): number {
  return HEADING_SIZES[level] ?? HEADING_SIZES[2];
}

/** Button corner rounding in px when neither the block nor the theme sets one. */
export const DEFAULT_BUTTON_RADIUS = 6;

/** Corner rounding of the email ticket card when the block sets none. */
export const TICKET_CARD_RADIUS = 12;

/** Upper bound for a theme's button rounding (pill-shaped buttons use a large value). */
const BUTTON_RADIUS_MAX = 999;

/** A block's button rounding: its own, else the theme's, else the default. */
export function resolveButtonRadius(own: number | null, themeRadius: number | null | undefined): number {
  return own ?? themeRadius ?? DEFAULT_BUTTON_RADIUS;
}

/** A rounding stored as CSS pixels (`"8px"`, as event styles store it) in px, or null when unset or not in px. */
export function parseRoundingPx(value: string | null | undefined): number | null {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)px$/);
  if (!match?.[1]) return null;
  return Math.min(BUTTON_RADIUS_MAX, Math.round(Number(match[1])));
}

/** Theme sliders for Text blocks: normal and small. */
export const EMAIL_BODY_TEXT_SIZE = { min: 10, max: 22, normal: 14, small: 12 } as const;

export function clampEmailBodyTextSize(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(EMAIL_BODY_TEXT_SIZE.max, Math.max(EMAIL_BODY_TEXT_SIZE.min, Math.round(value)));
}

const headingLevelSchema = z
  .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
  .catch(2);
const textSizeSchema = z.enum(TEXT_SIZES).catch('normal');

const headingProps = (): BlockPropsByType['heading'] => ({ level: 2, align: 'left', color: null });
const textProps = (): BlockPropsByType['text'] => ({ align: 'left', color: null, size: 'normal' });
const buttonProps = (): BlockPropsByType['button'] => ({
  align: 'left',
  fullWidth: false,
  backgroundColor: null,
  textColor: null,
  radius: null,
});
const imageProps = (): BlockPropsByType['image'] => ({ width: 100, align: 'center', radius: 0, imageEdits: null });
const dividerProps = (): BlockPropsByType['divider'] => ({ color: null, thickness: 1, lineStyle: 'solid' });
const spacerProps = (): BlockPropsByType['spacer'] => ({ height: 24 });
const columnsProps = (): BlockPropsByType['columns'] => ({
  layout: '50-50',
  gap: 16,
  stackOnMobile: true,
  verticalAlign: 'top',
});
const coverProps = (): BlockPropsByType['cover'] => ({
  textColor: null,
  height: null,
  verticalAlign: 'middle',
  imageWidth: null,
  imageHeight: null,
  imageEdits: null,
});

export const COVER_HEIGHT_MIN = 60;
export const COVER_HEIGHT_MAX = 900;

const nullableIntIn = (min: number, max: number) =>
  z
    .number()
    .nullable()
    .catch(null)
    .transform((value) => (value === null || !Number.isFinite(value) ? null : Math.round(Math.min(max, Math.max(min, value)))));
const classicProps = (): BlockPropsByType['classic'] => ({ edgeToEdgeFirstImage: false });
const rsvpProps = (): BlockPropsByType['rsvp'] => ({
  showDecline: true,
  direct: true,
  personal: true,
  align: 'center',
  fullWidth: false,
  radius: null,
  backgroundColor: null,
  textColor: null,
  declineStyle: 'outline',
  declineBackgroundColor: null,
  declineTextColor: null,
});
const calendarProps = (): BlockPropsByType['calendar'] => ({
  source: 'event',
  customCode: null,
  align: 'center',
  radius: null,
  backgroundColor: null,
  textColor: null,
});

export const TICKET_QR_SIZE = { min: 120, max: 260, default: 180 } as const;

const ticketProps = (): BlockPropsByType['ticket'] => ({
  showDetails: true,
  qrSize: TICKET_QR_SIZE.default,
  align: 'center',
  cardColor: null,
  borderColor: null,
  radius: null,
});
const eventInfoProps = (): BlockPropsByType['event_info'] => ({
  whenSource: 'event',
  whereSource: 'event',
  align: 'left',
  color: null,
  showIcons: true,
  boxColor: null,
  borderColor: null,
  radius: 8,
});
const calloutProps = (): BlockPropsByType['callout'] => ({
  variant: 'filled',
  align: 'left',
  color: null,
  accentColor: null,
  boxColor: null,
  radius: 8,
  size: 'normal',
});
const filesProps = (): BlockPropsByType['files'] => ({
  shareId: null,
  align: 'center',
  fullWidth: false,
  radius: null,
  backgroundColor: null,
  textColor: null,
});

const bannerProps = (): BlockPropsByType['banner'] => ({
  height: BANNER_HEIGHT_AUTO,
  mobileHeight: null,
  curve: null,
  curveHeight: 60,
  curveFlip: false,
});
const countdownProps = (): BlockPropsByType['countdown'] => ({
  source: 'event',
  customDate: null,
  align: 'center',
  color: null,
  boxColor: null,
  borderColor: null,
  radius: null,
  showSeconds: true,
});
const embedProps = (): BlockPropsByType['embed'] => ({ aspectRatio: '16:9', radius: 0 });
const programProps = (): BlockPropsByType['program'] => ({ programId: null });

export const BANNER_CURVE_HEIGHT = { min: 10, max: 200, default: 60 } as const;

const CUSTOM_CALENDAR_CODE_PATTERN = /^calendar\.custom:[A-Za-z0-9_-]{1,4000}$/;

/** A `calendar.custom:…` tag code, or null when the value is not one. */
export function sanitizeCalendarCode(value: unknown): string | null {
  return typeof value === 'string' && CUSTOM_CALENDAR_CODE_PATTERN.test(value) ? value : null;
}

const withDefaults = <T extends object>(defaults: () => T, shape: z.ZodRawShape) =>
  z
    .object(shape)
    .partial()
    .catch({})
    .transform((value) => ({ ...defaults(), ...Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) }) as T);

export const BLOCK_DEFINITIONS: { [T in BlockType]: BlockDefinition<T> } = {
  heading: {
    type: 'heading',
    label: 'Heading',
    description: 'A title or section heading',
    surfaces: ['email', 'in_app', 'page'],
    insertable: true,
    container: false,
    textFields: [{ field: 'html', kind: 'inline', label: 'Heading' }],
    propsSchema: withDefaults(headingProps, {
      level: headingLevelSchema,
      align: alignSchema,
      color: colorSchema,
    }),
    defaultProps: headingProps,
    defaultStyle: () => padded(8),
  },
  text: {
    type: 'text',
    label: 'Text',
    description: 'Paragraphs, lists, links and tags',
    surfaces: ['email', 'in_app', 'page'],
    insertable: true,
    container: false,
    textFields: [{ field: 'html', kind: 'rich', label: 'Text' }],
    propsSchema: withDefaults(textProps, { align: alignSchema, color: colorSchema, size: textSizeSchema }),
    defaultProps: textProps,
    defaultStyle: () => padded(8),
  },
  button: {
    type: 'button',
    label: 'Button',
    description: 'A call to action with a link',
    surfaces: ['email', 'in_app', 'page'],
    insertable: true,
    container: false,
    textFields: [
      { field: 'label', kind: 'plain', label: 'Button text' },
      { field: 'href', kind: 'url', label: 'Link' },
    ],
    propsSchema: withDefaults(buttonProps, {
      align: alignSchema,
      fullWidth: z.boolean().catch(false),
      backgroundColor: colorSchema,
      textColor: colorSchema,
      radius: nullableIntIn(0, 40),
    }),
    defaultProps: buttonProps,
    defaultStyle: () => padded(12),
  },
  image: {
    type: 'image',
    label: 'Image',
    description: 'A picture, optionally linked',
    surfaces: ['email', 'in_app', 'page'],
    insertable: true,
    container: false,
    textFields: [
      { field: 'src', kind: 'url', label: 'Image' },
      { field: 'alt', kind: 'plain', label: 'Alt text' },
      { field: 'href', kind: 'url', label: 'Link' },
    ],
    propsSchema: withDefaults(imageProps, {
      width: intIn(10, 100, 100),
      align: z.enum(['left', 'center', 'right']).catch('center'),
      radius: intIn(0, 40, 0),
      imageEdits: imageEditStateSchema,
    }),
    defaultProps: imageProps,
    defaultStyle: () => padded(8),
  },
  divider: {
    type: 'divider',
    label: 'Divider',
    description: 'A horizontal line',
    surfaces: ['email', 'in_app', 'page'],
    insertable: true,
    container: false,
    textFields: [],
    propsSchema: withDefaults(dividerProps, {
      color: colorSchema,
      thickness: intIn(1, 8, 1),
      lineStyle: z.enum(['solid', 'dashed', 'dotted']).catch('solid'),
    }),
    defaultProps: dividerProps,
    defaultStyle: () => padded(16),
  },
  spacer: {
    type: 'spacer',
    label: 'Spacer',
    description: 'Empty vertical space',
    surfaces: ['email', 'in_app', 'page'],
    insertable: true,
    container: false,
    textFields: [],
    propsSchema: withDefaults(spacerProps, { height: intIn(4, 200, 24) }),
    defaultProps: spacerProps,
    defaultStyle: () => padded(0),
  },
  columns: {
    type: 'columns',
    label: 'Columns',
    description: 'Place blocks side by side',
    surfaces: ['email', 'in_app', 'page'],
    insertable: true,
    container: true,
    textFields: [],
    propsSchema: withDefaults(columnsProps, {
      layout: z.enum(COLUMN_LAYOUTS).catch('50-50'),
      gap: intIn(0, 60, 16),
      stackOnMobile: z.boolean().catch(true),
      verticalAlign: z.enum(['top', 'middle', 'bottom']).catch('top'),
    }),
    defaultProps: columnsProps,
    defaultStyle: () => padded(8),
  },
  cover: {
    type: 'cover',
    label: 'Content image',
    description: 'Any blocks on top of an image',
    surfaces: ['email', 'in_app', 'page'],
    insertable: true,
    container: true,
    textFields: [],
    propsSchema: withDefaults(coverProps, {
      textColor: colorSchema,
      height: nullableIntIn(COVER_HEIGHT_MIN, COVER_HEIGHT_MAX),
      verticalAlign: z.enum(['top', 'middle', 'bottom']).catch('middle'),
      imageWidth: nullableIntIn(1, 20000),
      imageHeight: nullableIntIn(1, 20000),
      imageEdits: imageEditStateSchema,
    }),
    defaultProps: coverProps,
    defaultStyle: () => padded(40),
  },
  classic: {
    type: 'classic',
    label: 'Classic content',
    description: 'Content written before blocks existed',
    surfaces: ['email', 'in_app'],
    insertable: false,
    container: false,
    textFields: [{ field: 'html', kind: 'rich', label: 'Content' }],
    propsSchema: withDefaults(classicProps, { edgeToEdgeFirstImage: z.boolean().catch(false) }),
    defaultProps: classicProps,
    defaultStyle: (surface) => ({
      padding: { top: defaultSideInset(surface), right: 0, bottom: 0, left: 0 },
      backgroundColor: null,
      backgroundImage: null,
      fullWidth: false,
    }),
  },
  rsvp: {
    type: 'rsvp',
    label: 'RSVP buttons',
    description: 'Register and decline buttons',
    // On pages the buttons open the registration flow; `direct` and `personal` only apply to emails.
    surfaces: ['email', 'page'],
    insertable: true,
    container: false,
    textFields: [
      { field: 'label', kind: 'plain', label: 'Register button text' },
      { field: 'declineLabel', kind: 'plain', label: 'Decline button text' },
    ],
    propsSchema: withDefaults(rsvpProps, {
      showDecline: z.boolean().catch(true),
      direct: z.boolean().catch(true),
      personal: z.boolean().catch(true),
      align: alignSchema,
      fullWidth: z.boolean().catch(false),
      radius: nullableIntIn(0, 40),
      backgroundColor: colorSchema,
      textColor: colorSchema,
      declineStyle: z.enum(RSVP_DECLINE_STYLES).catch('outline'),
      declineBackgroundColor: colorSchema,
      declineTextColor: colorSchema,
    }),
    defaultProps: rsvpProps,
    defaultStyle: () => padded(12),
  },
  calendar: {
    type: 'calendar',
    label: 'Calendar',
    description: 'Add-to-calendar buttons',
    surfaces: ['email', 'in_app', 'page'],
    insertable: true,
    container: false,
    textFields: [],
    propsSchema: withDefaults(calendarProps, {
      source: z.enum(['event', 'custom']).catch('event'),
      customCode: z
        .string()
        .nullable()
        .catch(null)
        .transform((value) => sanitizeCalendarCode(value)),
      align: z.enum(['left', 'center', 'right']).catch('center'),
      radius: nullableIntIn(0, 40),
      backgroundColor: colorSchema,
      textColor: colorSchema,
    }),
    defaultProps: calendarProps,
    defaultStyle: () => padded(12),
  },
  ticket: {
    type: 'ticket',
    label: 'Ticket',
    // In the app the ticket is a button to the app's ticket page; its QR and card options are email-only.
    description: "The guest's QR ticket",
    // On pages it shows only to logged-in guests (in the app), who have a ticket.
    surfaces: ['email', 'in_app', 'page'],
    insertable: true,
    container: false,
    textFields: [],
    propsSchema: withDefaults(ticketProps, {
      showDetails: z.boolean().catch(true),
      qrSize: intIn(TICKET_QR_SIZE.min, TICKET_QR_SIZE.max, TICKET_QR_SIZE.default),
      align: z.enum(['left', 'center', 'right']).catch('center'),
      cardColor: colorSchema,
      borderColor: colorSchema,
      radius: nullableIntIn(0, 40),
    }),
    defaultProps: ticketProps,
    defaultStyle: () => padded(12),
  },
  event_info: {
    type: 'event_info',
    label: 'When & where',
    description: 'Date, time and place',
    surfaces: ['email', 'in_app', 'page'],
    insertable: true,
    container: false,
    textFields: [
      { field: 'when', kind: 'plain', label: 'When' },
      { field: 'where', kind: 'plain', label: 'Where' },
    ],
    propsSchema: withDefaults(eventInfoProps, {
      whenSource: z.enum(EVENT_INFO_SOURCES).catch('event'),
      whereSource: z.enum(EVENT_INFO_SOURCES).catch('event'),
      align: alignSchema,
      color: colorSchema,
      showIcons: z.boolean().catch(true),
      boxColor: colorSchema,
      borderColor: colorSchema,
      radius: intIn(0, 40, 8),
    }),
    defaultProps: eventInfoProps,
    defaultStyle: () => padded(8),
  },
  callout: {
    type: 'callout',
    label: 'Callout',
    description: 'Important info in a highlighted box',
    surfaces: ['email', 'in_app', 'page'],
    insertable: true,
    container: false,
    textFields: [{ field: 'html', kind: 'rich', label: 'Text' }],
    propsSchema: withDefaults(calloutProps, {
      variant: z.enum(CALLOUT_VARIANTS).catch('filled'),
      align: alignSchema,
      color: colorSchema,
      accentColor: colorSchema,
      boxColor: colorSchema,
      radius: intIn(0, 40, 8),
      size: textSizeSchema,
    }),
    defaultProps: calloutProps,
    defaultStyle: () => padded(8),
  },
  files: {
    type: 'files',
    label: 'Files',
    description: 'A button to download attached files',
    surfaces: ['email', 'in_app', 'page'],
    insertable: true,
    container: false,
    textFields: [{ field: 'label', kind: 'plain', label: 'Button text' }],
    propsSchema: withDefaults(filesProps, {
      shareId: z
        .unknown()
        .transform((value) => sanitizeShareId(value))
        .catch(null),
      align: z.enum(['left', 'center', 'right']).catch('center'),
      fullWidth: z.boolean().catch(false),
      radius: nullableIntIn(0, 40),
      backgroundColor: colorSchema,
      textColor: colorSchema,
    }),
    defaultProps: filesProps,
    defaultStyle: () => padded(12),
  },
  banner: {
    type: 'banner',
    label: 'Banner',
    description: 'A picture or video across the top',
    surfaces: ['page'],
    insertable: true,
    container: false,
    textFields: [
      { field: 'src', kind: 'url', label: 'Image' },
      { field: 'videoSrc', kind: 'url', label: 'Video' },
      { field: 'alt', kind: 'plain', label: 'Alt text' },
    ],
    propsSchema: withDefaults(bannerProps, {
      height: z
        .unknown()
        .transform((value) => sanitizeBannerHeight(value) ?? BANNER_HEIGHT_AUTO)
        .catch(BANNER_HEIGHT_AUTO),
      mobileHeight: z
        .unknown()
        .transform((value) => sanitizeBannerHeight(value))
        .catch(null),
      curve: z.enum(EDGE_SHAPES).nullable().catch(null),
      curveHeight: intIn(BANNER_CURVE_HEIGHT.min, BANNER_CURVE_HEIGHT.max, BANNER_CURVE_HEIGHT.default),
      curveFlip: z.boolean().catch(false),
    }),
    defaultProps: bannerProps,
    defaultStyle: () => ({ ...padded(0), fullWidth: true }),
  },
  countdown: {
    type: 'countdown',
    label: 'Countdown',
    description: 'Time left until the event starts',
    surfaces: ['page'],
    insertable: true,
    container: false,
    textFields: [
      { field: 'html', kind: 'inline', label: 'Heading' },
      { field: 'endedText', kind: 'plain', label: 'Text when the time is up' },
    ],
    propsSchema: withDefaults(countdownProps, {
      source: z.enum(['event', 'custom']).catch('event'),
      customDate: z
        .unknown()
        .transform((value) => sanitizeIsoDate(value))
        .catch(null),
      align: z.enum(['left', 'center', 'right']).catch('center'),
      color: colorSchema,
      boxColor: colorSchema,
      borderColor: colorSchema,
      radius: nullableIntIn(0, 40),
      showSeconds: z.boolean().catch(true),
    }),
    defaultProps: countdownProps,
    defaultStyle: () => padded(16),
  },
  embed: {
    type: 'embed',
    label: 'Embed',
    description: 'A video, map or other content from another site',
    surfaces: ['page'],
    insertable: true,
    container: false,
    textFields: [{ field: 'src', kind: 'url', label: 'Address' }],
    propsSchema: withDefaults(embedProps, {
      aspectRatio: z.enum(EMBED_ASPECT_RATIOS).catch('16:9'),
      radius: intIn(0, 40, 0),
    }),
    defaultProps: embedProps,
    defaultStyle: () => padded(8),
  },
  program: {
    type: 'program',
    label: 'Program',
    description: "One of the event's programs",
    surfaces: ['page'],
    insertable: true,
    container: false,
    textFields: [],
    propsSchema: withDefaults(programProps, {
      programId: z
        .unknown()
        .transform((value) => sanitizeProgramId(value))
        .catch(null),
    }),
    defaultProps: programProps,
    defaultStyle: () => padded(8),
  },
};

export function getBlockDefinition<T extends BlockType>(type: T): BlockDefinition<T> {
  return BLOCK_DEFINITIONS[type];
}

export function isBlockType(value: unknown): value is BlockType {
  return typeof value === 'string' && Object.hasOwn(BLOCK_DEFINITIONS, value);
}

/** Blocks the "+" menu offers on a surface. Containers cannot be nested in containers. */
export function insertableBlockTypes(surface: Surface, insideContainer: boolean): BlockType[] {
  return (Object.keys(BLOCK_DEFINITIONS) as BlockType[]).filter((type) => {
    const definition = BLOCK_DEFINITIONS[type];
    if (!definition.insertable || !definition.surfaces.includes(surface)) return false;
    return !(insideContainer && definition.container);
  });
}

export function parseBlockStyle(type: BlockType, surface: Surface, raw: unknown): BlockStyle {
  return styleSchema(BLOCK_DEFINITIONS[type].defaultStyle(surface)).parse(raw);
}

export function parseBlockProps<T extends BlockType>(type: T, raw: unknown): BlockPropsByType[T] {
  return BLOCK_DEFINITIONS[type].propsSchema.parse(raw);
}

/** Column widths in percent for a layout. */
export function columnWidths(layout: ColumnsLayout): number[] {
  switch (layout) {
    case '33-67':
      return [33.33, 66.67];
    case '67-33':
      return [66.67, 33.33];
    case '33-33-33':
      return [33.33, 33.33, 33.34];
    case '25-25-25-25':
      return [25, 25, 25, 25];
    case '50-50':
    default:
      return [50, 50];
  }
}

/** How many child lists (regions) a container block has: one per column, one for an image with text. */
export function regionCount(block: BlockNode): number {
  if (block.type === 'columns') return columnCount(block.props.layout);
  return BLOCK_DEFINITIONS[block.type].container ? 1 : 0;
}

export function columnCount(layout: ColumnsLayout): number {
  return columnWidths(layout).length;
}
