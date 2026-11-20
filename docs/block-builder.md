# Block builder

How Eventmii's block builder works across the repos, how translations tie into it, and how event pages (in the guest app and on the public event site) should move onto it. Written to be handed to someone (or an AI thread) picking the work up.

Status (November 2026):

- **Emails**: built with blocks. Messages, standard emails and audience overrides.
- **Push & App messages**: built with blocks. Admin builder, server resolution, and guest app rendering are done on `feature/block-builder` in node-server, admin-frontend and guest-app-site.
- **Event pages**: built with blocks (`page` surface). See "Event pages" below. Pages without a stored document still show their old rich-text HTML; there is no conversion of old pages.

## The idea in one paragraph

Content is a **block document** (a tree of blocks with layout props) plus **texts** stored per language in `event_text`. The document is shared by all languages; only texts are translated. The same document model serves several **surfaces** (`email`, `in_app`, `page`), and each surface allows its own set of blocks. Emails are rendered on the server to MJML/HTML. App content is rendered by one shared React component (`BlockDocumentView`) in the guest app, the admin preview, and later the public event site. Tags such as `{{guest.first_name}}` stay in the stored texts and are always filled in on the server for the reader.

## Where things live

| Repo                       | What                                                                                                                                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eventmii-shared`          | The block model: types, registry, schema/validation, tree operations, text keys, readers, email MJML renderer (`blocks/email-mjml`), React renderer (`blocks/react`), fallback HTML and notification text (`message-content.ts`). Tests with vitest. |
| `eventmii-database`        | `event_content_document` table, RLS (`SQL/security-policies/tables/event_content_document.sql`), and the `save_event_content_document` function (`SQL/functions/event/`).                                                                            |
| `eventmii-node-servers`    | Saving documents (`PUT /content-documents/:event_id`), loading them, rendering emails, filling in tags for a reader (`features/guest-content/resolve-guest-content.ts`), in-app content endpoint, push text, translation endpoints.                  |
| `eventmii-admin-dashboard` | The builders (`src/features/block-builder/`), translation tools (`src/features/localization/`), message screens.                                                                                                                                     |
| `eventmii-guest-app-site`  | Renders in-app messages and block pages with `BlockDocumentView` (`src/features/content-blocks/content-blocks.tsx`).                                                                                                                                 |

### Using a new version of `eventmii-shared`

Apps depend on an exact commit, not a version:

```json
"eventmii-shared": "github:Eventmii/eventmii-shared-package#<commit>"
```

The same URL is also listed under `allowScripts` (npm must be allowed to run the package's `prepare` script, which builds `dist/` with tsup on install). To ship a change: commit and push `eventmii-shared`, then update **both** places in each app's `package.json` (admin-frontend, node-server, guest-app-site) and run `npm install`. Each app branch pins its own commit, so a shared change only reaches an app when that app is repinned.

Entry points: `eventmii-shared/blocks` (model, everything server and client need), `eventmii-shared/blocks/email-mjml` (email rendering), `eventmii-shared/blocks/react` (React renderer; `react` is an optional peer dependency, so node-server does not need it).

## Data model

### Documents

```ts
type BlockDocument = {
  version: number;
  surface: "email" | "in_app" | "page";
  root: { childIds: string[]; style: RootStyle }; // RootStyle: paddingTop, paddingBottom, paddingX, showFooter
  blocks: Record<string, BlockNode>; // flat map; containers list children per region
};
```

- `parseBlockDocument(raw, expectedSurface?)` validates and repairs a document (unknown props fall back to defaults, blocks not allowed on the surface are rejected). Always parse what comes from the database or a client.
- Containers: `columns` (one region per column) and `cover` (an image with blocks on top, one region).
- Root `paddingX` is the side spacing. For `email` it defaults to the email inset; for `in_app` and `page` it defaults to **0**, because the host page provides the gutter (16px in the app). `fullWidth` on a block skips `paddingX`.

### Blocks and surfaces

The registry (`src/blocks/registry.ts`, `BLOCK_DEFINITIONS`) defines each block's label, allowed surfaces, props schema with defaults, default style, and **text fields**.

| Block                     | Surfaces            | Text fields                                                          |
| ------------------------- | ------------------- | -------------------------------------------------------------------- |
| heading                   | email, in_app, page | `html` (inline)                                                      |
| text                      | email, in_app, page | `html` (rich)                                                        |
| button                    | email, in_app, page | `label` (plain), `href` (url)                                        |
| image                     | email, in_app, page | `src` (url), `alt` (plain), `href` (url)                             |
| divider, spacer           | email, in_app, page | none                                                                 |
| columns, cover            | email, in_app, page | none (containers)                                                    |
| classic                   | email, in_app       | `html` (rich), stored in the owner's legacy content key              |
| files                     | email, in_app, page | `label` (plain); links to a file share (`props.shareId`)             |
| callout                   | email, in_app, page | `html` (rich)                                                        |
| event_info (When & where) | email, in_app, page | `when`, `where` (plain, for custom rows)                             |
| calendar                  | email, in_app, page | none (event date, or a custom date in props)                         |
| ticket                    | email, in_app, page | none. Email: the personal QR ticket. App and pages: a "Show my ticket" button (only for a logged-in guest). |
| rsvp                      | email, page         | `label`, `declineLabel` (plain). On pages the host draws it (opens the registration flow). |
| banner                    | page                | `src`, `videoSrc` (url), `alt` (plain). Full width; height, mobile height, shaped bottom edge. |
| countdown                 | page                | `html` (inline heading), `endedText` (plain). Counts to the event start (`context.eventStartsAt`) or a custom date. |
| embed                     | page                | `src` (url, https only). An iframe with a fixed aspect ratio.         |
| program                   | page                | none (`props.programId`). The host draws the program timeline.       |

Button-like blocks (button, files, calendar, ticket in the app, rsvp) have `radius: number | null`; null (the default for new blocks) follows the theme's button rounding: `resolveButtonRadius(own, theme.buttonRadius)`, else `DEFAULT_BUTTON_RADIUS` (6). The theme value comes from the email theme's `buttonRadius` (Style panel; null there means the event's `event_styles.button_rounding`), and for app content from `event_styles.button_rounding` directly (`parseRoundingPx("8px")`). The email ticket card uses `radius ?? TICKET_CARD_RADIUS`.

Text field kinds decide how a value is stored and rendered: `rich`/`inline` are HTML from the rich text editor, `plain` is plain text, `url` is a URL **or a tag** (e.g. a button linking to `{{guest.registration_page_url}}`).

### Storage

- **Document**: `event_content_document (event_id, key, document jsonb, updated_at)`, one row per owner. No row means the owner has no blocks yet (it shows its legacy content).
- **Texts**: `event_text (event_id, key, en, da, de, swe)`, the same table as every other event text.

Every email, message and page has an **owner key**, the prefix of all its texts (`OWNER_KEY_PATTERN` in `keys.ts`):

| Owner                                 | Key                                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Message (email, SMS, in-app)          | `communication.<uuid>`                                                                                   |
| Standard email                        | `email.invitation`, `email.confirmation`, `email.non_confirmation`, `email.cancellation`, `email.ticket` |
| Audience override of a standard email | `event-message-override.<uuid>`                                                                          |
| Event page                            | `page.<uuid>`                                                                                            |

Text keys below an owner:

| Key                                    | What                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `<owner>.subject`, `<owner>.preheader` | Email/message header fields                                                   |
| `<owner>.content`                      | Legacy (pre-block) HTML body. Also what a **Classic** block reads and writes. |
| `<owner>.raw_html_override`            | Emails only: hand-written HTML ("Custom HTML" mode)                           |
| `<owner>.block.<blockId>.<field>`      | A block text, e.g. `communication.123….block.b7k2m9qx.html`                   |

Use `textKeyForBlock(ownerKey, block, field)`, `documentTextKeys(document, ownerKey)` and `orphanedBlockTextKeys(...)` rather than building keys by hand.

### Legacy content and the Classic block

Content written before blocks is not migrated. An owner without a stored document opens as `createLegacyDocument(surface)`: one Classic block whose text is the owner's `<owner>.content`. Saving without adding blocks keeps it legacy (`isLegacyOnlyDocument` → the save sends `document: null`). Adding blocks around the Classic block keeps the old HTML in place and in the same key.

### Saving

Admin → `PUT /content-documents/:event_id` (node `features/content-documents/_save-content-document-handler.ts`) with `{ owner_key, document | null, texts: [{ key, lang, value }] }` (only changed cells, from `buildContentSave`).

The server:

1. checks the user is an admin of the event and the owner belongs to it, and works out the owner's surface (`EMAIL` → `email`, `IN_APP` → `in_app`, standard emails and overrides → `email`, `page.<id>` → `page`);
2. validates the document for that surface (rejects inconsistencies);
3. calls `save_event_content_document` (service role only), which upserts the document and texts and deletes block texts no longer used, all in one transaction. The function refuses texts outside the owner prefix.
4. for pages, clears the page caches (public page content, the app's page list, the public event payload) so the change shows at once.

## Rendering

### Emails (server)

`resolveEmailBody` (node `content-documents.ts`) loads the stored document (or the legacy HTML) and `buildEmailMjml` (shared `email-mjml`) turns it into MJML with **slots**: every part that depends on the recipient (rich texts, buttons, calendar, ticket, preheader, footer) becomes a slot whose raw text is resolved per recipient, then filled into the compiled HTML (`block-email.ts`: `compileEventEmail` once per language, `finishEventEmail` per recipient). The admin preview calls the same pipeline with tags shown as highlighted labels.

### App content (`BlockDocumentView`)

`eventmii-shared/blocks/react` exports `BlockDocumentView`. It only displays; it never fetches or resolves tags. Props:

- `document`, `ownerKey`, `texts`, `lang`, `fallbacks`: what to show (texts are read with `readContentText`).
- `theme: BlockViewTheme`: text color, fonts, button colors, divider color, text sizes.
- `context?: BlockContentContext`: event details filled in by the server: `eventInfo` (when/where), `calendarLinks` per calendar code, `ticketUrl`, `fileShareUrls`, `eventStartsAt`.
- `renderHtml(html)`: the host sanitizes rich text here (guest app: DOMPurify config; admin: `sanitizeHtml` plus tag chips).
- `renderPlainText?`, `onOpenLink?(href, event)`, `onImageClick?`.
- `renderBlock?(block, read)`: blocks the host draws itself. Return `undefined` for the built-in rendering, `null` for nothing. Used for Program (the app's timeline and data) and RSVP on pages (the app's registration flow); without it those show nothing.
- Pages read two CSS variables from the host: `--eventmii-block-gutter` (side space of blocks that are not full width, on top of root `paddingX`) and `--eventmii-block-max-width` (their content width). Full-width blocks such as the Banner reach the card edges. Theme fields `cardBackground` (the banner edge color) and `cardRadius` (countdown boxes) come from the event's styles.
- Banner, Countdown and Embed are drawn by the shared renderer (`page-block-views.tsx`, also exported as `BannerView`, `CountdownView`, `EmbedView` for editor canvases). Their responsive rules are a React 19 `<style href precedence>` (`PAGE_BLOCKS_CSS`).

It skips blocks the document's surface does not allow. Links whose value is still a tag are rendered without `href` and passed to `onOpenLink`, so an editor preview can explain them.

Hosts style rich text inside blocks with their own CSS on `.eventmii-block-html` (lists, links, `a.event-button`, images): admin `block-builder.css` (`.app-block-preview`), guest app `src/features/content-blocks/content-blocks.css` (`.content-blocks`). On the public event site, `page-previewer.css` also resets the card's forced typography inside `.page-blocks`. Do not reuse the guest app's `.htmlContent` rules there: they force one font size on everything. These two stylesheets and the button color rule (`buttonColors`: a brand color too light for white swaps with its contrast color) exist in both apps and must stay in step; they are candidates to move into `eventmii-shared`.

### Fallback HTML and notification text (`message-content.ts`)

- `documentFallbackHtml(document, { ownerKey, texts, lang, context })`: simple HTML (headings, text, images, links as `a.event-button`) for clients that cannot show blocks. Installed app versions get this in the message list's `content`.
- `documentPushText(...)`: plain text from headings, text, callouts and Classic content only (no button labels, no downloads, no ticket), headings closed with a full stop, cut at a word to 178 characters. `htmlPushText(html)` does the same for legacy HTML.
- `documentPushImage(...)`: the first `https` image (image block, cover background, or an `<img>` in rich text).
- `removePersonalTicketTags(value)`: drop `{{guest.personal_ticket…}}` before filling in tags for text that cannot show a QR code.

## Tags and personal data

Stored texts keep their tags. They are filled in on the server for the reader, never in the browser for another guest:

- `resolveGuestContent({ eventId, ownerKey, surface, lang, reader })` in node `features/guest-content/resolve-guest-content.ts` loads the document and texts, fills in every text field (`url` fields that are a link tag become the link's address; `plain` fields become plain text), and builds the `context`. Returns `{ document, ownerKey, lang, texts, context, fallbackHtml, previewText }`.
- `reader = { eventData, guestData? }`. **With a guest**: personal tags, links and tokens are filled in (`dynamicParseTextWithData`). **Without a guest** (visitors who are not logged in): event tags are filled in, personal links become the shared link to the same page, other personal values are left out (`parseTextForPreview(..., { omitGuestTags: true })`).
- Access is the endpoint's job, not the resolver's.

In-app endpoints:

- `GET /in-app-messages/:recipient_id/content?lang=`: guest JWT (`user_token`); the recipient row must be the caller's and its message `IN_APP`, otherwise 404. Returns the resolver output plus the filled-in `subject`. Messages without blocks return `document: null` and their HTML in `fallback_html`.
- `GET /get-in-app-messages` (list): block messages get `has_blocks: true`, `content` = fallback HTML, and every message gets `preview_text` (same text as the push).
- Push: `processCommunicationInApp` / single test send build the body with `documentPushParts` (block) or `htmlPushText` (legacy) per guest, after removing personal ticket tags.

## Translations

The document is shared by all languages; texts are per language columns in `event_text`. A text missing in a language falls back to the event's default language when shown (`readLocalized(entry, lang, fallbacks)`), so a translation can be partial.

In the builder (admin):

- `useBuilderController` keeps the language being edited. In a translated language, `structureLocked` is true: no adding, moving or deleting blocks and no layout changes, only texts. Faded text on the canvas still shows the default language.
- The block panel shows the original next to each field (`inspector/translation-source.tsx`) with "Copy in" and AI translate. Subject and preview text have the same inline helper.
- The language selector shows `+N` for texts the default language has and that language does not (`LanguageSelect` in `builder-chrome.tsx`).
- The **Translate** button (`TranslateContentButton`) opens the owner's translation card: all its texts in a table, with AI translation of what is missing.

Shared glue:

- `buildOwnerTexts({ ownerKey, eventTexts, document, communicationType })` (admin `localization/owner-texts.ts`) lists an owner's translatable texts in the order the document shows them; texts of removed blocks are left out. `getContentType(key)` decides the editor per key (rich, inline, plain). `isMessageTextKey` excludes `url` fields (`.href`): links are not translated by default.
- The translations page and the translate dialog load documents with `useContentDocuments`.
- AI translation: `POST /translate/:event_id` (job, saves) and `POST /translate/:event_id/texts` (synchronous, returns texts without saving, used by the builder).

Readiness ("can this be sent?"): checks written for legacy content look at `<owner>.content`. `withDocumentBodies(rows, documents)` gives every owner with a document a summarized `.content` row per language (empty when that language shows nothing), so the same checks understand blocks. Node uses it through `withMessageDocumentBodies` / `communicationEventTexts`; admin through `withContentDocumentBodies` and `untranslatedLanguages`.

## Admin builder structure (`src/features/block-builder/`)

| Path                  | What                                                                                                                                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `builder-context.tsx` | `useBuilderController`: document/text operations, selection, language, history, `surface`. `BuilderProvider` / `useBuilder`.                                                                                                                                    |
| `canvas/`             | The editable canvas (`BuilderCanvas`, `block-views.tsx`). Surface-aware (e.g. Ticket is a QR on email, a button in the app).                                                                                                                                    |
| `inspector/`          | Block panel. Hides email-only options on other surfaces. `root-spacing-fields.tsx` for root padding.                                                                                                                                                            |
| `canvas-theme.ts`     | `CanvasTheme` (incl. `cardWidth`, `cardGutter`): `createCanvasTheme` (email theme) and `createAppCanvasTheme(event_styles)`; `blockViewTheme(theme)` turns it into a `BlockViewTheme` so preview and canvas match.                                              |
| `builder-chrome.tsx`  | Shared toolbar parts: languages, Edit/Preview, language select, translating notice, translate button, copy/paste JSON.                                                                                                                                          |
| `content/`            | Surface-neutral content state: `content-value.ts` (`ContentValue`, `createContentValue`, `buildContentSave`, readiness helpers), `use-content-draft.ts`, `use-content-documents.ts`, `content-document-api.ts` (`saveContentDocument`), `content-clipboard.ts`. |
| `email/`              | `EmailBuilder`: mail header (From, Reply-to, Subject, Preview text), email theme/Style panel, footer, Custom HTML mode, server preview.                                                                                                                         |
| `app/`                | `AppContentBuilder` for `in_app` and `page`: same canvas, inspector, undo, languages, translation; look from the event's styles; preview renders `AppContentView` (`BlockDocumentView` with tag chips).                                                         |
| `in-app/`             | `InAppBuilder`: `AppContentBuilder` with a Subject header and the app's message screen around the preview.                                                                                                                                                      |
| `page/`               | `PageBuilder`: `AppContentBuilder` with surface `page`, a Menu title header (translated like Subject) and the event's card around the preview. Page theme: `createPageCanvasTheme`. Page block panels: `inspector/page-block-fields.tsx`, canvas: `canvas/page-block-views.tsx`. |

Hosts own loading and saving: `useContentDraft({ ownerKey, surface, eventTexts, storedDocument, ready })` → builder (`value`, `setValue`, `resetKey`) → on save `saveContentDocument(eventId, buildContentSave(draft.saved, value, ownerKey))`, then `markSaved` and revalidate documents and event texts. See `draft-editor-tab.tsx`, `sent-in-app-design.tsx` and `website-build-page.tsx` (pages).

Code conventions that apply here: React 19 with the React Compiler (no `useMemo`/`useCallback`/`memo`), no non-null assertions, no lint disables.

## Event pages

A page (`event_page` row) is designed with blocks under owner key `page.<id>`, surface `page`. The whole content card is the document: the Banner and the Countdown are blocks too. Page settings that are not content stay on `event_page` and the overview page: slug, icon, visibility (`is_public`, `is_hidden`, …), audiences (`allowed_segments`), order, home shortcuts, and custom CSS/JS (the builder's "Custom code" dialog).

Texts of a page: `page.<id>.menu_text` (the menu title, edited in the builder header and translated like a message's Subject) and the block texts `page.<id>.block.<blockId>.<field>`.

### Pages from before blocks

There is no conversion. A page without a stored document keeps rendering its old fields (`page.<id>.html_content`, `banner_*`, `countdown_heading`, the `banner_*` / `is_countdown_visible` columns) on the public site and in the app. Opening it in the builder starts from a new document (a heading and a text block); the first save makes it a block page, and the old fields are ignored from then on. The builder says so above the canvas.

### Flow

- **Admin** (`website-build-page.tsx`): `PageBuilder`, drafts with `useContentDraft({ surface: 'page' })`, save with `saveContentDocument`. `useContentDocuments` includes page documents. Tags offered follow the page: `public_event_page` for public pages, `guest_webapp_page` for pages that require login.
- **Node**: the save handler accepts `page.<id>` owners (the page must belong to the event). Endpoints:
  - `GET /event/:slug` and `GET /get-app-pages-for-event/:event_id`: each page has `has_blocks`.
  - `GET /event/:slug/pages/:page_id/content?lang=` (anon key only; public, not hidden pages of that event): `resolveGuestContent` without a guest. Cached per page and language (`features/event-pages/page-content-cache.ts`).
  - `GET /app-pages/:page_id/content?lang=` (`user_token`; not hidden, and for the guest's audience, `pagesForGuest` in `features/event-pages/page-access.ts`): `resolveGuestContent` with the guest.
  - Countdown blocks get `context.eventStartsAt`; Ticket blocks get `context.ticketUrl` only with a guest (null for visitors).
- **Public event site** (`event-page-renderer.tsx`): `has_blocks` pages render `PageBlocksContent` → `PageBlocksView` instead of the old banner, countdown and HTML. Registration buttons (RSVP block) open the registration flow on the register page, and elsewhere send the visitor there with `?intent=`. Labels: the block's own, else the event's registration button texts. The admin's `/event-preview` route renders the stored document (`blocksSource="preview"`), tags as labels.
- **Guest app** (`EventPageRenderer`): `has_blocks` pages fetch `/app-pages/:id/content` (SWR) and render `ContentBlocks` with `variant="page"`. Program blocks use the app's timeline; RSVP blocks are hidden (guests are registered). Home shortcuts sit after an opening Banner.
- **Translations**: as for messages. The builder has the language select, Translate button, and the original next to each field; the menu title counts as a header field (`untranslatedLanguages(..., [menu key])`). `buildOwnerTexts` lists a block page's menu title and block texts (no links); the Translations page has one card per page. The AI translate endpoints work on any keys.

### Host blocks

Program and RSVP need app data or state, so hosts draw them through `renderBlock`: admin `PageBlocksView` (`features/page-building/components/page-blocks-view.tsx`) for the builder preview, `/event-preview` and the public site; guest app `EventPageRenderer`. Without a host they render nothing.

### Things to keep

- One renderer (`BlockDocumentView`) for the app, admin previews and the public site; hosts supply theme, sanitizer, link handling and the host blocks.
- Tags resolved on the server for the reader (guest or anonymous), never with other guests' data in the client.
- No database change was needed: `event_content_document` stores any owner key; admins read page documents through its RLS, visitors and guests through node.
- Deploy order: node-server first (endpoints and save), then admin, then app releases. App versions without block page support show a block page's old HTML fields (empty for new pages).
- Known gap: the edge worker builds a public page's OG description from the register page's `html_content`, which block pages do not have, so they get the default description.

## Gotchas

- Agents in this workspace never run database changes; schema/RLS/function files go into `eventmii-database` and a human applies them.
- Remember both `package.json` places when repinning `eventmii-shared`.
- `parseBlockDocument` without a surface accepts any surface; pass the expected one when loading for a specific renderer (`loadContentDocument(eventId, ownerKey, surface)`).
- A `url` field can hold a tag. Render it as a link only after the server filled it in; in editors, show it as "filled in for each guest".
- Personal ticket tags expand to QR HTML; remove them (`removePersonalTicketTags`) for push text, previews and anything plain.
- In the app, root `paddingX` defaults to 0 and the host provides a 16px gutter; the admin canvas mirrors this with `cardGutter`. Pages instead read the gutter per block from `--eventmii-block-gutter`, so full-width blocks (the Banner) reach the card edges; the canvas adds `cardGutter` per block on pages.
