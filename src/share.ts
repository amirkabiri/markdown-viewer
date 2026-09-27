// Module: share — self-contained #d= document links (base64url + optional deflate). Owner of shareEncode/shareDecode and capacity limits.
import { registerI18n } from './i18n.js';

registerI18n({
  shareTitle: { en: 'Share document', fa: 'هم‌رسانی سند' },
  copyContentLink: { en: 'Copy content link', fa: 'کپی نشانیِ محتوا' },
  copySourceLink: { en: 'Copy source link', fa: 'کپی نشانیِ منبع' },
  linkWarn: { en: 'Long link (over 30,000 chars) — may not work everywhere', fa: 'نشانی بسیار بلند است (بیش از ۳۰٬۰۰۰ نویسه) — ممکن است همه‌جا کار نکند' },
  linkTooLarge: { en: 'Document too large for a share link (over 300,000 chars)', fa: 'سند برای هم‌رسانی با نشانی بیش از حد بزرگ است (بیش از ۳۰۰٬۰۰۰ نویسه)' },
  sharedDoc: { en: 'Shared document', fa: 'سند هم‌رسانی‌شده' },
});

/* ---------------- capacity limits ---------------- */

/** Share URLs longer than this get a "may not work everywhere" warning. */
export const SHARE_WARN_CHARS = 30000;
/** Share URLs longer than this are refused outright. */
export const SHARE_MAX_CHARS = 300000;

export type ShareEncodeResult =
  | { ok: true; url: string; chars: number; compressed: boolean; warn: boolean }
  | { ok: false; reason: 'too-large'; chars: number };

export interface ShareDecodeResult {
  text: string;
  compressed: boolean;
}

/* ---------------- base64url ---------------- */

/* Binary strings are built in ~32K-char chunks — one Function.apply over a
   whole (potentially multi-hundred-KB) byte array would overflow the stack. */
const B64_CHUNK = 0x8000;

/** bytes → base64url (URL-safe alphabet, padding stripped). */
function bytesToBase64Url(bytes: Uint8Array<ArrayBuffer>): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + B64_CHUNK) as unknown as number[]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url → bytes; tolerates stripped padding, throws on invalid input. */
function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  if (b64.length % 4) b64 += '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/* ---------------- deflate helpers ---------------- */

/* Push bytes through a web transform stream (deflate/inflate) and collect the
   output. Response.arrayBuffer() rejects when the stream errors, which callers
   turn into a graceful fallback (encode) or null (decode). */
async function streamBytes(stream: CompressionStream | DecompressionStream, bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

/* ---------------- encode / decode ---------------- */

/**
 * Encode document text as a self-contained share URL. The payload lives in the
 * fragment (`#d=…`) so it is never sent to any server. Bytes are UTF-8
 * (TextEncoder), deflate-raw compressed when CompressionStream exists
 * (payload prefix `D.`, otherwise raw with `R.`), then base64url.
 * @param text document text
 * @returns {ok: true, url, chars, compressed, warn} or {ok: false, reason: 'too-large', chars}
 */
export async function shareEncode(text: string): Promise<ShareEncodeResult> {
  const bytes = new TextEncoder().encode(text);
  let payloadBytes: Uint8Array<ArrayBuffer> = bytes;
  let compressed = false;
  if (typeof CompressionStream !== 'undefined') {
    try {
      payloadBytes = await streamBytes(new CompressionStream('deflate-raw'), bytes);
      compressed = true;
    } catch {
      payloadBytes = bytes; // fall back to raw bytes if compression fails
      compressed = false;
    }
  }
  const payload = (compressed ? 'D.' : 'R.') + bytesToBase64Url(payloadBytes);
  const url = location.origin + location.pathname + '#d=' + payload;
  const chars = url.length;
  if (chars > SHARE_MAX_CHARS) return { ok: false, reason: 'too-large', chars };
  return { ok: true, url, chars, compressed, warn: chars > SHARE_WARN_CHARS };
}

/**
 * Decode a share payload produced by shareEncode. Accepts a full fragment
 * ('#d=D.abcd'), bare ('d=D.abcd') or raw payload ('D.abcd'); both prefixes
 * are supported regardless of CompressionStream availability.
 * @param input fragment, bare `d=` form, or raw payload
 * @returns {text, compressed} or null for malformed/unknown input; never throws
 */
export async function shareDecode(input: unknown): Promise<ShareDecodeResult | null> {
  try {
    if (typeof input !== 'string') return null;
    let payload = input.trim();
    const hashAt = payload.indexOf('#'); // tolerate full URLs — take the fragment
    if (hashAt !== -1) payload = payload.slice(hashAt);
    if (payload.startsWith('#')) payload = payload.slice(1);
    if (payload.startsWith('d=')) payload = payload.slice(2);
    const prefix = payload.slice(0, 2);
    const body = payload.slice(2);
    if ((prefix !== 'D.' && prefix !== 'R.') || (!body && prefix !== 'R.')) return null;
    const opts: TextDecoderOptions = { fatal: true, ignoreBOM: true }; // reject corrupt data, keep a leading BOM
    if (prefix === 'D.') {
      if (typeof DecompressionStream === 'undefined') return null;
      const text = new TextDecoder('utf-8', opts)
        .decode(await streamBytes(new DecompressionStream('deflate-raw'), base64UrlToBytes(body)));
      return { text, compressed: true };
    }
    return { text: new TextDecoder('utf-8', opts).decode(base64UrlToBytes(body)), compressed: false };
  } catch {
    return null;
  }
}
