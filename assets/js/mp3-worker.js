/* global lamejs */
importScripts('../vendor/lamejs.js');

let encoder = null;
let channels = 2;
let parts = [];
let left = new Int16Array(0);
let right = new Int16Array(0);

function toInt16(source, target) {
  for (let i = 0; i < source.length; i++) {
    const s = source[i] < -1 ? -1 : source[i] > 1 ? 1 : source[i];
    target[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return target.subarray(0, source.length);
}

self.onmessage = ({ data: message }) => {
  try {
    switch (message.type) {
      case 'init':
        channels = message.channels;
        encoder = new lamejs.Mp3Encoder(channels, message.sampleRate, message.kbps);
        parts = [];
        self.postMessage({ type: 'ready' });
        break;

      case 'encode': {
        const frames = message.channels[0].length;
        if (left.length < frames) {
          left = new Int16Array(frames);
          right = new Int16Array(frames);
        }
        const l = toInt16(message.channels[0], left);
        const out = channels === 2 ? encoder.encodeBuffer(l, toInt16(message.channels[1], right)) : encoder.encodeBuffer(l);
        if (out.length) parts.push(out.slice());
        self.postMessage({ type: 'encoded' });
        break;
      }

      case 'finish': {
        const out = encoder.flush();
        if (out.length) parts.push(out.slice());
        self.postMessage({ type: 'done', blob: new Blob(parts, { type: 'audio/mpeg' }) });
        parts = [];
        break;
      }
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message ?? err) });
  }
};
