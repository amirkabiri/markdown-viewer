<p align="center"><img src="public/logo.svg" width="96" alt="Qalam logo — a minimal reed-pen nib"></p>

# Qalam

<p align="center"><strong>قلم</strong> — "pen"</p>

Collaborative Markdown editing where humans and AI write together — on-device AI (Gemini Nano) or your own OpenAI/Anthropic-compatible service. Persian/RTL-first, Mermaid diagrams, self-contained share links.

[![CI](https://github.com/amirkabiri/qalam/actions/workflows/ci.yml/badge.svg)](https://github.com/amirkabiri/qalam/actions/workflows/ci.yml) · **[Try it live →](https://amirkabiri.github.io/qalam/)**

## Why Qalam

Writing is collaborative — and Qalam treats the AI as a co-author with real write
access to the document, not a chatbot bolted to the side. The assistant edits the
document itself through tool calls as it works — chat replies stream, but document
edits are tool-executed, so your native undo keeps working — and when you select a
section and type an instruction it rewrites exactly that range. It runs either fully on-device
(Gemini Nano via the browser's Prompt API — private, free, offline-capable) or
against your own OpenAI-/Anthropic-compatible service with your token; tokens
never leave your browser except to the endpoint you configured. There is no
backend and no telemetry — the whole app is static files on GitHub Pages.

## Features

### Editor

- **Split-pane live preview** — write on one side, read on the other, with a draggable divider (double-click resets) and editor-only / split / preview-only modes
- **Scroll sync** between editor and preview
- **Syntax highlighting** (highlight.js) with copy buttons; the code theme swaps with the app theme
- **[Mermaid](https://mermaid.js.org) diagrams** in fenced ```` ```mermaid ```` blocks — light & dark themes, Persian labels supported
- **Light / dark theme** remembered across visits; responsive layout; auto table of contents with scroll-spy; word/char counts

### Documents & persistence

- **Every change autosaved** to IndexedDB (debounced writes plus an unload-safety snapshot) — close the tab, come back tomorrow, everything is still there
- **Multi-document sidebar** — create, rename, remove and reorder documents; the active document is restored on your next visit
- **Multi-tab safe** — each open document holds a per-tab session lock (a second tab reads it read-only and can take over), tabs stay in live sync, and a stolen session never loses your unsaved buffer (it is kept as a copy)
- **Pluggable storage architecture** — IndexedDB today, a File System Access driver planned; recents from the vanilla app migrate automatically on first boot

### AI co-author

- **Three providers** — built-in on-device Gemini Nano (Prompt API), or your own OpenAI-compatible / Anthropic-compatible endpoint
- **Tool-based editing** — the assistant works as an agent: it reads the document and edits it through tool calls; with the direct-edit toggle off it is read-only and suggests text in chat, with it on every edit lands in the editor and preserves your native undo history
- **Selection-aware chat** — select a section, type an instruction, and the agent replaces exactly that range via `edit_document`
- **Text-only rendering** — panel messages are plain text, and anything inserted into the document goes through the same sanitized preview pipeline as your typing

### Persian & RTL

- The [Persian-tuned] **Vazirmatn** font ships for Persian text
- **Per-paragraph direction auto-detection** — start a paragraph with Persian and it lays out RTL; a ⇄ button forces Auto → LTR → RTL for the whole document
- **Mirrored bilingual UI** built on CSS logical properties — one click flips the entire interface EN ⇄ FA, direction included
- **LTR-isolated inline code** so snippets stay readable inside RTL paragraphs
- **Persian digits** in the FA interface (counts and numbers)
- Honest AI-language caveats — see [Writing with the AI](#writing-with-the-ai)

### Share

- **Self-contained `#d=` links** — the whole document rides in the URL fragment, which browsers never send to any server
- **Deflate + base64url** encoding, with a raw base64url fallback where `CompressionStream` is missing
- **Capacity guardrails** — links over 30,000 characters warn, over 300,000 are refused

### Engineering

- **Strict TypeScript** on Vite; ESLint flat config; typecheck, lint, unit tests and build gate every push in CI
- **402 Vitest unit/component tests** (persistence repository + multi-tab sync, legacy migration, documents controller, share codec, stream chunking, provider parsers, settings repair, agent loop, shortcuts layer) and **60 Playwright e2e runs** — 20 tests in 5 specs, including axe-core accessibility scans of every key UI state and cross-tab session/sync specs, across Chromium, Firefox and WebKit — against the production build
- **Content-Security-Policy** with `script-src 'self'` — no third-party scripts, ever
- **No CDN code at runtime** — marked, DOMPurify, highlight.js and Mermaid are lockfile-pinned npm dependencies bundled by Vite (Mermaid is code-split and fetched only when a diagram renders); the only external fetch is the Vazirmatn font CSS

## AI providers

| Provider | Where it runs | You need | Notes |
| --- | --- | --- | --- |
| Built-in (Gemini Nano) | Fully on-device, in your browser | Chrome or Edge on desktop, HTTPS; one-time ~4 GB model download (the panel shows a download button with progress) | Prompt API (`LanguageModel`) — [docs](https://developer.chrome.com/docs/ai/prompt-api); makes no network calls |
| OpenAI-compatible | The endpoint you configure | Base URL + model; token optional | `POST {baseUrl}/chat/completions` with a Bearer token — works with OpenRouter, llama.cpp server, vLLM, … |
| Anthropic-compatible | The endpoint you configure | Base URL + model; token optional | `POST {baseUrl}/v1/messages` with `x-api-key`; sends `anthropic-dangerous-direct-browser-access: true` so direct browser calls pass CORS |

**Configure:** open the assistant panel (sparkle button in the top bar) → expand
**AI service** → pick a provider, fill in Base URL / Model / API token (token is
optional) → **Save**. Settings persist in your browser's localStorage (`mv:ai`).

**Privacy:** tokens live only in your browser's localStorage and are sent nowhere
except the endpoint you configured — nothing is proxied, and there is no
telemetry. The built-in provider is the default: the model runs entirely in your
browser and the app makes zero network calls for it.

## Writing with the AI

1. Open the assistant panel and pick a provider (see [AI providers](#ai-providers)).
2. **Direct edit** — this toggle is the agent's write permission. With it off the
   agent is read-only and suggests text in chat; with it on, its edits land in the
   document and preserve native undo (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd>).
3. **Selection-aware editing** — select text in the editor, type an instruction
   ("make this formal", "turn this into a table"), and the assistant rewrites
   exactly that selection.
4. **Agent tools** — the agent can read the document and edit it itself: insert at
   cursor, replace selection, append, or replace the whole document (whole-document
   replacement asks for confirmation). With direct editing off it proposes the text
   in chat instead.

**Persian note:** Gemini Nano's certified generation languages are English,
Japanese, Spanish, German and French — Persian is not one of them, so on-device
Persian output is unofficial quality. For Persian-heavy work, configure an
external OpenAI-/Anthropic-compatible provider.

## Share links

Press **Share**: the current document is UTF-8 encoded, deflate-compressed,
base64url-encoded into a self-contained link (`…/#d=D.…`) and copied straight
to your clipboard. Because fragments are never sent to servers, the document
never leaves the URL bar — opening the link anywhere is completely private.
Decoding tolerates the full URL, the bare `d=…` payload, or a raw payload; the
URL is never rewritten while you edit, so the link survives a refresh and stays
re-shareable. Compression keeps typical documents to a few hundred URL
characters; over 30,000 characters you get a warning, and over 300,000 the
link is refused.

## Opening documents

| Method | Details |
| --- | --- |
| Drag & drop | Drop a `.md` file anywhere on the page |
| Open dialog | **Open** button or <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Alt</kbd>+<kbd>O</kbd> — from a URL (GitHub `blob` links become raw automatically), a local file, or pasted text |
| `?file=` | Path relative to the site, e.g. [the Persian sample](https://amirkabiri.github.io/qalam/?file=samples/sample-fa.md) |
| `?url=` | Any absolute URL that allows CORS (`raw.githubusercontent.com` works) |
| `#d=` | A self-contained share link — see [Share links](#share-links) |
| Default | With no parameters, this repo's own `README.md` loads |

Everything you open or create is kept — and autosaved — in the sidebar
(rename, reorder, remove). `.md` links inside documents navigate within the
viewer, and input is capped at 10 MB.

## Keyboard shortcuts

Press <kbd>?</kbd> anywhere (outside a text field) for the built-in cheat
sheet — it renders in your interface language. On macOS the shortcuts use
<kbd>⌘</kbd>; elsewhere <kbd>Ctrl</kbd>.

| Action | Keys |
| --- | --- |
| Open a document | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Alt</kbd>+<kbd>O</kbd> |
| New document | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> |
| Copy link to this document | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Alt</kbd>+<kbd>U</kbd> |
| Toggle panel | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>&#92;</kbd> |
| Toggle AI assistant | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Alt</kbd>+<kbd>A</kbd> |
| Editor only | <kbd>Alt</kbd>+<kbd>1</kbd> |
| Split view | <kbd>Alt</kbd>+<kbd>2</kbd> |
| Preview only | <kbd>Alt</kbd>+<kbd>3</kbd> |
| Text direction (Auto / LTR / RTL) | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Alt</kbd>+<kbd>X</kbd> |
| Keyboard shortcuts | <kbd>?</kbd> |
| Close panel or dialog | <kbd>Esc</kbd> |

The map has a single source of truth in the app (`src/app/shortcuts.ts`): the
dispatcher, the cheat sheet and this table all render from it, and a unit
test fails if the docs drift. Every binding is audited against macOS, Windows
and the Chrome, Edge, Firefox and Safari reserved combos
([docs/SHORTCUTS.md](docs/SHORTCUTS.md)) — a unit test fails if any binding
collides.

## Development

### Prerequisites

- Node.js ≥ 22.13 (enforced via `engines`)
- pnpm 11 — `corepack enable` picks up the version pinned in `packageManager`

### Commands

| Command | What it does |
| --- | --- |
| `pnpm install` | Install dependencies |
| `pnpm dev` | Vite dev server with HMR |
| `pnpm build` | Production build into `dist/` |
| `pnpm preview` | Serve the production build locally |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint over the repo |
| `pnpm test` | Vitest unit tests |
| `pnpm test:e2e` | Playwright e2e suite |

### Project structure

Each `src/` module documents what it owns in a header comment:

```text
src/
  main.tsx        # entry: mounts <App /> under the providers
  App.tsx         # shell composition: topbar, workspace, sidebar, dialogs, drag & drop
  app/            # shell concerns: Workspace/Sidebar/Topbar, keyboard shortcuts, theme,
                  # preferences, i18n context, the persistence provider
  features/
    editor/       # editor state + controller (loading documents into the editor,
                  # undo-preserving AI edits)
    preview/      # live preview: marked + DOMPurify + highlight.js + Mermaid,
                  # scroll sync and heading scroll-spy
    documents/    # repository-backed documents: boot/route (?url=/?file=/#d=),
                  # sidebar management (create/rename/remove/reorder), open dialog
    share/        # copy-the-self-contained-link flow
    ai/           # assistant panel: chat surface, settings form, consent and
                  # tool-activity UI
  lib/
    ai/           # provider-agnostic agent core + tool edits, provider adapters
                  # (builtin Prompt API, OpenAI, Anthropic), validated settings
    markdown.ts   # render pipeline: sanitize, highlight, mermaid extraction, TOC
    documents.ts  # URL normalization, fetch, recents (pure halves)
    share.ts      # self-contained #d= share links (base64url + deflate)
    store.ts      # mv:* localStorage store
    persistence/  # document repository: drivers (IndexedDB, in-memory fallback),
                  # multi-tab sync + session locks, one-shot legacy migration
  i18n/           # EN/FA dictionaries and lookup
test/             # shared test fakes + setup
e2e/              # Playwright specs
```

### Testing notes

Unit tests (~400 across Vitest's node and jsdom projects) cover the pure
modules — the share codec, stream chunk normalization, provider delta parsers,
settings repair and the tool-agent loop (protocol parsing, execution
cap/termination, executor gating) — plus the persistence layer over real
fakes: the autosave pipeline, two repositories sharing one fake-indexeddb
database (edit-in-A-appears-in-B, lock steals, monotonic revisions), the
one-shot legacy migration and its duplicate self-heal. The Playwright suite
(20 tests × 3 engines, 60 runs) executes against a production build
(`vite build` + `vite preview`) across Chromium, Firefox and WebKit,
including axe-core scans of every key UI state and cross-tab session/sync
specs. CI runs typecheck, lint, unit tests and build on every push and PR,
plus the e2e job on `main`.

## Deployment

Pushes to `main` are built and deployed to GitHub Pages by Actions. One-time
setup: **Settings → Pages → Source: GitHub Actions**. The site lives at
[https://amirkabiri.github.io/qalam/](https://amirkabiri.github.io/qalam/).

## Security

- Markdown is rendered entirely client-side and sanitized with DOMPurify before
  injection; Mermaid runs with `securityLevel: 'strict'`.
- AI panel messages are plain text — nothing is parsed as HTML — and text the AI
  inserts into the editor flows through the same sanitized preview pipeline.
- Document content is treated as a prompt-injection surface: the AI system prompt
  instructs the model to ignore embedded instructions and follow only the user's
  request.
- Provider tokens are client-side only (localStorage `mv:ai`) and are sent
  nowhere except the endpoint you configured.
- Documents loaded via `?url=` are fetched by your own browser, directly from the
  source host and without credentials — cross-origin reads require CORS.
- No server, no accounts, no telemetry: nothing you type or load ever leaves your
  browser (except to the AI endpoint you explicitly configured).

## فارسی

**قلم** یک ویرایشگر مارک‌داون دوپنجره‌ای برای وب است: یک سمت می‌نویسید و سمت
دیگر پیش‌نمایش زنده می‌بینید — و هوش مصنوعی هم به‌عنوان هم‌نویس در کنار شماست.

- دستیار هوشمند خودش سند را می‌خواند و ویرایش می‌کند: تغییرها با ابزار روی سند
  اعمال می‌شوند — درج در محل نشانگر، بازنویسی بخش انتخاب‌شده، افزودن به انتها یا
  جایگزینی کل سند؛ اگر «ویرایش مستقیم» خاموش باشد، دستیار فقط سند را می‌خواند و
  پیشنهادش را در گفتگو می‌نویسد؛ بخشی را انتخاب کنید، دستور بدهید و همان بازه
  بازنویسی می‌شود.
- هوش مصنوعی یا کاملاً روی دستگاه شما اجرا می‌شود (Gemini Nano در کروم/اج
  دسکتاپ، بدون هیچ درخواست شبکه‌ای) یا به سرویس سازگار با OpenAI/Anthropic
  خودتان وصل می‌شود؛ توکن شما فقط در مرورگر خودتان می‌ماند.
- فارسی‌محور: فونت وزیرمتن، تشخیص خودکار جهت هر پاراگراف، رابط آینه‌ای دوزبانه
  و اعداد فارسی.
- نمودارهای مرمید، هایلایت کد، فهرست مطالب خودکار و حالت روشن/تاریک.
- هم‌رسانی خودکفا با پیوند `#d=`: کل سند در fragment نشانی فشرده می‌شود و هرگز
  برای سروری فرستاده نمی‌شود.
- چندسند و ماندگار: هر تغییری خودکار در IndexedDB مرورگر ذخیره می‌شود (معماری
  ذخیره‌سازی با درایور قابل تعویض — پشتیبانی File System Access در نقشهٔ راه)؛
  سندها در نوار کناری ساخته، تغییرنام، حذف و جابه‌جا می‌شوند و کار هم‌زمان در
  چند زبانه با قفل نشست و هم‌گام‌سازی زنده بی‌خطر است.
- تولید فارسی با Gemini Nano غیررسمی است؛ برای کارهای فارسی‌محور، سرویس بیرونی
  گزینهٔ بهتری است. ([امتحان کنید](https://amirkabiri.github.io/qalam/))
- بدون سرور، بدون حساب کاربری، بدون تلمتری.

### میان‌برهای صفحه‌کلید

کلید <kbd>?</kbd> را بزنید (بیرون از فیلدهای متنی) تا فهرست میان‌برها را به
زبان رابط ببینید. در مک میان‌برها با <kbd>⌘</kbd> و در بقیهٔ سیستم‌ها با
<kbd>Ctrl</kbd> کار می‌کنند.

| کنش | کلیدها |
| --- | --- |
| باز کردن سند | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Alt</kbd>+<kbd>O</kbd> |
| سند جدید | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> |
| کپی نشانی این سند | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Alt</kbd>+<kbd>U</kbd> |
| نمایش/بستن پنل | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>&#92;</kbd> |
| نمایش/بستن دستیار هوشمند | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Alt</kbd>+<kbd>A</kbd> |
| فقط ویرایشگر | <kbd>Alt</kbd>+<kbd>1</kbd> |
| نمای دو بخشی | <kbd>Alt</kbd>+<kbd>2</kbd> |
| فقط پیش‌نمایش | <kbd>Alt</kbd>+<kbd>3</kbd> |
| جهت متن (خودکار / چپ‌به‌راست / راست‌به‌چپ) | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Alt</kbd>+<kbd>X</kbd> |
| میان‌برهای صفحه‌کلید | <kbd>?</kbd> |
| بستن پنل یا گفتگو | <kbd>Esc</kbd> |

## Contributing

- Use pnpm (the lockfile is pinned via `packageManager`); run `pnpm typecheck`,
  `pnpm lint` and `pnpm test` before pushing.
- [tasks.md](tasks.md) is the single source of truth for pending work — pick a
  task, and update the board in the same commit that delivers it.
- Every `src/` module declares its ownership in a header comment; keep new code
  within that contract.

## License

[MIT](LICENSE) © Amir Kabiri
