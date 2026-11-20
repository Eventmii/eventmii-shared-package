import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { inlineHtml } from '../email-mjml';
import { CALENDAR_BUTTON_LABELS, eventInfoSource, TICKET_BUTTON_LABELS } from '../event-blocks';
import { FILES_DEFAULT_LABELS, sanitizeShareId } from '../files';
import { isBlankHtml, parseTagOnlyValue, sanitizeBackgroundImageUrl, sanitizeUrl } from '../html';
import { calendarCodeFor, readContentText, type BlockContentContext, type ContentReadOptions } from '../message-content';
import {
  BLOCK_DEFINITIONS,
  clampEmailBodyTextSize,
  columnWidths,
  EMAIL_BODY_TEXT_SIZE,
  headingFontSize,
  resolveBlockPadding,
  resolveButtonRadius,
  type TextField,
} from '../registry';
import type { Align, BlockDocument, BlockNode, ColumnsBlock, CoverBlock, VerticalAlign } from '../types';
import { BannerView, CountdownView, EmbedView, PAGE_BLOCKS_CSS } from './page-block-views';

/** Colors and fonts a document is shown with, e.g. from the event's styles. */
export type BlockViewTheme = {
  textColor: string;
  fontFamily: string;
  /** Headings. Defaults to `fontFamily`. */
  headingFontFamily?: string;
  /** Body text size in px. Defaults to 14. */
  textSize?: number;
  /** Small body text size in px. Defaults to 12. */
  smallTextSize?: number;
  buttonBackground: string;
  buttonText: string;
  /** Rounding of buttons that follow the theme (radius null), in px. Defaults to `DEFAULT_BUTTON_RADIUS`. */
  buttonRadius?: number | null;
  dividerColor: string;
  /** Box behind filled and accent callouts without a color of their own. */
  calloutBox?: string;
  /** The card behind the document. A banner's shaped edge is drawn in it. */
  cardBackground?: string;
  /** Rounding of boxes that follow the theme (e.g. countdown boxes with radius null), in px. */
  cardRadius?: number | null;
};

/**
 * Draws a block the host app owns (e.g. a program from the app's data, registration buttons that open
 * the app's form). Return `undefined` to use the built-in rendering, `null` to show nothing.
 */
export type RenderHostBlock = (block: BlockNode, read: (field: TextField) => string) => ReactNode | undefined;

export type BlockDocumentViewProps = ContentReadOptions & {
  document: BlockDocument;
  theme: BlockViewTheme;
  /** Event details filled in for the reader. Missing details show the blocks without links (editor preview). */
  context?: BlockContentContext;
  /** Turns stored rich text into safe HTML. Hosts sanitize here, and an editor can turn tags into chips. */
  renderHtml: (html: string) => string;
  /** Shows a plain text value. Defaults to the text itself; an editor preview can show its tags as chips. */
  renderPlainText?: (text: string) => ReactNode;
  /**
   * A link was clicked: a button, an image or a link in rich text. `href` is as stored, so it can be a
   * tag in an editor preview. Call `event.preventDefault()` to route it yourself.
   */
  onOpenLink?: (href: string, event: MouseEvent<HTMLElement>) => void;
  /** An image without a link was clicked, e.g. to show it larger. */
  onImageClick?: (src: string, event: MouseEvent<HTMLElement>) => void;
  /**
   * Blocks the host draws itself. Without it, Program and (on pages) RSVP blocks show nothing.
   * Pages also read two CSS variables from the host: `--eventmii-block-gutter` (side space of blocks
   * that are not full width) and `--eventmii-block-max-width` (their content width).
   */
  renderBlock?: RenderHostBlock;
  className?: string;
  style?: CSSProperties;
};

const CALLOUT_DEFAULT_BOX = '#f4f6f8';

const justify: Record<Align, CSSProperties['justifyContent']> = { left: 'flex-start', center: 'center', right: 'flex-end' };
const verticalJustify: Record<VerticalAlign, CSSProperties['justifyContent']> = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };

function bodySize(theme: BlockViewTheme, size: 'normal' | 'small'): number {
  return size === 'small'
    ? clampEmailBodyTextSize(theme.smallTextSize ?? EMAIL_BODY_TEXT_SIZE.small, EMAIL_BODY_TEXT_SIZE.small)
    : clampEmailBodyTextSize(theme.textSize ?? EMAIL_BODY_TEXT_SIZE.normal, EMAIL_BODY_TEXT_SIZE.normal);
}

/** A link a reader can follow: plain URLs only; tags are left to the host (`onOpenLink`). */
function followableUrl(value: string | null | undefined): string | undefined {
  const url = sanitizeUrl(value ?? '');
  return url && !parseTagOnlyValue(url) ? url : undefined;
}

type ButtonLook = { background: string | null; text: string; radius: number; block: boolean; border?: number };

function buttonStyle(look: ButtonLook, fontFamily: string): CSSProperties {
  const border = look.border ?? 0;
  return {
    display: look.block ? 'block' : 'inline-block',
    boxSizing: 'border-box',
    width: look.block ? '100%' : undefined,
    padding: `${12 - border}px ${24 - border}px`,
    fontFamily,
    fontSize: 15,
    fontWeight: 600,
    lineHeight: 1.2,
    textAlign: 'center',
    color: look.text,
    textDecoration: 'none',
    borderRadius: look.radius,
    backgroundColor: look.background ?? 'transparent',
    border: border > 0 ? `${border}px solid ${look.text}` : undefined,
    cursor: 'pointer',
  };
}

type ViewContext = Omit<BlockDocumentViewProps, 'className' | 'style'>;

function LinkButton({ label, href, look, align, view }: { label: string; href: string | null | undefined; look: ButtonLook; align: Align; view: ViewContext }) {
  const url = followableUrl(href);
  return (
    <div style={{ display: 'flex', justifyContent: justify[align] }}>
      <a
        href={url}
        target={url ? '_blank' : undefined}
        rel={url ? 'noopener noreferrer' : undefined}
        style={buttonStyle(look, view.theme.fontFamily)}
        onClick={(event) => {
          if (href) view.onOpenLink?.(href, event);
          else event.preventDefault();
        }}
      >
        {label}
      </a>
    </div>
  );
}

/** Rich text: links inside it go through `onOpenLink` too. */
function RichHtml({ html, view, style }: { html: string; view: ViewContext; style?: CSSProperties }) {
  return (
    <div
      className="eventmii-block-html"
      style={style}
      dangerouslySetInnerHTML={{ __html: view.renderHtml(html) }}
      onClick={(event) => {
        const anchor = event.target instanceof Element ? event.target.closest('a') : null;
        if (anchor) view.onOpenLink?.(anchor.getAttribute('href') ?? '', event);
      }}
    />
  );
}

function plainText(text: string, view: ViewContext): ReactNode {
  return view.renderPlainText ? view.renderPlainText(text) : text;
}

function BlockContent({ block, view, theme }: { block: BlockNode; view: ViewContext; theme: BlockViewTheme }): ReactNode {
  const read = (field: TextField) => readContentText(block, field, view);
  const hosted = view.renderBlock?.(block, read);
  if (hosted !== undefined) return hosted;

  switch (block.type) {
    case 'heading': {
      const html = inlineHtml(read('html'));
      if (!html.trim()) return null;
      const Tag = `h${block.props.level}` as const;
      return (
        <Tag
          className="eventmii-block-heading"
          style={{
            margin: 0,
            fontFamily: theme.headingFontFamily ?? theme.fontFamily,
            fontSize: headingFontSize(block.props.level),
            fontWeight: 700,
            lineHeight: 1.2,
            color: block.props.color ?? theme.textColor,
            textAlign: block.props.align,
          }}
          dangerouslySetInnerHTML={{ __html: view.renderHtml(html) }}
        />
      );
    }
    case 'text':
    case 'classic': {
      const html = read('html');
      if (isBlankHtml(html)) return null;
      const props = block.type === 'text' ? block.props : null;
      return (
        <RichHtml
          html={html}
          view={view}
          style={{
            color: props?.color ?? theme.textColor,
            fontSize: bodySize(theme, props?.size ?? 'normal'),
            lineHeight: 1.4,
            textAlign: props?.align,
          }}
        />
      );
    }
    case 'callout': {
      const html = read('html');
      if (isBlankHtml(html)) return null;
      const { props } = block;
      const accent = props.accentColor ?? theme.buttonBackground;
      const box = props.boxColor ?? (props.variant === 'outline' ? null : (theme.calloutBox ?? CALLOUT_DEFAULT_BOX));
      return (
        <div
          style={{
            padding: '16px 20px',
            backgroundColor: box ?? undefined,
            borderLeft: props.variant === 'accent' ? `4px solid ${accent}` : undefined,
            border: props.variant === 'outline' ? `1px solid ${accent}` : undefined,
            borderRadius: props.radius,
            textAlign: props.align,
          }}
        >
          <RichHtml html={html} view={view} style={{ color: props.color ?? theme.textColor, fontSize: bodySize(theme, props.size), lineHeight: 1.4 }} />
        </div>
      );
    }
    case 'button': {
      const label = read('label').trim();
      if (!label) return null;
      const { props } = block;
      return (
        <LinkButton
          label={label}
          href={read('href')}
          align={props.align}
          view={view}
          look={{ background: props.backgroundColor ?? theme.buttonBackground, text: props.textColor ?? theme.buttonText, radius: resolveButtonRadius(props.radius, theme.buttonRadius), block: props.fullWidth }}
        />
      );
    }
    case 'files': {
      const shareId = sanitizeShareId(block.props.shareId);
      if (!shareId) return null;
      const { props } = block;
      return (
        <LinkButton
          label={read('label').trim() || FILES_DEFAULT_LABELS[view.lang]}
          href={view.context?.fileShareUrls?.[shareId] ?? null}
          align={props.align}
          view={view}
          look={{ background: props.backgroundColor ?? theme.buttonBackground, text: props.textColor ?? theme.buttonText, radius: resolveButtonRadius(props.radius, theme.buttonRadius), block: props.fullWidth }}
        />
      );
    }
    case 'ticket': {
      const { props } = block;
      return (
        <LinkButton
          label={TICKET_BUTTON_LABELS[view.lang]}
          href={view.context?.ticketUrl ?? null}
          align={props.align}
          view={view}
          look={{ background: theme.buttonBackground, text: theme.buttonText, radius: resolveButtonRadius(props.radius, theme.buttonRadius), block: false }}
        />
      );
    }
    case 'calendar': {
      const code = calendarCodeFor(block.props);
      if (!code) return null;
      const { props } = block;
      const links = view.context?.calendarLinks?.[code];
      const look: ButtonLook = {
        background: props.backgroundColor ?? theme.buttonBackground,
        text: props.textColor ?? theme.buttonText,
        radius: resolveButtonRadius(props.radius, theme.buttonRadius),
        block: false,
      };
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: justify[props.align] }}>
          {(['google', 'outlook', 'ics'] as const).map((kind) => {
            const href = links?.[kind] ?? null;
            const url = followableUrl(href);
            return (
              <a
                key={kind}
                href={url}
                target={url ? '_blank' : undefined}
                rel={url ? 'noopener noreferrer' : undefined}
                style={buttonStyle(look, theme.fontFamily)}
                onClick={(event) => {
                  if (href) view.onOpenLink?.(href, event);
                  else event.preventDefault();
                }}
              >
                {CALENDAR_BUTTON_LABELS[kind === 'ics' ? 'download' : kind][view.lang]}
              </a>
            );
          })}
        </div>
      );
    }
    case 'event_info': {
      const { props } = block;
      const rows = (['when', 'where'] as const)
        .map((row) => {
          const source = eventInfoSource(props, row);
          const value = source === 'event' ? (view.context?.eventInfo?.[row] ?? '') : source === 'custom' ? read(row) : '';
          return { row, value: value.trim() };
        })
        .filter((entry) => entry.value);
      if (rows.length === 0) return null;
      const boxed = !!props.boxColor || !!props.borderColor;
      return (
        <div
          style={{
            color: props.color ?? theme.textColor,
            fontSize: bodySize(theme, 'normal'),
            lineHeight: 1.4,
            textAlign: props.align,
            padding: boxed ? '14px 18px' : undefined,
            backgroundColor: props.boxColor ?? undefined,
            border: props.borderColor ? `1px solid ${props.borderColor}` : undefined,
            borderRadius: boxed ? props.radius : undefined,
          }}
        >
          {rows.map(({ row, value }) => (
            <div key={row} style={{ display: 'flex', gap: 8, padding: '2px 0', justifyContent: justify[props.align] }}>
              {props.showIcons && <span aria-hidden>{row === 'when' ? '\u{1F4C5}' : '\u{1F4CD}'}</span>}
              <span style={{ whiteSpace: 'pre-line' }}>{plainText(value, view)}</span>
            </div>
          ))}
        </div>
      );
    }
    case 'image': {
      const src = read('src').trim();
      if (!/^https?:\/\//i.test(src)) return null;
      const href = read('href').trim();
      const url = followableUrl(href);
      const image = (
        <img
          src={src}
          alt={read('alt')}
          style={{ display: 'block', width: '100%', height: 'auto', borderRadius: block.props.radius }}
          onClick={(event) => {
            if (!href) view.onImageClick?.(src, event);
          }}
        />
      );
      return (
        <div style={{ display: 'flex', justifyContent: justify[block.props.align] }}>
          <div style={{ width: `${block.props.width}%` }}>
            {href ? (
              <a href={url} target={url ? '_blank' : undefined} rel={url ? 'noopener noreferrer' : undefined} onClick={(event) => view.onOpenLink?.(href, event)}>
                {image}
              </a>
            ) : (
              image
            )}
          </div>
        </div>
      );
    }
    case 'divider':
      return <hr style={{ border: 'none', borderTop: `${block.props.thickness}px ${block.props.lineStyle} ${block.props.color ?? theme.dividerColor}`, margin: 0 }} />;
    case 'spacer':
      return <div style={{ height: block.props.height }} />;
    case 'columns':
      return <Columns block={block} view={view} theme={theme} />;
    case 'cover':
      return <Cover block={block} view={view} theme={theme} />;
    case 'banner':
      return <BannerView props={block.props} src={read('src')} videoSrc={read('videoSrc')} alt={read('alt')} curveColor={theme.cardBackground} />;
    case 'countdown':
      return (
        <CountdownView
          props={block.props}
          heading={inlineHtml(read('html'))}
          endedText={read('endedText').trim()}
          eventStartsAt={view.context?.eventStartsAt}
          lang={view.lang}
          theme={theme}
          renderHtml={view.renderHtml}
          renderPlainText={(text) => plainText(text, view)}
        />
      );
    case 'embed':
      return <EmbedView props={block.props} src={read('src')} />;
    default:
      return null;
  }
}

/** Columns sit side by side and wrap under each other when the screen is too narrow (if they may stack). */
function Columns({ block, view, theme }: { block: ColumnsBlock; view: ViewContext; theme: BlockViewTheme }) {
  const widths = columnWidths(block.props.layout);
  const gap = block.props.gap;
  return (
    <div style={{ display: 'flex', flexWrap: block.props.stackOnMobile ? 'wrap' : 'nowrap', gap, alignItems: verticalJustify[block.props.verticalAlign] }}>
      {widths.map((percent, index) => (
        <div
          key={index}
          style={{
            flex: `1 1 calc(${percent}% - ${gap}px)`,
            minWidth: block.props.stackOnMobile ? 160 : 0,
          }}
        >
          <BlockList ids={block.children?.[index] ?? []} view={view} theme={theme} nested />
        </div>
      ))}
    </div>
  );
}

/** An image with blocks on top: the block's background image, its children in one column. */
function Cover({ block, view, theme }: { block: CoverBlock; view: ViewContext; theme: BlockViewTheme }) {
  const { props } = block;
  const childTheme = props.textColor ? { ...theme, textColor: props.textColor } : theme;
  const ratio = props.height === null && props.imageWidth && props.imageHeight ? `${props.imageWidth} / ${props.imageHeight}` : undefined;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: verticalJustify[props.verticalAlign],
        minHeight: props.height ?? undefined,
        aspectRatio: ratio,
        color: childTheme.textColor,
      }}
    >
      <BlockList ids={block.children?.[0] ?? []} view={view} theme={childTheme} nested />
    </div>
  );
}

function BlockFrame({ block, view, theme, nested }: { block: BlockNode; view: ViewContext; theme: BlockViewTheme; nested: boolean }) {
  if (!BLOCK_DEFINITIONS[block.type].surfaces.includes(view.document.surface)) return null;
  const content = <BlockContent block={block} view={view} theme={theme} />;
  const padding = resolveBlockPadding(block, view.document, nested);
  const backgroundImage = nested ? null : sanitizeBackgroundImageUrl(block.style.backgroundImage);
  // On pages the host's gutter and content width apply to every top-level block whose content is inset.
  const pageInset = view.document.surface === 'page' && !nested && !(block.style.fullWidth && block.type !== 'cover');
  const side = (px: number) => (pageInset ? `calc(${px}px + var(--eventmii-block-gutter, 0px))` : `${px}px`);
  return (
    <div
      className={`eventmii-block eventmii-block-${block.type}`}
      style={{
        padding: `${padding.top}px ${side(padding.right)} ${padding.bottom}px ${side(padding.left)}`,
        backgroundColor: block.style.backgroundColor ?? undefined,
        backgroundImage: backgroundImage ? `url("${backgroundImage}")` : undefined,
        backgroundSize: backgroundImage ? 'cover' : undefined,
        backgroundPosition: backgroundImage ? 'center' : undefined,
      }}
    >
      {pageInset ? <div style={{ maxWidth: 'var(--eventmii-block-max-width, none)', marginInline: 'auto' }}>{content}</div> : content}
    </div>
  );
}

function BlockList({ ids, view, theme, nested }: { ids: readonly string[]; view: ViewContext; theme: BlockViewTheme; nested: boolean }) {
  return (
    <>
      {ids.map((id) => {
        const block = view.document.blocks[id];
        return block ? <BlockFrame key={id} block={block} view={view} theme={theme} nested={nested} /> : null;
      })}
    </>
  );
}

/**
 * Shows a block document (an in-app message or a page) the same way in every app. It only
 * displays: texts come in prepared (filled in by the server for a reader, or raw in an editor
 * preview), and the host decides how HTML is sanitized, where links go and how host blocks look.
 */
export function BlockDocumentView({ className, style, ...view }: BlockDocumentViewProps) {
  const { document, theme } = view;
  return (
    <div
      className={['eventmii-block-document', className].filter(Boolean).join(' ')}
      style={{
        fontFamily: theme.fontFamily,
        color: theme.textColor,
        paddingTop: document.root.style.paddingTop,
        paddingBottom: document.root.style.paddingBottom,
        ...style,
      }}
    >
      {document.surface === 'page' && (
        <style href="eventmii-page-blocks" precedence="default">
          {PAGE_BLOCKS_CSS}
        </style>
      )}
      <BlockList ids={document.root.childIds} view={view} theme={theme} nested={false} />
    </div>
  );
}
