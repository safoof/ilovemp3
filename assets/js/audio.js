// Decoding, editing and encoding helpers built on the Web Audio API.
// Everything here runs locally in the browser.

export const SAMPLE_RATE = 44100;

const STANDARD_BITRATES = [96, 128, 160, 192, 256, 320];
const CHUNK_FRAMES = 1152 * 200; // ~5 seconds per message to the encoder

let decoder = null;
let playbackContext = null;

function createBuffer(numberOfChannels, length, sampleRate = SAMPLE_RATE) {
  return new AudioBuffer({ numberOfChannels, length: Math.max(1, length), sampleRate });
}

/**
 * Decodes an audio or video file into an AudioBuffer at SAMPLE_RATE.
 * Accepts a Blob/File, ArrayBuffer or Uint8Array (which is left intact).
 */
export async function decodeAudio(input, name = input.name) {
  decoder ??= new OfflineAudioContext(2, 1, SAMPLE_RATE);
  let data;
  if (input instanceof Blob) data = await input.arrayBuffer();
  else if (input instanceof Uint8Array) data = input.slice().buffer;
  else data = input.slice(0);
  try {
    return await decoder.decodeAudioData(data);
  } catch {
    throw new Error(`Couldn’t read ${name ? `“${name}”` : 'this file'}. It may be damaged or in a format your browser can’t open.`);
  }
}

/** Reads a media file's duration from its metadata without decoding it. */
export function probeDuration(file) {
  return new Promise((resolve) => {
    const el = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    const finish = (value) => {
      clearTimeout(timer);
      el.onloadedmetadata = el.onerror = null;
      el.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(value) ? value : null);
    };
    const timer = setTimeout(() => finish(null), 15_000);
    el.preload = 'metadata';
    el.onloadedmetadata = () => finish(el.duration);
    el.onerror = () => finish(null);
    el.src = url;
  });
}

// ---------------------------------------------------------------------------
// Editing

export function sliceBuffer(buffer, start, end) {
  const rate = buffer.sampleRate;
  const from = Math.min(buffer.length, Math.max(0, Math.round(start * rate)));
  const to = Math.min(buffer.length, Math.max(from, Math.round(end * rate)));
  const out = createBuffer(buffer.numberOfChannels, to - from, rate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    out.copyToChannel(buffer.getChannelData(ch).subarray(from, to), ch);
  }
  return out;
}

export function concatBuffers(buffers) {
  const rate = buffers[0].sampleRate;
  const channels = Math.max(...buffers.map((b) => b.numberOfChannels));
  const out = createBuffer(channels, buffers.reduce((n, b) => n + b.length, 0), rate);
  let offset = 0;
  for (const b of buffers) {
    for (let ch = 0; ch < channels; ch++) {
      out.getChannelData(ch).set(b.getChannelData(Math.min(ch, b.numberOfChannels - 1)), offset);
    }
    offset += b.length;
  }
  return out;
}

/** Returns a copy of the buffer with the range [start, end) cut out. */
export function removeRange(buffer, start, end) {
  const parts = [];
  if (start > 0) parts.push(sliceBuffer(buffer, 0, start));
  if (end < buffer.duration) parts.push(sliceBuffer(buffer, end, buffer.duration));
  if (parts.length === 2) {
    // A few milliseconds of fade on each side of the cut prevents a click.
    applyFades(parts[0], 0, 0.008);
    applyFades(parts[1], 0.008, 0);
  }
  return parts.length ? concatBuffers(parts) : createBuffer(buffer.numberOfChannels, 0, buffer.sampleRate);
}

const fadeCurve = (t) => (1 - Math.cos(Math.PI * t)) / 2;

/** Applies fades in place. Durations are in seconds and capped at half the clip. */
export function applyFades(buffer, fadeIn, fadeOut) {
  const max = Math.floor(buffer.length / 2);
  const inLength = Math.min(max, Math.round(fadeIn * buffer.sampleRate));
  const outLength = Math.min(max, Math.round(fadeOut * buffer.sampleRate));
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < inLength; i++) data[i] *= fadeCurve(i / inLength);
    for (let i = 0; i < outLength; i++) data[data.length - 1 - i] *= fadeCurve(i / outLength);
  }
  return buffer;
}

/** Resamples and/or up/down-mixes a buffer. Returns the input if nothing changes. */
export async function render(buffer, { sampleRate = buffer.sampleRate, channels = buffer.numberOfChannels } = {}) {
  if (sampleRate === buffer.sampleRate && channels === buffer.numberOfChannels) return buffer;
  const context = new OfflineAudioContext(channels, Math.max(1, Math.ceil(buffer.duration * sampleRate)), sampleRate);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  return context.startRendering();
}

// ---------------------------------------------------------------------------
// Encoding

/** Picks the standard bitrate closest to (but not much below) a file's average bitrate. */
export function suggestBitrate(audioBytes, duration) {
  if (!duration) return 192;
  const kbps = (audioBytes * 8) / duration / 1000;
  return STANDARD_BITRATES.find((rate) => rate >= kbps * 0.95) ?? 320;
}

/**
 * Streams audio into an MP3 encoder running in a worker, so long recordings
 * can be encoded piece by piece without freezing the page.
 */
export class Mp3Writer {
  #worker;
  #pending = null;
  #ready;

  constructor({ kbps = 192, sampleRate = SAMPLE_RATE, channels = 2 } = {}) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.#worker = new Worker(new URL('./mp3-worker.js', import.meta.url));
    this.#worker.onmessage = ({ data }) => this.#settle(data);
    this.#worker.onerror = (e) => {
      e.preventDefault();
      this.#settle({ type: 'error', message: e.message });
    };
    this.#ready = this.#request({ type: 'init', kbps, sampleRate, channels });
  }

  #request(message, transfer = []) {
    return new Promise((resolve, reject) => {
      this.#pending = { resolve, reject };
      this.#worker.postMessage(message, transfer);
    });
  }

  #settle(message) {
    const pending = this.#pending;
    this.#pending = null;
    if (!pending) return;
    if (message.type === 'error') pending.reject(new Error(`MP3 encoding failed: ${message.message || 'unknown error'}`));
    else pending.resolve(message);
  }

  /** Appends a buffer. onProgress receives the fraction of this buffer encoded so far. */
  async write(buffer, onProgress) {
    await this.#ready;
    const audio = await render(buffer, { sampleRate: this.sampleRate, channels: this.channels });
    const sources = Array.from({ length: this.channels }, (_, ch) => audio.getChannelData(ch));
    for (let i = 0; i < audio.length; i += CHUNK_FRAMES) {
      const chunk = sources.map((data) => data.slice(i, i + CHUNK_FRAMES));
      await this.#request({ type: 'encode', channels: chunk }, chunk.map((c) => c.buffer));
      onProgress?.(Math.min(1, (i + CHUNK_FRAMES) / audio.length));
    }
  }

  async writeSilence(seconds) {
    if (seconds > 0) await this.write(createBuffer(this.channels, Math.round(seconds * this.sampleRate), this.sampleRate));
  }

  async finish() {
    await this.#ready;
    const { blob } = await this.#request({ type: 'finish' });
    this.#worker.terminate();
    return blob;
  }

  abort() {
    this.#worker.terminate();
  }
}

export async function encodeMp3(buffer, { kbps = 192, sampleRate = SAMPLE_RATE, mono = false, onProgress } = {}) {
  const channels = mono || buffer.numberOfChannels === 1 ? 1 : 2;
  const writer = new Mp3Writer({ kbps, sampleRate, channels });
  try {
    await writer.write(buffer, onProgress);
    return await writer.finish();
  } catch (err) {
    writer.abort();
    throw err;
  }
}

/** Encodes a buffer as a 16-bit PCM WAV file. */
export function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const blockAlign = channels * 2;
  const dataSize = buffer.length * blockAlign;
  const bytes = new ArrayBuffer(44 + dataSize);
  const view = new DataView(bytes);
  const ascii = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);

  const samples = new Int16Array(bytes, 44);
  const data = Array.from({ length: channels }, (_, ch) => buffer.getChannelData(ch));
  for (let i = 0, o = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < channels; ch++, o++) {
      const s = Math.max(-1, Math.min(1, data[ch][i]));
      samples[o] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

// ---------------------------------------------------------------------------
// Playback

export class Player {
  constructor(buffer) {
    this.buffer = buffer;
    this.source = null;
    this.frame = 0;
  }

  get playing() {
    return this.source !== null;
  }

  async play(from, to, { onTick, onEnd } = {}) {
    this.stop();
    playbackContext ??= new AudioContext();
    await playbackContext.resume();
    const context = playbackContext;
    const source = context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(context.destination);
    source.onended = () => {
      if (this.source !== source) return;
      this.source = null;
      cancelAnimationFrame(this.frame);
      onEnd?.();
    };
    const startedAt = context.currentTime;
    source.start(0, from, Math.max(0, to - from));
    this.source = source;

    const tick = () => {
      if (this.source !== source) return;
      onTick?.(Math.min(to, from + context.currentTime - startedAt));
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  stop() {
    const source = this.source;
    this.source = null;
    cancelAnimationFrame(this.frame);
    if (source) {
      source.onended = null;
      source.stop();
    }
  }
}
