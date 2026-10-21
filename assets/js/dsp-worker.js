// Time stretching with WSOLA (waveform-similarity overlap-add). Each output
// frame is taken from near its nominal input position, nudged to the offset
// that best lines up with the previous frame so the overlap stays in phase.

const FRAME = 2048; // ~46 ms at 44.1 kHz
const HOP = FRAME / 2;
const TOLERANCE = 512; // how far a frame may be nudged, in samples
const DECIMATE = 4; // coarse search runs on a 4x downsampled signal

function hann(size) {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return window;
}

function correlate(signal, a, b, length) {
  let sum = 0;
  for (let i = 0; i < length; i++) sum += signal[a + i] * signal[b + i];
  return sum;
}

function stretch(channels, factor, onProgress) {
  const length = channels[0].length;
  const outLength = Math.round(length * factor);
  const analysisHop = HOP / factor;
  const window = hann(FRAME);

  // A mono guide signal for the similarity search, plus a decimated copy.
  const mono = new Float32Array(length);
  for (const data of channels) for (let i = 0; i < length; i++) mono[i] += data[i];
  const coarse = new Float32Array(Math.floor(length / DECIMATE));
  for (let i = 0; i < coarse.length; i++) {
    let sum = 0;
    for (let j = 0; j < DECIMATE; j++) sum += mono[i * DECIMATE + j];
    coarse[i] = sum;
  }

  const out = channels.map(() => new Float32Array(outLength + FRAME));
  const weight = new Float32Array(outLength + FRAME);
  const frames = Math.ceil(outLength / HOP);
  const maxStart = Math.max(0, length - FRAME);
  let previous = 0;

  for (let k = 0; k < frames; k++) {
    const nominal = Math.min(maxStart, Math.round(k * analysisHop));
    let best = nominal;

    if (k > 0) {
      // The ideal next frame continues the previous one seamlessly.
      const target = Math.min(maxStart, previous + HOP);
      const from = Math.max(0, nominal - TOLERANCE);
      const to = Math.min(maxStart, nominal + TOLERANCE);
      const span = FRAME / DECIMATE;
      const t = Math.floor(target / DECIMATE);
      if (t + span <= coarse.length) {
        let bestScore = -Infinity;
        for (let c = Math.ceil(from / DECIMATE); c * DECIMATE <= to && c + span <= coarse.length; c++) {
          const score = correlate(coarse, c, t, span);
          if (score > bestScore) {
            bestScore = score;
            best = c * DECIMATE;
          }
        }
        // Refine at full resolution around the coarse match.
        const coarseBest = best;
        bestScore = -Infinity;
        for (let c = Math.max(from, coarseBest - DECIMATE); c <= Math.min(to, coarseBest + DECIMATE); c++) {
          const score = correlate(mono, c, target, FRAME);
          if (score > bestScore) {
            bestScore = score;
            best = c;
          }
        }
      }
    }

    const offset = k * HOP;
    for (let ch = 0; ch < channels.length; ch++) {
      const src = channels[ch];
      const dst = out[ch];
      for (let i = 0; i < FRAME && best + i < length; i++) dst[offset + i] += src[best + i] * window[i];
    }
    for (let i = 0; i < FRAME; i++) weight[offset + i] += window[i];
    previous = best;

    if (k % 256 === 0) onProgress(k / frames);
  }

  return out.map((data) => {
    for (let i = 0; i < outLength; i++) if (weight[i] > 1e-3) data[i] /= weight[i];
    return data.slice(0, outLength);
  });
}

self.onmessage = ({ data: message }) => {
  try {
    if (message.type !== 'stretch') return;
    const channels = stretch(message.channels, message.factor, (value) => self.postMessage({ type: 'progress', value }));
    self.postMessage({ type: 'done', channels }, channels.map((c) => c.buffer));
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message ?? err) });
  }
};
