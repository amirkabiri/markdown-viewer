# Markdown Viewer

A **split-pane Markdown editor & viewer** for the web: write on one side, read a live preview on the other. 100% client-side, no build step — made for GitHub Pages.

**بازکردن ویرایشگر:** [https://amirkabiri.github.io/markdown-viewer/](https://amirkabiri.github.io/markdown-viewer/)

<!-- The link works once GitHub Pages is enabled (Settings → Pages → branch: main, path: /). -->

## Features

- ✍️ **Split-pane editing** — half textarea, half live preview, with a draggable divider and editor-only / split / preview-only layouts
- 🌍 **Bilingual UI (English / فارسی)** — one click toggles the whole interface, direction included
- 🇮🇷 **First-class Persian & RTL** — the [Vazirmatn](https://github.com/rastikerdar/vazirmatn) font, per-paragraph direction auto-detection, mirrored layout via CSS logical properties, LTR-isolated inline code
- 📊 **Mermaid diagrams** — flowcharts, sequence diagrams, pie charts… written in fenced ```` ```mermaid ```` blocks, in light & dark themes, with Persian labels supported
- 🎨 **Light / dark theme**, remembered across visits
- 🔍 **Syntax highlighting** for code blocks (highlight.js) with copy buttons
- 🧭 **Auto table of contents** with scroll-spy, in a slide-over panel
- 🔗 **Load from anywhere** — open a URL (GitHub `blob` links are converted to raw automatically), upload a file, drag & drop a `.md` anywhere, or paste text
- 🗂 **Recent documents** + links inside documents ending in `.md` navigate inside the viewer
- 🛡 **Safe rendering** — HTML in markdown is sanitized with DOMPurify
- 📱 **Responsive** — panes stack on mobile; print styles output a clean preview-only page

## Usage

### Opening documents

- **URL parameters**
  - `?file=path/to/doc.md` — path relative to the site (e.g. [`?file=samples/sample-fa.md`](https://amirkabiri.github.io/markdown-viewer/?file=samples/sample-fa.md))
  - `?url=<encoded-url>` — any absolute URL that allows CORS (`raw.githubusercontent.com` works)
  - With no parameters, the repo's own `README.md` loads
- **From the app** — press **Open** (or <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>O</kbd>) to load from a URL, a local file, or the clipboard
- **Drag & drop** a `.md` file anywhere on the page

### Writing

| Syntax | Result |
| --- | --- |
| `# … ######` | Headings (they build the TOC) |
| ```` ```mermaid ```` | Rendered diagram |
| ```` ```js ```` | Highlighted code block |
| `- [x] done` | Task list |
| `> quote` | Styled blockquote |

Text direction is **auto-detected per paragraph** — start a paragraph with
Persian and it lays out RTL; start with English and it stays LTR. The
**⇄** button in the top bar forces Auto → LTR → RTL for the whole document.

## Run locally

Requires [Node.js](https://nodejs.org) 20+ and [pnpm](https://pnpm.io):

```bash
git clone https://github.com/amirkabiri/markdown-viewer.git
cd markdown-viewer
pnpm install
pnpm dev        # dev server with HMR
pnpm build      # production build into dist/
pnpm preview    # serve the production build locally
```

## Deploy (GitHub Pages)

GitHub Actions builds and deploys on every push to `main`; the Pages source must be set to **GitHub Actions** (Settings → Pages → Source: GitHub Actions). One-time setup, then open [https://amirkabiri.github.io/markdown-viewer/](https://amirkabiri.github.io/markdown-viewer/).

## Tech stack

| Piece | Choice |
| --- | --- |
| Language | TypeScript (strict) |
| Bundler / dev server | [Vite](https://vite.dev) |
| Markdown parsing | [marked](https://github.com/markedjs/marked) |
| Sanitizing | [DOMPurify](https://github.com/cure53/DOMPurify) |
| Diagrams | [Mermaid](https://mermaid.js.org) |
| Code highlighting | [highlight.js](https://highlightjs.org) |
| Persian font | [Vazirmatn](https://github.com/rastikerdar/vazirmatn) |
| Unit tests | [Vitest](https://vitest.dev) |
| Linting | [ESLint](https://eslint.org) + typescript-eslint |
| E2E tests | Playwright (planned) |
| Package manager | [pnpm](https://pnpm.io) |

The app is CDN-free: marked, DOMPurify, highlight.js and Mermaid are bundled by Vite from lockfile-pinned npm dependencies (Mermaid is code-split and only fetched when a diagram is rendered). Only the Vazirmatn font CSS still loads from jsDelivr.

## فارسی / دربارهٔ پروژه

**نمایشگر مارک‌داون** یک ویرایشگر و نمایشگر مارک‌داون دو بخشی برای وب است؛
سمت چپ می‌نویسید و سمت راست پیش‌نمایش زنده می‌بینید. کاملاً سمت کاربر اجرا
می‌شود و برای میزبانی در GitHub Pages ساخته شده است.

- رابط کاربری دوزبانه (انگلیسی / فارسی) با یک کلیک
- فونت وزیرمتن و تشخیص خودکار جهت هر پاراگراف
- پشتیبانی کامل از نمودارهای **مرمید** (حتی با برچسب فارسی)
- حالت روشن/تاریک، هایلایت کد، فهرست مطالب خودکار و سندهای اخیر
- باز کردن سند از نشانی، بارگذاری فایل، کشیدن و رها کردن، یا چسباندن متن

برای استفاده: فایل را روی صفحه رها کنید، یا از پارامتر `?file=` /
`?url=` در نشانی استفاده کنید.

## Security

- Markdown is rendered entirely client-side and sanitized with [DOMPurify](https://github.com/cure53/DOMPurify) before it is injected into the page.
- Mermaid diagrams run with `securityLevel: 'strict'`.
- All CDN dependencies are version-pinned and protected with Subresource Integrity (`integrity` + `crossorigin` attributes).
- A Content-Security-Policy restricts script and style sources to `'self'` and the two CDNs (jsDelivr / cdnjs).
- Documents loaded via `?url=` are fetched by your own browser, directly from the source host and without credentials — cross-origin reads require the host to allow CORS.
- No server, no accounts, no telemetry: nothing you type or load ever leaves your browser.

## License

[MIT](LICENSE) © Amir Kabiri
