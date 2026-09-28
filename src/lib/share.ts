// Module: lib/share — self-contained #d= document links (base64url +
// optional deflate-raw). Owner of shareEncode/shareDecode and the capacity
// limits (SHARE_WARN_CHARS / SHARE_MAX_CHARS). Pure compute: no imports, no
// DOM writes, no i18n side effects — the linkWarn/linkTooLarge/sharedDoc
// strings live in src/i18n/dictionaries.ts and the share dialog/clipboard UI
// is the React layer's job. Legacy twin: legacy/src/share.ts.

/* ---------------- capacity limits ---------------- */

/** Share URLs longer than this get a "may not work everywhere" warning. */
export const SHARE_WARN_CHARS = 30000;
/** Share URLs longer than this are refused outright. */
export const SHARE_MAX_CHARS = 300000;

export interface ShareEncodeOk {
  ok: true;
  url: string;
  chars: number;
  compressed: boolean;
  warn: boolean;
}

export interface ShareEncodeTooLarge {
  ok: false;
  reason: 'too-large';
  chars: number;
}

export type ShareEncodeResult = ShareEncodeOk | ShareEncodeTooLarge;

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
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/* ---------------- deflate helpers ---------------- */

/* Push bytes through a web transform stream (deflate/inflate) and collect the
   output. Response.arrayBuffer() rejects when the stream errors, which callers
   turn into a graceful fallback (encode) or null (decode). */
async function streamBytes(
  stream: CompressionStream | DecompressionStream,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

/* ---------------- encode / decode ---------------- */

/** The page URL share links are built on (legacy: location without search/hash). */
function defaultShareBase(): string {
  return window.location.origin + window.location.pathname;
}

/**
 * Encode document text as a self-contained share URL. The payload lives in the
 * fragment (`#d=…`) so it is never sent to any server. Bytes are UTF-8
 * (TextEncoder), deflate-raw compressed when CompressionStream exists
 * (payload prefix `D.`, otherwise raw with `R.`), then base64url.
 * @param text document text
 * @param base page URL the fragment is appended to (defaults to the current page)
 * @returns {ok: true, url, chars, compressed, warn} or {ok: false, reason: 'too-large', chars}
 */
export async function shareEncode(
  text: string,
  base: string = defaultShareBase(),
): Promise<ShareEncodeResult> {
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
  const url = `${base}#d=${payload}`;
  const chars = url.length;
  if (chars > SHARE_MAX_CHARS) return { ok: false, reason: 'too-large', chars };
  return {
    ok: true, url, chars, compressed, warn: chars > SHARE_WARN_CHARS,
  };
}

/**
 * Decode a share payload produced by shareEncode. Accepts a full URL (the
 * fragment is taken), a fragment ('#d=D.abcd'), the bare ('d=D.abcd') or the
 * raw payload ('D.abcd'); both prefixes are supported regardless of
 * CompressionStream availability.
 * @param input full URL, fragment, bare `d=` form, or raw payload
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
    // fatal: reject corrupt data; ignoreBOM: keep a leading BOM
    const opts: TextDecoderOptions = { fatal: true, ignoreBOM: true };
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
