import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createBlock, createEmptyDocument, insertBlock, type BlockDocument, type BlockNode, type TextMap } from '../index';
import { BlockDocumentView, type BlockViewTheme } from './index';

const OWNER = 'communication.0b1e7a2c-9f4d-4c1a-8e2b-5d6f7a8b9c0d';

const theme: BlockViewTheme = {
  textColor: '#1f363d',
  fontFamily: 'Poppins, sans-serif',
  buttonBackground: '#0f766e',
  buttonText: '#ffffff',
  dividerColor: '#e5e7eb',
};

function documentWith(surface: BlockDocument['surface'], ...blocks: BlockNode[]): BlockDocument {
  let document = createEmptyDocument(surface);
  for (const block of blocks) {
    document = insertBlock(document, block, { parentId: 'root', region: 0, index: document.root.childIds.length });
  }
  return document;
}

const key = (block: BlockNode, field: string) => `${OWNER}.block.${block.id}.${field}`;

function render(document: BlockDocument, texts: TextMap, extra: Partial<Parameters<typeof BlockDocumentView>[0]> = {}) {
  return renderToStaticMarkup(
    <BlockDocumentView document={document} ownerKey={OWNER} texts={texts} lang="en" theme={theme} renderHtml={(html) => html} {...extra} />
  );
}

describe('BlockDocumentView', () => {
  it('renders headings, text through the host sanitizer, and buttons with their links', () => {
    const heading = createBlock('heading', 'in_app', { id: 'bhead00001', props: { level: 1 } });
    const text = createBlock('text', 'in_app', { id: 'btext00001' });
    const button = createBlock('button', 'in_app', { id: 'bbutton001' });
    const html = render(
      documentWith('in_app', heading, text, button),
      {
        [key(heading, 'html')]: { en: '<p>Welcome</p>' },
        [key(text, 'html')]: { en: '<p>Hi <script>x</script>there</p>' },
        [key(button, 'label')]: { en: 'Program' },
        [key(button, 'href')]: { en: 'https://example.com/program' },
      },
      { renderHtml: (value) => value.replace(/<script>.*?<\/script>/g, '') }
    );
    expect(html).toContain('<h1');
    expect(html).toContain('>Welcome</h1>');
    expect(html).toContain('<p>Hi there</p>');
    expect(html).toContain('href="https://example.com/program"');
    expect(html).toContain('>Program</a>');
  });

  it('leaves links that are still tags to the host, and shows the ticket and calendar from the context', () => {
    const button = createBlock('button', 'in_app', { id: 'bbutton002' });
    const ticket = createBlock('ticket', 'in_app', { id: 'bticket002' });
    const calendar = createBlock('calendar', 'in_app', { id: 'bcal000002' });
    const html = render(
      documentWith('in_app', button, ticket, calendar),
      { [key(button, 'label')]: { en: 'Register' }, [key(button, 'href')]: { en: '{{guest.registration_page_url}}' } },
      { context: { ticketUrl: '/event/party/ticket', calendarLinks: { 'event.add_to_calendar': { google: 'https://calendar.google.com/x' } } } }
    );
    expect(html).not.toContain('{{guest.registration_page_url}}');
    expect(html).toContain('Show my ticket');
    expect(html).toContain('href="/event/party/ticket"');
    expect(html).toContain('href="https://calendar.google.com/x"');
    expect(html).toContain('Outlook');
  });

  it('skips blocks the surface does not allow', () => {
    const rsvp = createBlock('rsvp', 'email', { id: 'brsvp00003' });
    const document = documentWith('email', rsvp);
    const html = render({ ...document, surface: 'in_app' }, {});
    expect(html).not.toContain('eventmii-block-rsvp');
  });

  it('shows When & where from the event, and custom rows from the texts', () => {
    const info = createBlock('event_info', 'in_app', { id: 'binfo00004', props: { whereSource: 'custom' } });
    const html = render(documentWith('in_app', info), { [key(info, 'where')]: { en: 'The Old Mill' } }, { context: { eventInfo: { when: 'Friday 19:00' } } });
    expect(html).toContain('Friday 19:00');
    expect(html).toContain('The Old Mill');
  });
});
