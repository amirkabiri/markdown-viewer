// Module: features/documents/welcome — the embedded fallback document, shown
// when README.md cannot be fetched (file://, offline, bad share payload).
// Ported verbatim from the legacy index.html #welcome-md template.
const WELCOME_MD = `# Markdown Viewer / نمایشگر مارک‌داون

**English.** Write on the left, read on the right. Paste, upload or link any
Markdown file — with full RTL support, syntax highlighting and
[Mermaid](https://mermaid.js.org) diagrams. No build step, no server.

**فارسی.** سمت چپ بنویسید، سمت راست بخوانید. هر فایل مارک‌داونی را وارد کنید —
با پشتیبانی کامل از راست‌به‌چپ، هایلایت کد و نمودارهای **مرمید**، بدون نیاز به
نصب یا سرور.

## Try it / امتحان کنید

- Drag & drop a \`.md\` file anywhere on this page
- یک فایل \`.md\` را در هر جای صفحه رها کنید
- Press **Open** and paste Markdown text
- دکمهٔ **باز کردن** را بزنید و متن مارک‌داون بچسبانید

## Mermaid smoke test

\`\`\`mermaid
flowchart LR
    A["Hello / سلام"] --> B{Works?}
    B -- Yes --> C["✅ All set"]
    B -- No --> D["Check the console"]
\`\`\`
`;

export default WELCOME_MD;
