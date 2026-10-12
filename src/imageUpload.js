// src/imageUpload.js — uploads a profile picture to freeimage.host and returns its URL.
//
// ENV (Render → Environment) — all optional:
//   FREEIMAGE_API_KEY   your own key from freeimage.host (default: the host's public demo key)
//   FREEIMAGE_ENDPOINT  defaults to https://freeimage.host/api/1/upload
//
// The key stays on the server; the browser only ever sees the final image URL.

const DEFAULT_ENDPOINT = 'https://freeimage.host/api/1/upload';
const PUBLIC_KEY = '6d207e02198a847aa98d0a2a901485a5';
const MAX_BASE64_CHARS = 700_000; // ~512 KB — the browser sends a small cropped square, far below this

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Accepts a data URL or raw base64; returns raw base64 after checking it really is PNG/JPEG/WebP. */
function normalizeImage(input) {
  const raw = String(input || '').trim();
  if (!raw) throw httpError(400, 'No image received.');

  const m = raw.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  const b64 = (m ? m[2] : raw).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(b64)) throw httpError(400, 'Image data is not valid base64.');
  if (b64.length > MAX_BASE64_CHARS) throw httpError(413, 'Image is too large. Pick a smaller size.');

  // Don't trust the declared type — check the file's magic bytes.
  const head = Buffer.from(b64.slice(0, 24), 'base64');
  const isPng = head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isJpg = head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isWebp = head.length >= 12 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP';
  if (!isPng && !isJpg && !isWebp) throw httpError(400, 'Only PNG, JPG or WebP images are allowed.');
  return b64;
}

export async function uploadAvatar(imageInput, uid) {
  const key = process.env.FREEIMAGE_API_KEY || PUBLIC_KEY;
  const endpoint = process.env.FREEIMAGE_ENDPOINT || DEFAULT_ENDPOINT;
  const image = normalizeImage(imageInput);

  const body = new URLSearchParams();
  body.set('key', key);
  body.set('action', 'upload');
  body.set('source', image);   // base64
  body.set('format', 'json');

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (e) {
    throw httpError(504, e?.name === 'TimeoutError' ? 'Image host timed out. Please try again.' : 'Could not reach the image host. Please try again.');
  }

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }

  const ok = res.ok && json && (json.status_code === undefined || json.status_code === 200);
  if (!ok) {
    const reason = json?.error?.message || json?.status_txt || `HTTP ${res.status}`;
    console.error('[image-upload] failed for', String(uid).slice(0, 8), '→', res.status, String(reason).slice(0, 200));
    throw httpError(502, 'Image upload failed. Please try a different image or try again later.');
  }

  const url = json?.image?.display_url || json?.image?.url;
  if (!url || !/^https:\/\//i.test(url)) {
    console.error('[image-upload] no usable URL in response:', text.slice(0, 200));
    throw httpError(502, 'Image host returned an unexpected response.');
  }
  return url;
}
