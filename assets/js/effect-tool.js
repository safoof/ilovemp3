// Shared page flow for tools that apply an effect to one file:
// upload -> options with A/B preview -> encode -> download.
import './layout.js';
import { icon } from './icons.js';
import { $, $$, createProgress, downloadBlob, formatBytes, formatTime, isAudioFile, isMp3, previewBlob, setStage, setupFilePicker, toast, withSuffix } from './ui.js';
import { Player, decodeAudio, encodeMp3, sliceBuffer, suggestBitrate } from './audio.js';
import { readTags, withTags } from './id3.js';
import { Waveform } from './waveform.js';

const PREVIEW_SECONDS = 15;
const CHECK = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7" /></svg>';

/**
 * @param {object} tool
 * @param {string} tool.panelTitle   heading of the options panel
 * @param {string} tool.runLabel     main button label
 * @param {string} tool.workingLabel progress label while processing
 * @param {string} tool.doneTitle    heading when finished
 * @param {string|(() => string)} tool.suffix added to the output file name
 * @param {(buffer: AudioBuffer, opts: { onProgress, preview }) => Promise<AudioBuffer>} tool.process
 * @param {(source) => string|null} [tool.validate] error message if the file can't be used
 * @param {(source) => void} [tool.onLoad] analyse the file after it loads
 * @param {(source) => string} [tool.summary] text under the options
 * @param {(source) => string} [tool.stats] text under the waveform
 * @param {boolean} [tool.preview=true]
 */
export function effectTool(tool) {
  buildPage(tool);

  const progress = createProgress($('[data-stage-panel="working"]'));
  const originalButton = $('#play-original');
  const resultButton = $('#play-result');
  let source = null; // { file, buffer, tags }
  let waveform = null;
  let player = null;
  let playing = null; // 'original' | 'result'
  let result = null;
  let previewToken = 0;

  setupFilePicker({ input: $('#file-input'), accept: isAudioFile, onFiles: ([file]) => load(file) });
  setPreviewButtons();

  async function load(file) {
    const previousStage = document.body.dataset.stage;
    setStage('working');
    progress.busy('Reading your file…');
    let next;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const buffer = await decodeAudio(bytes, file.name);
      next = { file, buffer, tags: null, bitrate: 192 };
      if (isMp3(file)) {
        const info = readTags(bytes);
        next.tags = info.tags;
        next.bitrate = suggestBitrate(info.audioEnd - info.audioStart, buffer.duration);
      }
      const problem = tool.validate?.(next);
      if (problem) throw new Error(problem);
      await tool.onLoad?.(next);
    } catch (err) {
      toast(err.message, 'error');
      setStage(source && previousStage !== 'upload' ? 'edit' : 'upload');
      return;
    }

    source = next;
    stopPreview();
    $('#bitrate').value = String(Math.max(128, source.bitrate));
    $('#file-name').textContent = file.name;
    $('#duration').textContent = formatTime(source.buffer.duration, 1);
    setStage('edit');
    waveform?.destroy();
    waveform = new Waveform($('#waveform'), source.buffer, { mode: 'cursor', onSeek: stopPreview });
    waveform.setCursor(Math.min(source.buffer.duration * 0.25, 30));
    refresh();
  }

  /** Call when an option changes, to update the summary and stats. */
  function refresh() {
    if (!source) return;
    stopPreview();
    $('#summary').textContent = tool.summary?.(source) ?? '';
    $('#stats').textContent = tool.stats?.(source) ?? '';
  }

  // Preview -------------------------------------------------------------------

  function setPreviewButtons(busy = false) {
    originalButton.innerHTML = playing === 'original' ? `${icon('stop')}Stop` : `${icon('play')}Original`;
    resultButton.innerHTML = playing === 'result' ? `${icon('stop')}Stop` : busy ? 'Preparing…' : `${icon('play')}Preview result`;
    resultButton.disabled = busy;
  }

  function stopPreview() {
    previewToken++;
    player?.stop();
    playing = null;
    waveform?.setPlayhead(null);
    setPreviewButtons();
  }

  async function preview(which) {
    if (playing === which) return stopPreview();
    stopPreview();
    const token = previewToken;
    const start = Math.min(waveform.cursor, Math.max(0, source.buffer.duration - 1));
    const excerpt = sliceBuffer(source.buffer, start, start + PREVIEW_SECONDS);
    let audio = excerpt;
    if (which === 'result') {
      setPreviewButtons(true);
      try {
        audio = await tool.process(excerpt, { preview: true });
      } catch (err) {
        toast(err.message, 'error');
        setPreviewButtons();
        return;
      }
      if (token !== previewToken) return; // stopped or restarted meanwhile
    }

    // Map playback time back onto the original timeline, e.g. for speed changes.
    const scale = excerpt.duration / audio.duration;
    player = new Player(audio);
    playing = which;
    setPreviewButtons();
    player.play(0, audio.duration, {
      onTick: (t) => waveform.setPlayhead(Math.min(start + t * scale, start + excerpt.duration)),
      onEnd: stopPreview,
    });
  }

  originalButton.addEventListener('click', () => preview('original'));
  resultButton.addEventListener('click', () => preview('result'));
  resultButton.hidden = tool.preview === false;
  originalButton.hidden = tool.preview === false;
  $('#preview-hint').hidden = tool.preview === false;

  // Processing ----------------------------------------------------------------

  $('#run').addEventListener('click', async () => {
    stopPreview();
    setStage('working');
    progress.busy(tool.workingLabel);
    try {
      let reported = false;
      const audio = await tool.process(source.buffer, {
        preview: false,
        onProgress: (p) => {
          reported = true;
          progress.set(p * 0.6, tool.workingLabel);
        },
      });
      const base = reported ? 0.6 : 0;
      progress.set(base, 'Saving as MP3…');
      let blob = await encodeMp3(audio, {
        kbps: Number($('#bitrate').value),
        onProgress: (p) => progress.set(base + p * (1 - base)),
      });
      if (source.tags) blob = withTags(blob, source.tags);
      result = { blob, name: withSuffix(source.file.name, typeof tool.suffix === 'function' ? tool.suffix() : tool.suffix, 'mp3') };
      $('#result-meta').textContent = `${result.name} · ${formatTime(audio.duration, 0)} · ${formatBytes(blob.size)}`;
      previewBlob($('#result-audio'), blob);
      setStage('done');
    } catch (err) {
      toast(err.message, 'error');
      setStage('edit');
    }
  });

  $('#download').addEventListener('click', () => downloadBlob(result.blob, result.name));
  $('#back').addEventListener('click', () => setStage('edit'));

  return {
    refresh,
    get source() {
      return source;
    },
  };
}

function buildPage(tool) {
  const main = $('main');
  const options = $('#tool-options');
  main.insertAdjacentHTML(
    'beforeend',
    `
    <section class="workspace container" data-stage-panel="edit" hidden>
      <div class="card">
        <div class="toolbar">
          <h2 id="file-name"></h2>
          <div class="toolbar-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-pick>Choose another file</button>
          </div>
        </div>
        <div id="waveform"></div>
        <div class="time-axis"><span>0:00</span><span id="duration"></span></div>
        <div class="editor-controls preview-controls">
          <button type="button" class="btn btn-secondary" id="play-original"></button>
          <button type="button" class="btn btn-secondary" id="play-result"></button>
        </div>
        <p class="hint" id="preview-hint">Click the waveform to choose where the ${PREVIEW_SECONDS}-second preview starts.</p>
        <p class="hint" id="stats"></p>
      </div>
      <aside class="card panel">
        <h2>${tool.panelTitle}</h2>
        <div class="panel-options"></div>
        <label class="field">
          <span class="field-label">Quality</span>
          <select class="input" id="bitrate">
            <option value="128">128 kbps · smaller file</option>
            <option value="160">160 kbps</option>
            <option value="192">192 kbps · recommended</option>
            <option value="256">256 kbps</option>
            <option value="320">320 kbps · best quality</option>
          </select>
        </label>
        <p class="panel-summary" id="summary"></p>
        <button type="button" class="btn btn-primary btn-lg btn-block" id="run">${tool.runLabel}</button>
      </aside>
    </section>

    <section class="working container" data-stage-panel="working" hidden>
      <h2 class="progress-label">Working…</h2>
      <div class="progress-bar"><span></span></div>
      <p class="progress-pct">0%</p>
    </section>

    <section class="done container" data-stage-panel="done" hidden>
      <div class="done-badge">${CHECK}</div>
      <h1>${tool.doneTitle}</h1>
      <p class="done-meta" id="result-meta"></p>
      <button type="button" class="btn btn-primary btn-xl" id="download">Download MP3</button>
      <audio controls id="result-audio"></audio>
      <div class="done-links">
        <button type="button" class="btn-link" id="back">Back to options</button>
        <button type="button" class="btn-link" data-pick>Choose another file</button>
      </div>
    </section>`,
  );
  if (options) $('.panel-options').append(options.content.cloneNode(true));
}

/** Keeps a range input's value label in sync. */
export function bindRange(input, output, format) {
  const update = () => (output.textContent = format(Number(input.value)));
  input.addEventListener('input', update);
  update();
  return update;
}

export { $, $$ };
