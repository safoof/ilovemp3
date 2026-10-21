// Audio effects and analysis. Everything works on AudioBuffers and returns
// new buffers unless noted otherwise.
import { concatBuffers, render, sliceBuffer, applyFades } from './audio.js';

export const dbToGain = (db) => 10 ** (db / 20);
export const gainToDb = (gain) => 20 * Math.log10(gain);

const channelsOf = (buffer) => Array.from({ length: buffer.numberOfChannels }, (_, ch) => buffer.getChannelData(ch));

export function cloneBuffer(buffer, sampleRate = buffer.sampleRate) {
  const out = new AudioBuffer({ numberOfChannels: buffer.numberOfChannels, length: buffer.length, sampleRate });
  channelsOf(buffer).forEach((data, ch) => out.copyToChannel(data, ch));
  return out;
}

/** Runs a buffer through a Web Audio graph built by connect(context, source) -> last node. */
async function renderGraph(buffer, connect, { length = buffer.length, channels = buffer.numberOfChannels } = {}) {
  const context = new OfflineAudioContext(channels, length, buffer.sampleRate);
  const source = context.createBufferSource();
  source.buffer = buffer;
  connect(context, source).connect(context.destination);
  source.start();
  return context.startRendering();
}

// ---------------------------------------------------------------------------
// Levels

export function peakLevel(buffer) {
  let peak = 0;
  for (const data of channelsOf(buffer)) {
    for (let i = 0; i < data.length; i++) {
      const v = data[i] < 0 ? -data[i] : data[i];
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/** Multiplies every sample by `gain`, in place. */
export function applyGain(buffer, gain) {
  if (gain === 1) return buffer;
  for (const data of channelsOf(buffer)) for (let i = 0; i < data.length; i++) data[i] *= gain;
  return buffer;
}

/**
 * Look-ahead peak limiter, in place. Guarantees no sample exceeds the ceiling
 * while ramping the gain down smoothly before each peak and releasing slowly.
 */
export function limitPeaks(buffer, ceilingDb = -1, { lookahead = 0.005, release = 0.2 } = {}) {
  const ceiling = dbToGain(ceilingDb) * 0.999;
  if (peakLevel(buffer) <= ceiling) return buffer;

  const channels = channelsOf(buffer);
  const n = buffer.length;
  const window = Math.max(1, Math.round(lookahead * buffer.sampleRate));

  // Gain each sample needs on its own.
  const needed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (const data of channels) {
      const v = data[i] < 0 ? -data[i] : data[i];
      if (v > peak) peak = v;
    }
    needed[i] = peak > ceiling ? ceiling / peak : 1;
  }

  // Minimum over the next `window` samples (monotonic deque, scanning backwards).
  const ahead = new Float32Array(n);
  const deque = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && needed[deque[tail - 1]] >= needed[i]) tail--;
    deque[tail++] = i;
    while (deque[head] > i + window) head++;
    ahead[i] = needed[deque[head]];
  }

  // Averaging the look-ahead minimum over the previous `window` samples gives
  // a smooth ramp that still reaches the required gain at every peak.
  const releaseCoef = 1 - Math.exp(-1 / (release * buffer.sampleRate));
  let sum = window + 1;
  let gain = 1;
  for (let i = 0; i < n; i++) {
    sum += ahead[i] - (i - window - 1 >= 0 ? ahead[i - window - 1] : 1);
    const smooth = sum / (window + 1);
    gain = Math.min(smooth, gain + (1 - gain) * releaseCoef);
    if (gain < 1) for (const data of channels) data[i] *= gain;
  }
  return buffer;
}

function biquad(coefs, input, output) {
  const [b0, b1, b2, a1, a2] = coefs;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    output[i] = y;
  }
  return output;
}

/** K-weighting filter coefficients from ITU-R BS.1770 (as derived by libebur128). */
function kWeighting(rate) {
  let f0 = 1681.974450955533;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / rate);
  const Vh = 10 ** (3.999843853973347 / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];

  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / rate);
  a0 = 1 + K / Q + K * K;
  const highpass = [1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  return [shelf, highpass];
}

/** Integrated loudness in LUFS (EBU R128 / ITU-R BS.1770 with gating). */
export function measureLoudness(buffer) {
  const rate = buffer.sampleRate;
  const segment = Math.round(rate * 0.1);
  const segments = Math.floor(buffer.length / segment);
  if (segments < 4) return -Infinity;

  const [shelf, highpass] = kWeighting(rate);
  const energy = new Float64Array(segments);
  const filtered = new Float32Array(buffer.length);
  for (const data of channelsOf(buffer)) {
    biquad(shelf, data, filtered);
    biquad(highpass, filtered, filtered);
    for (let s = 0, i = 0; s < segments; s++) {
      let sum = 0;
      for (const end = i + segment; i < end; i++) sum += filtered[i] * filtered[i];
      energy[s] += sum;
    }
  }

  // 400 ms blocks with 75% overlap.
  const blocks = new Float64Array(segments - 3);
  for (let j = 0; j < blocks.length; j++) blocks[j] = (energy[j] + energy[j + 1] + energy[j + 2] + energy[j + 3]) / (4 * segment);

  const lufs = (z) => -0.691 + 10 * Math.log10(z);
  const gatedMean = (threshold) => {
    let sum = 0;
    let count = 0;
    for (const z of blocks) if (lufs(z) > threshold) (sum += z), count++;
    return count ? sum / count : 0;
  };
  const absolute = gatedMean(-70);
  if (!absolute) return -Infinity;
  const relative = gatedMean(lufs(absolute) - 10);
  return relative ? lufs(relative) : -Infinity;
}

// ---------------------------------------------------------------------------
// Silence

/** Returns [{ start, end }] for every stretch quieter than thresholdDb lasting at least minLength seconds. */
export function findSilences(buffer, { thresholdDb = -45, minLength = 0.5 } = {}) {
  const channels = channelsOf(buffer);
  const step = Math.round(buffer.sampleRate * 0.02);
  const limit = dbToGain(thresholdDb) ** 2;
  const silences = [];
  let silentSince = null;

  for (let i = 0; i < buffer.length; i += step) {
    const end = Math.min(buffer.length, i + step);
    let sum = 0;
    for (const data of channels) for (let j = i; j < end; j++) sum += data[j] * data[j];
    const quiet = sum / ((end - i) * channels.length) < limit;
    if (quiet && silentSince === null) silentSince = i;
    if ((!quiet || end === buffer.length) && silentSince !== null) {
      const stop = quiet ? end : i;
      if ((stop - silentSince) / buffer.sampleRate >= minLength) {
        silences.push({ start: silentSince / buffer.sampleRate, end: stop / buffer.sampleRate });
      }
      silentSince = null;
    }
  }
  return silences;
}

/**
 * Works out which ranges to cut. Silence at the very start and end is removed
 * (keeping a few milliseconds), and with `shortenPauses` any pause in the
 * middle longer than `keepPause` seconds is shortened to that length.
 */
export function silenceCuts(duration, silences, { shortenPauses = true, keepPause = 0.5 } = {}) {
  const edge = 0.05;
  const cuts = [];
  for (const { start, end } of silences) {
    if (start <= 0.001) {
      if (end - edge > 0) cuts.push({ start: 0, end: end - edge });
    } else if (end >= duration - 0.001) {
      cuts.push({ start: start + edge, end: duration });
    } else if (shortenPauses && end - start > keepPause) {
      cuts.push({ start: start + keepPause / 2, end: end - keepPause / 2 });
    }
  }
  return cuts.filter((c) => c.end - c.start > 0.01);
}

/** Removes the given ranges, with tiny fades at each join to avoid clicks. */
export function cutRanges(buffer, cuts) {
  if (!cuts.length) return buffer;
  const parts = [];
  let position = 0;
  for (const cut of cuts) {
    if (cut.start > position) parts.push(sliceBuffer(buffer, position, cut.start));
    position = cut.end;
  }
  if (position < buffer.duration) parts.push(sliceBuffer(buffer, position, buffer.duration));
  if (!parts.length) return sliceBuffer(buffer, 0, 0);
  parts.forEach((part, i) => applyFades(part, i > 0 ? 0.005 : 0, i < parts.length - 1 ? 0.005 : 0));
  return concatBuffers(parts);
}

// ---------------------------------------------------------------------------
// Speed & pitch

/** Changes speed like a tape or record: faster also means higher pitch. */
export function changeRate(buffer, rate) {
  if (rate === 1) return buffer;
  return render(cloneBuffer(buffer, buffer.sampleRate * rate), { sampleRate: buffer.sampleRate });
}

/**
 * Time-stretches without changing pitch (WSOLA, in a worker).
 * factor > 1 makes the audio longer (slower).
 */
export function timeStretch(buffer, factor, onProgress) {
  if (Math.abs(factor - 1) < 1e-6) return Promise.resolve(buffer);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./dsp-worker.js', import.meta.url));
    const channels = channelsOf(buffer).map((data) => data.slice());
    worker.onmessage = ({ data: message }) => {
      if (message.type === 'progress') return onProgress?.(message.value);
      worker.terminate();
      if (message.type === 'error') return reject(new Error(message.message));
      const out = new AudioBuffer({ numberOfChannels: channels.length, length: message.channels[0].length, sampleRate: buffer.sampleRate });
      message.channels.forEach((data, ch) => out.copyToChannel(data, ch));
      resolve(out);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      worker.terminate();
      reject(new Error(e.message || 'Processing failed'));
    };
    worker.postMessage({ type: 'stretch', channels, factor }, channels.map((c) => c.buffer));
  });
}

/** Faster or slower playback that keeps the original pitch. */
export function changeTempo(buffer, speed, onProgress) {
  return timeStretch(buffer, 1 / speed, onProgress);
}

/** Shifts pitch by a number of semitones without changing the length. */
export async function shiftPitch(buffer, semitones, onProgress) {
  if (!semitones) return buffer;
  const ratio = 2 ** (semitones / 12);
  const stretched = await timeStretch(buffer, ratio, onProgress);
  return changeRate(stretched, ratio);
}

// ---------------------------------------------------------------------------
// Tone

export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/** 10-band graphic equalizer. `gains` are in dB, one per band. */
export function equalize(buffer, gains) {
  if (gains.every((g) => !g)) return Promise.resolve(cloneBuffer(buffer));
  return renderGraph(buffer, (context, source) =>
    EQ_BANDS.reduce((node, frequency, i) => {
      const filter = context.createBiquadFilter();
      filter.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      filter.frequency.value = Math.min(frequency, buffer.sampleRate / 2 - 100);
      filter.Q.value = 1.4;
      filter.gain.value = gains[i];
      return node.connect(filter);
    }, source),
  );
}

/** Rough RMS ratio of the stereo difference to the sum, 0 for mono. */
export function stereoWidth(buffer) {
  if (buffer.numberOfChannels < 2) return 0;
  const [left, right] = channelsOf(buffer);
  let mid = 0;
  let side = 0;
  for (let i = 0; i < left.length; i += 4) {
    const m = left[i] + right[i];
    const s = left[i] - right[i];
    mid += m * m;
    side += s * s;
  }
  return mid ? Math.sqrt(side / mid) : 0;
}

/**
 * Removes sound panned to the centre (usually the lead vocal) by subtracting
 * the centre channel. Bass is usually centred too, so frequencies below
 * `bassCutoff` are kept.
 */
export async function removeVocals(buffer, { strength = 1, keepBass = true, bassCutoff = 160 } = {}) {
  const [left, right] = channelsOf(buffer);
  const mid = new AudioBuffer({ numberOfChannels: 1, length: buffer.length, sampleRate: buffer.sampleRate });
  const midData = mid.getChannelData(0);
  for (let i = 0; i < midData.length; i++) midData[i] = (left[i] + right[i]) / 2;

  let bass = null;
  if (keepBass) {
    const low = await renderGraph(mid, (context, source) =>
      [0, 1].reduce((node) => {
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = bassCutoff;
        return node.connect(filter);
      }, source),
    );
    bass = low.getChannelData(0);
  }

  const out = new AudioBuffer({ numberOfChannels: 2, length: buffer.length, sampleRate: buffer.sampleRate });
  const outLeft = out.getChannelData(0);
  const outRight = out.getChannelData(1);
  for (let i = 0; i < midData.length; i++) {
    const centre = strength * (bass ? midData[i] - bass[i] : midData[i]);
    outLeft[i] = left[i] - centre;
    outRight[i] = right[i] - centre;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reverb

function createImpulse(context, seconds) {
  const length = Math.round(context.sampleRate * seconds);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  const preDelay = Math.round(context.sampleRate * 0.015);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    let smoothed = 0;
    for (let i = preDelay; i < length; i++) {
      const t = (i - preDelay) / (length - preDelay);
      // Low-passed noise sounds warmer, and gets darker as the tail decays.
      const damping = 0.35 + 0.6 * t;
      smoothed += (Math.random() * 2 - 1 - smoothed) * (1 - damping);
      data[i] = smoothed * (1 - t) ** 3;
    }
  }
  return impulse;
}

/** Adds reverb. `mix` is 0–1, `size` is the reverb tail in seconds. */
export async function addReverb(buffer, { mix = 0.35, size = 3 } = {}) {
  if (mix <= 0) return cloneBuffer(buffer);
  const tail = Math.round(size * buffer.sampleRate);
  const out = await renderGraph(
    buffer,
    (context, source) => {
      const output = context.createGain();
      const dry = context.createGain();
      const wet = context.createGain();
      const convolver = context.createConvolver();
      convolver.buffer = createImpulse(context, size);
      dry.gain.value = 1 - mix * 0.5;
      wet.gain.value = mix * 1.5;
      source.connect(dry).connect(output);
      source.connect(convolver).connect(wet).connect(output);
      return output;
    },
    { length: buffer.length + tail, channels: 2 },
  );
  return out;
}
