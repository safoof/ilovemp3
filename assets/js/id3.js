// Reads ID3v1/ID3v2.2–2.4 tags and writes ID3v2.3 tags, which nearly every
// player understands.

export const GENRES = [
  'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal',
  'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial',
  'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk',
  'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise',
  'Alternative Rock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic',
  'Darkwave', 'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta',
  'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave', 'Psychedelic', 'Rave', 'Showtunes',
  'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock',
];

const TEXT_FRAMES = [
  ['title', 'TIT2'],
  ['artist', 'TPE1'],
  ['album', 'TALB'],
  ['albumArtist', 'TPE2'],
  ['year', 'TYER'],
  ['track', 'TRCK'],
  ['genre', 'TCON'],
];

const V22_IDS = { TT2: 'TIT2', TP1: 'TPE1', TP2: 'TPE2', TAL: 'TALB', TYE: 'TYER', TRK: 'TRCK', TCO: 'TCON', COM: 'COMM', PIC: 'APIC' };

// Frames that are rebuilt from the edited fields, depend on the audio length,
// or only exist in ID3v2.4, so they are not copied into the new tag.
const DROPPED_FRAMES = new Set([
  'TLEN', 'TDRL', 'TDOR', 'TDEN', 'TDTG', 'TIPL', 'TMCL', 'TMOO', 'TPRO', 'TSST', 'ASPI', 'SEEK', 'EQU2', 'RVA2', 'SIGN',
]);

const decoders = {
  latin1: new TextDecoder('iso-8859-1'),
  utf8: new TextDecoder('utf-8'),
  utf16le: new TextDecoder('utf-16le'),
  utf16be: new TextDecoder('utf-16be'),
};

export function emptyTags() {
  return { title: '', artist: '', album: '', albumArtist: '', year: '', track: '', genre: '', comment: '', picture: null, extras: [] };
}

// ---------------------------------------------------------------------------
// Reading

const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const uint32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

function removeUnsync(bytes) {
  const out = new Uint8Array(bytes.length);
  let j = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[j++] = bytes[i];
    if (bytes[i] === 0xff && bytes[i + 1] === 0x00) i++;
  }
  return out.subarray(0, j);
}

function decodeText(encoding, bytes) {
  let text;
  if (encoding === 1) {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) text = decoders.utf16be.decode(bytes.subarray(2));
    else if (bytes[0] === 0xff && bytes[1] === 0xfe) text = decoders.utf16le.decode(bytes.subarray(2));
    else text = decoders.utf16le.decode(bytes);
  } else if (encoding === 2) text = decoders.utf16be.decode(bytes);
  else if (encoding === 3) text = decoders.utf8.decode(bytes);
  else text = decoders.latin1.decode(bytes);
  // ID3v2.4 separates multiple values with null characters.
  return text.replace(/﻿/g, '').split('\0').filter(Boolean).join('; ').trim();
}

/** Returns [end of string, start of next field] for a null-terminated string. */
function terminated(encoding, bytes, start) {
  if (encoding === 1 || encoding === 2) {
    for (let i = start; i + 1 < bytes.length; i += 2) if (bytes[i] === 0 && bytes[i + 1] === 0) return [i, i + 2];
  } else {
    const i = bytes.indexOf(0, start);
    if (i >= 0) return [i, i + 1];
  }
  return [bytes.length, bytes.length];
}

function parseGenre(text) {
  const match = /^\((\d+)\)(.*)$/.exec(text);
  if (match) return match[2] || GENRES[+match[1]] || text;
  if (/^\d+$/.test(text)) return GENRES[+text] ?? text;
  return text;
}

/**
 * ID3v2.4 frames may use UTF-8, which ID3v2.3 lacks, so re-encode them as
 * UTF-16. Returns null for UTF-8 frames we don't know how to convert.
 */
function toV23Frame(id, data) {
  if (data[0] !== 3) return data;
  const utf16 = (bytes) => encodeString(decoders.utf8.decode(bytes), true).bytes;
  if (id === 'TXXX' || id === 'WXXX') {
    const [descEnd, valueStart] = terminated(3, data, 1);
    const value = data.subarray(valueStart);
    return concat([[1], utf16(data.subarray(1, descEnd)), [0, 0], id === 'TXXX' ? utf16(value) : value]);
  }
  if (id === 'COMM' || id === 'USLT') {
    const [descEnd, textStart] = terminated(3, data, 4);
    return concat([[1], data.subarray(1, 4), utf16(data.subarray(4, descEnd)), [0, 0], utf16(data.subarray(textStart))]);
  }
  if (id[0] === 'T') return concat([[1], encodeString(decodeText(3, data.subarray(1)), true).bytes]);
  return null;
}

function readFrame(id, data, tags, version) {
  const text = () => decodeText(data[0], data.subarray(1));
  const setOnce = (key, value) => {
    if (!tags[key] && value) tags[key] = value;
  };

  switch (id) {
    case 'TIT2': return setOnce('title', text());
    case 'TPE1': return setOnce('artist', text());
    case 'TALB': return setOnce('album', text());
    case 'TPE2': return setOnce('albumArtist', text());
    case 'TRCK': return setOnce('track', text());
    case 'TCON': return setOnce('genre', parseGenre(text()));
    case 'TYER':
    case 'TDRC':
      return setOnce('year', text().slice(0, 4));
    case 'COMM': {
      const encoding = data[0];
      const [descEnd, textStart] = terminated(encoding, data, 4);
      const description = decodeText(encoding, data.subarray(4, descEnd));
      if (!description) return setOnce('comment', decodeText(encoding, data.subarray(textStart)));
      break; // keep comments with a description, e.g. iTunNORM
    }
    case 'APIC': {
      if (tags.picture) return;
      const encoding = data[0];
      let mime, typeAt;
      if (version === 2) {
        mime = decoders.latin1.decode(data.subarray(1, 4)).toUpperCase() === 'PNG' ? 'image/png' : 'image/jpeg';
        typeAt = 4;
      } else {
        const mimeEnd = data.indexOf(0, 1);
        mime = decoders.latin1.decode(data.subarray(1, mimeEnd)).toLowerCase() || 'image/jpeg';
        if (!mime.includes('/')) mime = `image/${mime === 'jpg' ? 'jpeg' : mime}`;
        typeAt = mimeEnd + 1;
      }
      const [, imageStart] = terminated(encoding, data, typeAt + 1);
      tags.picture = { mime, data: data.slice(imageStart) };
      return;
    }
  }

  if (version >= 3 && !DROPPED_FRAMES.has(id) && !TEXT_FRAMES.some(([, frameId]) => frameId === id)) {
    const converted = version === 4 ? toV23Frame(id, data) : data;
    if (converted) tags.extras.push({ id, data: converted.slice() });
  }
}

function readId3v2(bytes, tags) {
  const version = bytes[3];
  const flags = bytes[5];
  const size = syncsafe(bytes, 6);
  const total = 10 + size + (flags & 0x10 ? 10 : 0);
  if (version < 2 || version > 4) return total;

  let body = bytes.subarray(10, Math.min(bytes.length, 10 + size));
  if (version < 4 && flags & 0x80) body = removeUnsync(body);

  let pos = 0;
  if (flags & 0x40) pos = version === 3 ? 4 + uint32(body, 0) : version === 4 ? syncsafe(body, 0) : 0;

  const idLength = version === 2 ? 3 : 4;
  const headerLength = version === 2 ? 6 : 10;

  while (pos + headerLength <= body.length) {
    const rawId = String.fromCharCode(...body.subarray(pos, pos + idLength));
    if (!/^[A-Z0-9]+$/.test(rawId)) break; // reached padding
    let frameSize;
    if (version === 2) frameSize = (body[pos + 3] << 16) | (body[pos + 4] << 8) | body[pos + 5];
    else if (version === 4) frameSize = syncsafe(body, pos + 4);
    else frameSize = uint32(body, pos + 4);
    const frameFlags = version === 2 ? 0 : (body[pos + 8] << 8) | body[pos + 9];
    pos += headerLength;
    if (frameSize <= 0 || pos + frameSize > body.length) break;
    let data = body.subarray(pos, pos + frameSize);
    pos += frameSize;

    if (version === 4) {
      if (frameFlags & 0x000c) continue; // compressed or encrypted
      if (frameFlags & 0x0040) data = data.subarray(1); // group id
      if (frameFlags & 0x0001) data = data.subarray(4); // data length indicator
      if (frameFlags & 0x0002) data = removeUnsync(data);
    } else if (version === 3) {
      if (frameFlags & 0x00c0) continue;
      if (frameFlags & 0x0020) data = data.subarray(1);
    }
    if (data.length) readFrame(version === 2 ? V22_IDS[rawId] ?? rawId : rawId, data, tags, version);
  }
  return total;
}

function readId3v1(bytes, tags) {
  const field = (from, to) => decoders.latin1.decode(bytes.subarray(from, to)).replace(/\0.*$/s, '').trim();
  const fill = (key, value) => {
    if (!tags[key] && value) tags[key] = value;
  };
  fill('title', field(3, 33));
  fill('artist', field(33, 63));
  fill('album', field(63, 93));
  fill('year', field(93, 97));
  if (bytes[125] === 0 && bytes[126] !== 0) {
    fill('comment', field(97, 125));
    fill('track', String(bytes[126]));
  } else {
    fill('comment', field(97, 127));
  }
  fill('genre', GENRES[bytes[127]]);
}

/**
 * Parses the tags of an MP3 file.
 * Returns { tags, audioStart, audioEnd }, where the audio range excludes all tags.
 */
export function readTags(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const tags = emptyTags();
  let audioStart = 0;
  let audioEnd = bytes.length;

  while (audioStart + 10 <= bytes.length && bytes[audioStart] === 0x49 && bytes[audioStart + 1] === 0x44 && bytes[audioStart + 2] === 0x33) {
    audioStart += readId3v2(bytes.subarray(audioStart), tags);
  }
  audioStart = Math.min(audioStart, bytes.length);

  if (audioEnd - audioStart >= 128) {
    const v1 = bytes.subarray(audioEnd - 128);
    if (v1[0] === 0x54 && v1[1] === 0x41 && v1[2] === 0x47) {
      readId3v1(v1, tags);
      audioEnd -= 128;
    }
  }
  return { tags, audioStart, audioEnd };
}

/** True if MPEG Layer III frame sync appears near the start of the audio. */
export function looksLikeMp3(bytes, start = 0) {
  const end = Math.min(bytes.length - 1, start + 64 * 1024);
  for (let i = start; i < end; i++) {
    if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0 && ((bytes[i + 1] >> 1) & 3) === 1) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Writing

function concat(chunks) {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const latin1Bytes = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0));

/** Encodes as ISO-8859-1 when possible, otherwise UTF-16 with a BOM. */
function encodeString(text, forceUnicode = false) {
  if (!forceUnicode && /^[\x00-\xff]*$/.test(text)) return { encoding: 0, bytes: latin1Bytes(text), terminator: [0] };
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes[2 + i * 2] = code & 0xff;
    bytes[3 + i * 2] = code >> 8;
  }
  return { encoding: 1, bytes, terminator: [0, 0] };
}

function frame(id, chunks) {
  const body = concat(chunks);
  const header = new Uint8Array(10);
  header.set(latin1Bytes(id));
  new DataView(header.buffer).setUint32(4, body.length);
  return concat([header, body]);
}

/** Builds an ID3v2.3 tag. Returns an empty array if there is nothing to write. */
export function buildTag(tags) {
  const frames = [];

  for (const [key, id] of TEXT_FRAMES) {
    let value = tags[key]?.trim();
    if (!value) continue;
    if (key === 'year' && /^\d{4}/.test(value)) value = value.slice(0, 4);
    const { encoding, bytes } = encodeString(value);
    frames.push(frame(id, [[encoding], bytes]));
  }

  const comment = tags.comment?.trim();
  if (comment) {
    const { encoding, bytes } = encodeString(comment);
    const emptyDescription = encoding === 1 ? [0xff, 0xfe, 0, 0] : [0];
    frames.push(frame('COMM', [[encoding], latin1Bytes('eng'), emptyDescription, bytes]));
  }

  if (tags.picture) {
    // encoding, MIME type, picture type 3 (front cover), empty description, data
    frames.push(frame('APIC', [[0], latin1Bytes(tags.picture.mime), [0, 3, 0], tags.picture.data]));
  }

  for (const { id, data } of tags.extras ?? []) frames.push(frame(id, [data]));

  if (!frames.length) return new Uint8Array(0);
  const body = concat(frames);
  const size = body.length;
  const header = Uint8Array.of(0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f);
  return concat([header, body]);
}

/** Prepends an ID3v2.3 tag to untagged MP3 audio. */
export function withTags(audio, tags) {
  return new Blob([buildTag(tags), audio], { type: 'audio/mpeg' });
}
