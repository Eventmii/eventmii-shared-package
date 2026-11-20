import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  adjustTopSpacing,
  createBlock,
  createEmptyDocument,
  createLegacyDocument,
  documentFallbackHtml,
  embedUrlFromInput,
  insertBlock,
  insertableBlockTypes,
  parseBlockDocument,
  parseBlockProps,
  timeLeftUntil,
  type BlockDocument,
  type BlockNode,
  type TextMap,
} from '../index';
import { BlockDocumentView, type BlockViewTheme } from './index';

const OWNER = 'page.0b1e7a2c-9f4d-4c1a-8e2b-5d6f7a8b9c0d';

const theme: BlockViewTheme = {
  textColor: '#1f363d',
  fontFamily: 'Poppins, sans-serif',
  buttonBackground: '#0f766e',
  buttonText: '#ffffff',
  dividerColor: '#e5e7eb',
  cardBackground: '#ffffff',
};

function pageDocument(...blocks: BlockNode[]): BlockDocument {
  let document = createEmptyDocument('page');
  for (const block of blocks) {
    document = insertBlock(document, block, { parentId: 'root', region: 0, index: document.root.childIds.length });
  }
  return document;
}

const key = (block: BlockNode, field: string) => `${OWNER}.block.${block.id}.${field}`;

function render(document: BlockDocument, texts: TextMap, extra: Partial<Parameters<typeof BlockDocumentView>[0]> = {}) {
  return renderToStaticMarkup(<BlockDocumentView document={document} ownerKey={OWNER} texts={texts} lang="en" theme={theme} renderHtml={(html) => html} {...extra} />);
}

describe('page blocks', () => {
  it('offers the page blocks on pages only, and no classic content', () => {
    const page = insertableBlockTypes('page', false);
    expect(page).toEqual(expect.arrayContaining(['banner', 'countdown', 'embed', 'program', 'rsvp', 'callout', 'event_info', 'calendar', 'ticket']));
    expect(page).not.toContain('classic');
    for (const surface of ['email', 'in_app'] as const) {
      expect(insertableBlockTypes(surface, false)).not.toEqual(expect.arrayContaining(['banner']));
      expect(insertableBlockTypes(surface, false)).not.toContain('countdown');
    }
    expect(parseBlockDocument(createLegacyDocument('page'), 'page').ok && parseBlockDocument(createLegacyDocument('page'), 'page')).toMatchObject({
      document: { root: { childIds: [] } },
    });
  });

  it('repairs page block props', () => {
    expect(parseBlockProps('banner', { height: '50%', mobileHeight: '300px', curve: 'zigzag', curveHeight: 999 })).toEqual({
      height: 'auto',
      mobileHeight: '300px',
      curve: null,
      curveHeight: 200,
      curveFlip: false,
    });
    expect(parseBlockProps('countdown', { source: 'custom', customDate: 'not a date' })).toMatchObject({ source: 'custom', customDate: null });
    expect(parseBlockProps('countdown', { customDate: '2027-01-02T10:00:00+01:00' }).customDate).toBe('2027-01-02T09:00:00.000Z');
    expect(parseBlockProps('program', { programId: 'nope' }).programId).toBeNull();
    expect(parseBlockProps('embed', { aspectRatio: '2:1' }).aspectRatio).toBe('16:9');
  });

  it('starts a banner flush with the top of the page', () => {
    const empty = createEmptyDocument('page');
    const banner = createBlock('banner', 'page', { id: 'bbanner001' });
    expect(banner.style.fullWidth).toBe(true);
    expect(adjustTopSpacing(empty, insertBlock(empty, banner, { parentId: 'root', region: 0, index: 0 })).root.style.paddingTop).toBe(0);
  });

  it('reads embed addresses from pasted iframe code, https only', () => {
    expect(embedUrlFromInput('<iframe width="560" src="https://www.youtube.com/embed/abc?si=1&amp;t=2" allowfullscreen></iframe>')).toBe('https://www.youtube.com/embed/abc?si=1&t=2');
    expect(embedUrlFromInput('https://maps.google.com/maps?q=x')).toBe('https://maps.google.com/maps?q=x');
    expect(embedUrlFromInput('http://example.com')).toBeNull();
    expect(embedUrlFromInput('javascript:alert(1)')).toBeNull();
  });

  it('counts down in whole units and stops at zero', () => {
    const now = Date.parse('2027-01-01T00:00:00Z');
    expect(timeLeftUntil(now + ((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000, now)).toEqual({ days: 2, hours: 3, minutes: 4, seconds: 5 });
    expect(timeLeftUntil(now - 1000, now)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });
});

describe('page rendering', () => {
  it('renders a banner with its shaped edge in the card color, and an embed frame', () => {
    const banner = createBlock('banner', 'page', { id: 'bbanner002', props: { height: '400px', mobileHeight: '200px', curve: 'wave' } });
    const embed = createBlock('embed', 'page', { id: 'bembed0002' });
    const html = render(pageDocument(banner, embed), {
      [key(banner, 'src')]: { en: 'https://cdn.example.com/banner.jpg' },
      [key(embed, 'src')]: { en: 'https://www.youtube.com/embed/abc' },
    });
    expect(html).toContain('src="https://cdn.example.com/banner.jpg"');
    expect(html).toContain('--eventmii-banner-h:400px');
    expect(html).toContain('--eventmii-banner-h-mobile:200px');
    expect(html).toContain('fill="#ffffff"');
    expect(html).toContain('<iframe src="https://www.youtube.com/embed/abc"');
    expect(html).toContain('aspect-ratio:16 / 9');
  });

  it('gives inset blocks the host gutter, but not full-width ones', () => {
    const banner = createBlock('banner', 'page', { id: 'bbanner003' });
    const text = createBlock('text', 'page', { id: 'btext00003' });
    const html = render(pageDocument(banner, text), {
      [key(banner, 'src')]: { en: 'https://cdn.example.com/banner.jpg' },
      [key(text, 'html')]: { en: '<p>Hello</p>' },
    });
    const bannerFrame = html.slice(html.indexOf('eventmii-block-banner'), html.indexOf('eventmii-block-text'));
    expect(bannerFrame).not.toContain('--eventmii-block-gutter');
    expect(html.slice(html.indexOf('eventmii-block-text'))).toContain('calc(0px + var(--eventmii-block-gutter, 0px))');
    expect(html).toContain('max-width:var(--eventmii-block-max-width, none)');
  });

  it('counts down to the event start from the context, and shows the ended text afterwards', () => {
    const countdown = createBlock('countdown', 'page', { id: 'bcount0001', props: { showSeconds: false } });
    const texts = { [key(countdown, 'html')]: { en: 'See you soon' }, [key(countdown, 'endedText')]: { en: 'We are live!' } };
    const upcoming = render(pageDocument(countdown), texts, { context: { eventStartsAt: new Date(Date.now() + 3 * 86400000).toISOString() } });
    expect(upcoming).toContain('See you soon');
    expect(upcoming).toContain('Days');
    expect(upcoming).not.toContain('Seconds');
    const past = render(pageDocument(countdown), texts, { context: { eventStartsAt: '2020-01-01T00:00:00Z' } });
    expect(past).toContain('We are live!');
    expect(past).not.toContain('Days');
    expect(render(pageDocument(countdown), texts)).not.toContain('See you soon');
  });

  it('lets the host draw program and registration blocks, and shows nothing for them otherwise', () => {
    const program = createBlock('program', 'page', { id: 'bprog00001', props: { programId: '0b1e7a2c-9f4d-4c1a-8e2b-5d6f7a8b9c0d' } });
    const rsvp = createBlock('rsvp', 'page', { id: 'brsvp00001' });
    const texts = { [key(rsvp, 'label')]: { en: 'Join us' } };
    expect(render(pageDocument(program, rsvp), texts)).not.toContain('Join us');
    const hosted = render(pageDocument(program, rsvp), texts, {
      renderBlock: (block, read) => {
        if (block.type === 'program') return <div>program {block.props.programId}</div>;
        if (block.type === 'rsvp') return <button>{read('label')}</button>;
        return undefined;
      },
    });
    expect(hosted).toContain('program 0b1e7a2c-9f4d-4c1a-8e2b-5d6f7a8b9c0d');
    expect(hosted).toContain('<button>Join us</button>');
  });

  it('writes a banner, countdown heading and embed link into the fallback HTML', () => {
    const banner = createBlock('banner', 'page', { id: 'bbanner004' });
    const countdown = createBlock('countdown', 'page', { id: 'bcount0004' });
    const embed = createBlock('embed', 'page', { id: 'bembed0004' });
    const html = documentFallbackHtml(pageDocument(banner, countdown, embed), {
      ownerKey: OWNER,
      lang: 'en',
      texts: {
        [key(banner, 'src')]: { en: 'https://cdn.example.com/b.jpg' },
        [key(countdown, 'html')]: { en: 'Soon' },
        [key(embed, 'src')]: { en: 'https://www.youtube.com/embed/abc' },
      },
    });
    expect(html).toBe('<p><img src="https://cdn.example.com/b.jpg" alt=""></p><h2>Soon</h2><p><a href="https://www.youtube.com/embed/abc">https://www.youtube.com/embed/abc</a></p>');
  });
});
