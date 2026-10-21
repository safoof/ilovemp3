import '../layout.js';
import { icon } from '../icons.js';
import { $, createProgress, downloadBlob, formatBytes, formatTime, isAudioFile, isMp3, parseTime, previewBlob, setStage, setupFilePicker, toast, withSuffix } from '../ui.js';
import { Player, applyFades, decodeAudio, encodeMp3, removeRange, sliceBuffer, suggestBitrate } from '../audio.js';
import { readTags, withTags } from '../id3.js';
import { Waveform } from '../waveform.js';

const progress = createProgress($('[data-stage-panel="working"]'));
const startInput = $('#start');
const endInput = $('#end');
const playButton = $('#play');

let source = null; // { file, buffer, tags }
let waveform = null;
let player = null;
let result = null;

setupFilePicker({ input: $('#file-input'), accept: isAudioFile, onFiles: ([file]) => load(file) });
setPlaying(false);

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
    $('#bitrate').value = String(bitrate);
  } catch (err) {
    toast(err.message, 'error');
    setStage(source && previousStage !== 'upload' ? 'edit' : 'upload');
    return;
  }

  player?.stop();
  player = new Player(source.buffer);
  setPlaying(false);
  $('#file-name').textContent = source.file.name;
  $('#duration').textContent = formatTime(source.buffer.duration, 1);

  setStage('edit');
  waveform?.destroy();
  waveform = new Waveform($('#waveform'), source.buffer, { onChange: showSelection });
  showSelection(waveform.selection);
}

function keepMode() {
  return $('input[name="mode"]:checked').value === 'keep';
}

function showSelection({ start, end }) {
  startInput.value = formatTime(start, 2);
  endInput.value = formatTime(end, 2);
  $('#selection-length').textContent = `Selected: ${formatTime(end - start, 1)}`;
  const remaining = keepMode() ? end - start : source.buffer.duration - (end - start);
  $('#result-length').textContent = `New length: ${formatTime(remaining, 1)}`;
}

for (const [input, edge] of [
  [startInput, 'start'],
  [endInput, 'end'],
]) {
  input.addEventListener('change', () => {
    const time = parseTime(input.value);
    const { start, end } = waveform.selection;
    if (time === null) showSelection({ start, end });
    else if (edge === 'start') waveform.setSelection(time, end);
    else waveform.setSelection(start, time);
  });
}

for (const radio of document.querySelectorAll('input[name="mode"]')) {
  radio.addEventListener('change', () => showSelection(waveform.selection));
}

// Playback ------------------------------------------------------------------

function setPlaying(playing) {
  playButton.innerHTML = playing ? `${icon('pause')}Stop` : `${icon('play')}Play selection`;
}

function stopPlayback() {
  player?.stop();
  waveform?.setPlayhead(null);
  setPlaying(false);
}

function togglePlayback() {
  if (player.playing) return stopPlayback();
  const { start, end } = waveform.selection;
  player.play(start, end, {
    onTick: (time) => waveform.setPlayhead(time),
    onEnd: stopPlayback,
  });
  setPlaying(true);
}

playButton.addEventListener('click', togglePlayback);
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || document.body.dataset.stage !== 'edit') return;
  if (e.target.closest('input, select, textarea, a, button:not(.wf-handle)')) return;
  e.preventDefault();
  togglePlayback();
});

// Processing ----------------------------------------------------------------

$('#run').addEventListener('click', async () => {
  stopPlayback();
  const { start, end } = waveform.selection;
  const audio = keepMode() ? sliceBuffer(source.buffer, start, end) : removeRange(source.buffer, start, end);
  if (audio.duration < 0.1) {
    toast('That would leave almost nothing. Select a smaller part to remove.', 'error');
    return;
  }
  applyFades(audio, Number($('#fade-in').value), Number($('#fade-out').value));

  setStage('working');
  progress.set(0, 'Trimming your MP3…');
  try {
    let blob = await encodeMp3(audio, { kbps: Number($('#bitrate').value), onProgress: (p) => progress.set(p) });
    if (source.tags) blob = withTags(blob, source.tags);
    result = { blob, name: withSuffix(source.file.name, '-trimmed', 'mp3') };
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
