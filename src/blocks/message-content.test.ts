import { describe, expect, it } from 'vitest';
import {
  BLOCK_DEFINITIONS,
  createBlock,
  createEmptyDocument,
  createLegacyDocument,
  documentFallbackHtml,
  documentPushImage,
  documentPushText,
  htmlPushText,
  insertBlock,
  insertableBlockTypes,
  removePersonalTicketTags,
  truncateText,
  type BlockDocument,
  type BlockNode,
  type TextMap,
} from './index';

const OWNER = 'communication.0b1e7a2c-9f4d-4c1a-8e2b-5d6f7a8b9c0d';

function appDocument(...blocks: BlockNode[]): BlockDocument {
  let document = createEmptyDocument('in_app');
  for (const block of blocks) {
    document = insertBlock(document, block, { parentId: 'root', region: 0, index: document.root.childIds.length });
  }
  return document;
}

const key = (block: BlockNode, field: string) => `${OWNER}.block.${block.id}.${field}`;

describe('in-app surface', () => {
  it('offers callout, when & where, calendar and ticket in messages, but not RSVP', () => {
    const types = insertableBlockTypes('in_app', false);
    expect(types).toEqual(expect.arrayContaining(['callout', 'event_info', 'calendar', 'ticket', 'files', 'columns']));
    expect(types).not.toContain('rsvp');
    expect(BLOCK_DEFINITIONS.rsvp.surfaces).toEqual(['email', 'page']);
  });
});

describe('documentPushText', () => {
  it('reads headings and text, leaves buttons and images out, and closes headings', () => {
    const heading = createBlock('heading', 'in_app', { id: 'bhead00001' });
    const button = createBlock('button', 'in_app', { id: 'bbutton001' });
    const image = createBlock('image', 'in_app', { id: 'bimage0001' });
    const text = createBlock('text', 'in_app', { id: 'btext00001' });
    const texts: TextMap = {
      [key(heading, 'html')]: { en: '<p>Welcome to the party</p>' },
      [key(button, 'label')]: { en: 'Show the program' },
      [key(image, 'src')]: { en: 'https://cdn.example.com/a.jpg' },
      [key(text, 'html')]: { en: '<p>Doors open at <strong>19:00</strong>.</p><ul><li>Bring a coat</li><li>Arrive early</li></ul>' },
    };
    const output = documentPushText(appDocument(heading, button, image, text), { ownerKey: OWNER, texts, lang: 'en' });
    expect(output).toBe('Welcome to the party. Doors open at 19:00. · Bring a coat · Arrive early');
  });

  it('keeps a heading that ends with an emoji as it is', () => {
    const heading = createBlock('heading', 'in_app', { id: 'bhead00002' });
    const output = documentPushText(appDocument(heading), { ownerKey: OWNER, texts: { [key(heading, 'html')]: { en: 'Spooky night 😱' } }, lang: 'en' });
    expect(output).toBe('Spooky night 😱');
  });

  it('leaves personal ticket QR codes out of classic content and cuts long text at a word', () => {
    const document = createLegacyDocument('in_app');
    const long = 'word '.repeat(60);
    const output = documentPushText(document, {
      ownerKey: OWNER,
      texts: { [`${OWNER}.content`]: { da: `<p>Din billet: {{guest.personal_ticket;;size=180&details=1}}</p><p>${long}</p>` } },
      lang: 'da',
      maxLength: 60,
    });
    expect(output).not.toContain('personal_ticket');
    expect(output.length).toBeLessThanOrEqual(60);
    expect(output.endsWith('…')).toBe(true);
    expect(output.startsWith('Din billet: word')).toBe(true);
  });

  it('cleans legacy HTML bodies the same way', () => {
    expect(htmlPushText('<p>Hi</p><table><tr><td>QR</td></tr></table><p>See you</p>')).toBe('Hi See you');
    expect(removePersonalTicketTags('a {{guest.personal_ticket}} b')).toBe('a  b');
    expect(truncateText('short', 10)).toBe('short');
  });
});

describe('documentPushImage', () => {
  it('uses the first image, also from inside rich text, and ignores non-https', () => {
    const text = createBlock('text', 'in_app', { id: 'btext00003' });
    const image = createBlock('image', 'in_app', { id: 'bimage0003' });
    const texts: TextMap = {
      [key(text, 'html')]: { en: '<p><img src="http://insecure.example.com/a.png"> <img src="https://cdn.example.com/inline.png"></p>' },
      [key(image, 'src')]: { en: 'https://cdn.example.com/block.jpg' },
    };
    expect(documentPushImage(appDocument(text, image), { ownerKey: OWNER, texts, lang: 'en' })).toBe('https://cdn.example.com/inline.png');
    expect(documentPushImage(appDocument(image), { ownerKey: OWNER, texts, lang: 'en' })).toBe('https://cdn.example.com/block.jpg');
  });
});

describe('documentFallbackHtml', () => {
  it('lays out blocks as simple HTML with event buttons and the context filled in', () => {
    const heading = createBlock('heading', 'in_app', { id: 'bhead00004' });
    const button = createBlock('button', 'in_app', { id: 'bbutton004' });
    const info = createBlock('event_info', 'in_app', { id: 'binfo00004' });
    const ticket = createBlock('ticket', 'in_app', { id: 'bticket004' });
    const calendar = createBlock('calendar', 'in_app', { id: 'bcal000004' });
    const texts: TextMap = {
      [key(heading, 'html')]: { en: '<p>Hello & welcome</p>' },
      [key(button, 'label')]: { en: 'Open <program>' },
      [key(button, 'href')]: { en: 'https://example.com/program' },
    };
    const html = documentFallbackHtml(appDocument(heading, button, info, ticket, calendar), {
      ownerKey: OWNER,
      texts,
      lang: 'en',
      context: {
        eventInfo: { when: 'Friday 31 October, 19:00', where: 'The Old Mill' },
        ticketUrl: '/event/party/ticket',
        calendarLinks: { 'event.add_to_calendar': { google: 'https://calendar.google.com/x', ics: 'https://api.example.com/ics' } },
      },
    });
    expect(html).toContain('<h2>Hello & welcome</h2>');
    expect(html).toContain('<a class="event-button" href="https://example.com/program">Open &lt;program&gt;</a>');
    expect(html).toContain('Friday 31 October, 19:00');
    expect(html).toContain('The Old Mill');
    expect(html).toContain('href="/event/party/ticket">Show my ticket</a>');
    expect(html).toContain('Google Calendar');
    expect(html).toContain('Download (.ics)');
    expect(html).not.toContain('Outlook');
  });

  it('shows a button whose link is still a tag as plain text', () => {
    const button = createBlock('button', 'in_app', { id: 'bbutton005' });
    const html = documentFallbackHtml(appDocument(button), {
      ownerKey: OWNER,
      texts: { [key(button, 'label')]: { en: 'Register' }, [key(button, 'href')]: { en: '{{guest.registration_page_url}}' } },
      lang: 'en',
    });
    expect(html).toBe('<p>Register</p>');
  });
});
