// Hex Cinema ⤓ for streams: saves an OPEN (unencrypted) HLS stream as one real file in Downloads.
// HLS = a playlist (.m3u8) listing many small pieces; this downloads every piece of the best quality with the
// page's own session (logins, referrer) and joins them in order: .ts pieces → one .ts file, fMP4 pieces → one .mp4.
// Encrypted streams (AES keys, DRM) and live streams are refused: Rove doesn't break content protection.
const fs = require('fs');
const path = require('path');

const MAX_PIECES = 20000;
const PARALLEL = 6;

const attr = (line, name) => {
  const m = new RegExp(`(?:^|[,:])${name}=("([^"]*)"|[^,]*)`).exec(line);
  return m ? (m[2] ?? m[1]) : '';
};
const abs = (u, base) => new URL(u, base).href;

async function getText(ses, url, referer) {
  const r = await ses.fetch(url, { headers: referer ? { Referer: referer } : {} });
  if (!r.ok) throw new Error(`The stream answered ${r.status}`);
  return r.text();
}

// Media playlist → { pieces: [{ url, range }], init, ext }
function parseMedia(text, base) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (!lines[0]?.startsWith('#EXTM3U')) throw new Error('Not a stream playlist');
  const pieces = [];
  let init = null, range = null, nextOffset = 0, ended = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('#EXT-X-KEY')) {
      const method = attr(l, 'METHOD');
      if (method && method !== 'NONE') throw new Error('This stream is encrypted — Rove doesn’t break content protection');
    } else if (l.startsWith('#EXT-X-MAP')) {
      init = abs(attr(l, 'URI'), base);
    } else if (l.startsWith('#EXT-X-BYTERANGE')) {
      const [len, off] = l.split(':')[1].split('@').map(Number);
      const from = Number.isFinite(off) ? off : nextOffset;
      range = { from, to: from + len - 1 };
      nextOffset = from + len;
    } else if (l === '#EXT-X-ENDLIST') {
      ended = true;
    } else if (l && !l.startsWith('#')) {
      pieces.push({ url: abs(l, base), range });
      range = null;
    }
  }
  if (!ended) throw new Error('This is a live stream — only finished videos can be saved');
  if (!pieces.length) throw new Error('The stream has no pieces');
  if (pieces.length > MAX_PIECES) throw new Error('The stream is too long to save');
  const ext = init || /\.(m4s|mp4)(\?|$)/i.test(pieces[0].url) ? '.mp4' : '.ts';
  return { pieces, init, ext };
}

// Pick the playlists to save: the best quality of a master playlist (+ its separate audio, if any).
async function choose(ses, candidates, referer) {
  const texts = [];
  for (const url of candidates) {
    try { texts.push({ url, text: await getText(ses, url, referer) }); } catch {}
  }
  if (!texts.length) throw new Error('No stream playlist could be read');
  const master = texts.find((x) => x.text.includes('#EXT-X-STREAM-INF'));
  if (!master) {
    const media = texts.filter((x) => x.text.includes('#EXTINF'));
    if (!media.length) throw new Error('No stream playlist found');
    return { video: media[media.length - 1], audio: null }; // the one the player loaded last = what it plays
  }
  const lines = master.text.split(/\r?\n/).map((l) => l.trim());
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const uri = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
    const bw = Number(attr(lines[i], 'BANDWIDTH')) || 0;
    if (uri && (!best || bw > best.bw)) best = { bw, url: abs(uri, master.url), audio: attr(lines[i], 'AUDIO') };
  }
  if (!best) throw new Error('No stream quality found');
  let audio = null;
  if (best.audio) {
    const media = lines.filter((l) => l.startsWith('#EXT-X-MEDIA') && attr(l, 'TYPE') === 'AUDIO' && attr(l, 'GROUP-ID') === best.audio && attr(l, 'URI'));
    const pick = media.find((l) => attr(l, 'DEFAULT') === 'YES') || media[0];
    if (pick) audio = { url: abs(attr(pick, 'URI'), master.url) };
  }
  const video = { url: best.url, text: await getText(ses, best.url, referer) };
  if (audio) audio.text = await getText(ses, audio.url, referer);
  return { video, audio };
}

async function fetchPiece(ses, p, referer, job) {
  for (let attempt = 0; ; attempt++) {
    if (job.cancelled) throw new Error('cancelled');
    try {
      const headers = referer ? { Referer: referer } : {};
      if (p.range) headers.Range = `bytes=${p.range.from}-${p.range.to}`;
      const r = await ses.fetch(p.url, { headers });
      if (!r.ok) throw new Error(`piece answered ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (err) {
      if (attempt >= 3 || job.cancelled) throw err;
      await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
    }
  }
}

// Download pieces (a few at a time) and write them in order into `file`.
async function writeAll(ses, media, referer, file, job, share) {
  const out = fs.createWriteStream(`${file}.part`);
  const write = (buf) => new Promise((res, rej) => out.write(buf, (e) => (e ? rej(e) : res())));
  try {
    if (media.init) await write(await fetchPiece(ses, { url: media.init }, referer, job));
    const ready = new Map();
    let next = 0, started = 0;
    const worker = async () => {
      while (started < media.pieces.length && !job.cancelled) {
        const k = started++;
        ready.set(k, await fetchPiece(ses, media.pieces[k], referer, job));
        while (ready.has(next)) { const b = ready.get(next); ready.delete(next); await write(b); next++; job.bytes += b.length; share(); }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    if (job.cancelled) throw new Error('cancelled');
    await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
    fs.renameSync(`${file}.part`, file);
  } catch (err) {
    out.destroy();
    fs.rmSync(`${file}.part`, { force: true });
    throw err;
  }
}

// Save the stream. `candidates` = playlist addresses the page loaded. Returns { files }.
async function save({ ses, candidates, referer, title, dir, uniquePath, onProgress }) {
  const job = { cancelled: false, bytes: 0, done: 0, total: 0 };
  const promise = (async () => {
    const { video, audio } = await choose(ses, candidates, referer);
    const v = parseMedia(video.text, video.url);
    const a = audio ? parseMedia(audio.text, audio.url) : null;
    job.total = v.pieces.length + (a ? a.pieces.length : 0);
    const name = String(title || 'video').replace(/[/\\:*?"<>|]+/g, ' ').trim().slice(0, 120) || 'video';
    const files = [uniquePath(dir, `${name}${v.ext}`)];
    let counted = 0;
    const share = () => { job.done = Math.min(job.total, ++counted); onProgress?.(job); };
    await writeAll(ses, v, referer, files[0], job, share);
    if (a) { // separate sound track: saved next to the video (joining them needs a video tool)
      files.push(uniquePath(dir, `${name} (audio)${a.ext === '.ts' ? '.ts' : '.m4a'}`));
      await writeAll(ses, a, referer, files[1], job, share);
    }
    return { files };
  })();
  return { job, promise, cancel: () => { job.cancelled = true; } };
}

module.exports = { save, parseMedia, choose };
