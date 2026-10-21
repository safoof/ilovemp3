import '../layout.js';
import { $, $$, createProgress, formatBytes, formatTime, isAudioFile, isMp3, setStage, setupFilePicker, stripExtension, toast } from '../ui.js';
import { decodeAudio, encodeMp3, sliceBuffer, suggestBitrate } from '../audio.js';
import { findSilences } from '../dsp.js';
import { readTags, withTags } from '../id3.js';
import { Waveform } from '../waveform.js';
import { bindDownload, showResults } from '../batch.js';

const MAX_PARTS = 100;
const progress = createProgress($('[data-stage-panel="working"]'));
const runButton = $('#run');

let source = null; // { file, buffer, tags }
let waveform = null;
let points = []; // split times in seconds

setupFilePicker({ input: $('#file-input'), accept: isAudioFile, onFiles: ([file]) => load(file) });
bindDownload();

async function load(file) {
  const previousStage = document.body.dataset.stage;
  setStage('working');
  progress.busy('Reading your file…');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const buffer = await decodeAudio(bytes, file.name);
    let tags = null;
    let bitrate = 192;
    if (isMp3(file)) {
      const info = readTags(bytes);
      tags = info.tags;
      bitrate = suggestBitrate(info.audioEnd - info.audioStart, buffer.duration);
    }
    source = { file, buffer, tags };
    $('#bitrate').value = String(Math.max(128, bitrate));
  } catch (err) {
    toast(err.message, 'error');
    setStage(source && previousStage !== 'upload' ? 'edit' : 'upload');
    return;
  }
  $('#file-name').textContent = file.name;
  $('#duration').textContent = formatTime(source.buffer.duration, 1);
  // Suggest roughly 10-minute parts for long files.
  $('#count').value = String(Math.min(MAX_PARTS, Math.max(2, Math.round(source.buffer.duration / 600))));
  setStage('edit');
  waveform?.destroy();
  waveform = new Waveform($('#waveform'), source.buffer, { mode: 'view' });
  update();
}

const mode = () => $('input[name="mode"]:checked').value;

function splitPoints() {
  const duration = source.buffer.duration;
  if (mode() === 'equal') {
    const count = Math.min(MAX_PARTS, Math.max(2, Math.round(Number($('#count').value)) || 2));
    return Array.from({ length: count - 1 }, (_, i) => ((i + 1) * duration) / count);
  }
  if (mode() === 'length') {
    const length = Math.max(0.5, Number($('#minutes').value) || 10) * 60;
    const times = [];
    for (let t = length; t < duration - 1 && times.length < MAX_PARTS - 1; t += length) times.push(t);
    return times;
  }
  return findSilences(source.buffer, { thresholdDb: Number($('#threshold').value), minLength: Number($('#gap').value) })
    .filter((s) => s.start > 0.5 && s.end < duration - 0.5)
    .map((s) => (s.start + s.end) / 2)
    .slice(0, MAX_PARTS - 1);
}

function update() {
  for (const el of $$('[data-mode]')) el.hidden = el.dataset.mode !== mode();
  if (!source) return;
  points = splitPoints();
  waveform.setMarkers(points);

  const bounds = [0, ...points, source.buffer.duration];
  const parts = bounds.slice(1).map((end, i) => ({ start: bounds[i], end }));
  $('#parts').replaceChildren(
    ...parts.map((part, i) => {
      const li = document.createElement('li');
      li.className = 'file-item';
      li.innerHTML = `<span class="file-icon"><span class="file-index">${i + 1}</span></span>
        <div class="file-info"><div class="file-name">Part ${i + 1}</div><div class="file-meta"></div></div>`;
      li.querySelector('.file-meta').textContent = `${formatTime(part.start, 0)} – ${formatTime(part.end, 0)} · ${formatTime(part.end - part.start, 0)} long`;
      return li;
    }),
  );
  $('#parts-title').textContent = `${parts.length} part${parts.length === 1 ? '' : 's'}`;
  runButton.disabled = parts.length < 2;
  $('#summary').textContent =
    parts.length < 2
      ? mode() === 'silence'
        ? 'No pauses found. Try a shorter pause length or a higher silence level.'
        : 'The file is shorter than one part.'
      : `${parts.length} files will be created.`;
}

for (const el of $$('input[name="mode"], #count, #minutes, #gap, #threshold')) {
  el.addEventListener('change', update);
  el.addEventListener('input', update);
}

runButton.addEventListener('click', async () => {
  const bounds = [0, ...points, source.buffer.duration];
  const count = bounds.length - 1;
  const base = stripExtension(source.file.name);
  const digits = String(count).length;
  const results = [];
  setStage('working');
  try {
    for (let i = 0; i < count; i++) {
      const label = `Saving part ${i + 1} of ${count}…`;
      progress.set(i / count, label);
      const part = sliceBuffer(source.buffer, bounds[i], bounds[i + 1]);
      let blob = await encodeMp3(part, { kbps: Number($('#bitrate').value), onProgress: (p) => progress.set((i + p) / count, label) });
      if (source.tags) {
        const title = source.tags.title || base;
        blob = withTags(blob, { ...source.tags, title: `${title} (Part ${i + 1})`, track: `${i + 1}/${count}` });
      }
      const number = String(i + 1).padStart(Math.max(2, digits), '0');
      results.push({ name: `${base} - Part ${number}.mp3`, blob, meta: `${formatTime(part.duration, 0)} · ${formatBytes(blob.size)}` });
    }
  } catch (err) {
    toast(err.message, 'error');
    setStage('edit');
    return;
  }
  showResults(results, {
    title: `Your file has been split into ${count} parts`,
    meta: source.file.name,
    zipName: `${base} (split).zip`,
  });
  setStage('done');
});

$('#back').addEventListener('click', () => setStage('edit'));
