// Interactive waveform with a draggable selection.

const MIN_SELECTION = 0.1; // seconds
const BAR_WIDTH = 2;
const BAR_GAP = 1;
const PEAK_COUNT = 4000;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function computePeaks(buffer) {
  const peaks = new Float32Array(PEAK_COUNT);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, ch) => buffer.getChannelData(ch));
  const step = buffer.length / PEAK_COUNT;
  let loudest = 0;
  for (let i = 0; i < PEAK_COUNT; i++) {
    const from = Math.floor(i * step);
    const to = Math.min(buffer.length, Math.floor((i + 1) * step));
    let peak = 0;
    for (const data of channels) {
      for (let j = from; j < to; j++) {
        const v = data[j] < 0 ? -data[j] : data[j];
        if (v > peak) peak = v;
      }
    }
    peaks[i] = peak;
    if (peak > loudest) loudest = peak;
  }
  if (loudest > 0) for (let i = 0; i < PEAK_COUNT; i++) peaks[i] /= loudest;
  return peaks;
}

export class Waveform {
  #abort = new AbortController();
  #observer;

  constructor(root, buffer, { onChange } = {}) {
    this.root = root;
    this.duration = buffer.duration;
    this.onChange = onChange;
    this.start = 0;
    this.end = buffer.duration;
    this.peaks = computePeaks(buffer);

    root.classList.add('waveform');
    root.innerHTML = `
      <canvas></canvas>
      <div class="wf-region">
        <button type="button" class="wf-handle wf-handle-start" aria-label="Selection start (use arrow keys to adjust)"></button>
        <button type="button" class="wf-handle wf-handle-end" aria-label="Selection end (use arrow keys to adjust)"></button>
      </div>
      <div class="wf-playhead" hidden></div>`;
    this.canvas = root.querySelector('canvas');
    this.region = root.querySelector('.wf-region');
    this.playhead = root.querySelector('.wf-playhead');

    this.#observer = new ResizeObserver(() => this.draw());
    this.#observer.observe(root);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.draw(), { signal: this.#abort.signal });
    this.#bindPointer();
    this.#bindKeys();
    this.#update();
  }

  get selection() {
    return { start: this.start, end: this.end };
  }

  setSelection(start, end) {
    if (end < start) [start, end] = [end, start];
    start = clamp(start, 0, this.duration);
    end = clamp(end, 0, this.duration);
    if (end - start < MIN_SELECTION) {
      end = Math.min(this.duration, start + MIN_SELECTION);
      start = Math.max(0, end - MIN_SELECTION);
    }
    this.start = start;
    this.end = end;
    this.#update();
    this.onChange?.(this.selection);
  }

  setPlayhead(time) {
    this.playhead.hidden = time == null;
    if (time != null) this.playhead.style.left = `${(time / this.duration) * 100}%`;
  }

  destroy() {
    this.#abort.abort();
    this.#observer.disconnect();
    this.root.replaceChildren();
  }

  draw() {
    const { width, height } = this.root.getBoundingClientRect();
    if (!width) return;
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }

    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const styles = getComputedStyle(this.root);
    const idle = styles.getPropertyValue('--wave').trim();
    const active = styles.getPropertyValue('--wave-active').trim();
    const bars = Math.floor(width / (BAR_WIDTH + BAR_GAP));
    const middle = height / 2;
    const maxHeight = middle - 8;
    const selectionLeft = (this.start / this.duration) * width;
    const selectionRight = (this.end / this.duration) * width;

    for (let i = 0; i < bars; i++) {
      const from = Math.floor((i / bars) * PEAK_COUNT);
      const to = Math.max(from + 1, Math.floor(((i + 1) / bars) * PEAK_COUNT));
      let peak = 0;
      for (let j = from; j < to; j++) if (this.peaks[j] > peak) peak = this.peaks[j];
      const x = i * (BAR_WIDTH + BAR_GAP);
      const h = Math.max(1, peak * maxHeight);
      ctx.fillStyle = x + BAR_WIDTH > selectionLeft && x < selectionRight ? active : idle;
      ctx.fillRect(x, middle - h, BAR_WIDTH, h * 2);
    }
  }

  #update() {
    const left = (this.start / this.duration) * 100;
    const right = (this.end / this.duration) * 100;
    this.region.style.left = `${left}%`;
    this.region.style.width = `${right - left}%`;
    this.draw();
  }

  #timeAt(clientX) {
    const rect = this.root.getBoundingClientRect();
    return clamp((clientX - rect.left) / rect.width, 0, 1) * this.duration;
  }

  #bindPointer() {
    const { signal } = this.#abort;
    this.root.addEventListener(
      'pointerdown',
      (down) => {
        if (down.button !== 0) return;
        down.preventDefault();
        const handle = down.target.closest('.wf-handle');
        handle?.focus();
        const mode = handle ? (handle.classList.contains('wf-handle-start') ? 'start' : 'end') : 'new';
        const anchor = this.#timeAt(down.clientX);
        const before = this.selection;
        let moved = false;
        this.root.setPointerCapture(down.pointerId);

        const onMove = (e) => {
          if (!moved && Math.abs(e.clientX - down.clientX) < 3) return;
          moved = true;
          const t = this.#timeAt(e.clientX);
          if (mode === 'start') this.setSelection(Math.min(t, this.end - MIN_SELECTION), this.end);
          else if (mode === 'end') this.setSelection(this.start, Math.max(t, this.start + MIN_SELECTION));
          else this.setSelection(Math.min(anchor, t), Math.max(anchor, t));
        };
        const onUp = () => {
          this.root.removeEventListener('pointermove', onMove);
          this.root.removeEventListener('pointerup', onUp);
          this.root.removeEventListener('pointercancel', onUp);
          if (moved || mode !== 'new') return;
          // A plain click moves whichever edge is closer.
          if (Math.abs(anchor - before.start) <= Math.abs(anchor - before.end)) {
            this.setSelection(Math.min(anchor, before.end - MIN_SELECTION), before.end);
          } else {
            this.setSelection(before.start, Math.max(anchor, before.start + MIN_SELECTION));
          }
        };
        this.root.addEventListener('pointermove', onMove, { signal });
        this.root.addEventListener('pointerup', onUp, { signal });
        this.root.addEventListener('pointercancel', onUp, { signal });
      },
      { signal },
    );
  }

  #bindKeys() {
    this.region.addEventListener(
      'keydown',
      (e) => {
        const handle = e.target.closest('.wf-handle');
        const step = e.shiftKey ? 1 : 0.1;
        const delta = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        if (!handle || !delta) return;
        e.preventDefault();
        if (handle.classList.contains('wf-handle-start')) {
          this.setSelection(Math.min(this.start + delta, this.end - MIN_SELECTION), this.end);
        } else {
          this.setSelection(this.start, Math.max(this.end + delta, this.start + MIN_SELECTION));
        }
      },
      { signal: this.#abort.signal },
    );
  }
}
