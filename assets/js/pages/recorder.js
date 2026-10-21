import '../layout.js';
import { icon } from '../icons.js';
import { $, $$, createProgress, downloadBlob, formatBytes, formatTime, previewBlob, setStage, toast } from '../ui.js';
import { decodeAudio, encodeMp3 } from '../audio.js';
import { cutRanges, findSilences, silenceCuts, stereoWidth } from '../dsp.js';
import { Waveform } from '../waveform.js';

const progress = createProgress($('[data-stage-panel="working"]'));
const recorderCard = $('.recorder');
const recordButton = $('#record');
const pauseButton = $('#pause');
const canvas = $('#meter');

let state = 'idle'; // idle | recording | paused | processing
let stream = null;
let mediaRecorder = null;
let chunks = [];
let meter = null; // { context, analyser, frame, levels }
let elapsed = 0; // ms recorded before the current run
let runStart = 0;
let take = null; // { blob, buffer }
let waveform = null;
let result = null;

// Recording ---------------------------------------------------------------

function setState(next) {
  state = next;
  recorderCard.dataset.state = next;
  recordButton.setAttribute('aria-label', next === 'idle' ? 'Start recording' : 'Stop recording');
  recordButton.disabled = next === 'processing';
  pauseButton.hidden = next !== 'recording' && next !== 'paused';
  pauseButton.innerHTML = next === 'paused' ? `${icon('record')}Resume` : `${icon('pause')}Pause`;
  $('#status').textContent = {
    idle: 'Press the button to start recording.',
    recording: 'Recording… press the button again to stop.',
    paused: 'Paused.',
    processing: 'Preparing your recording…',
  }[next];
}

function recordedMs() {
  return elapsed + (state === 'recording' ? performance.now() - runStart : 0);
}

function errorMessage(err) {
  if (err.name === 'NotAllowedError') return 'Microphone access was blocked. Allow it in your browser’s site settings and try again.';
  if (err.name === 'NotFoundError') return 'No microphone was found. Plug one in and try again.';
  return `Couldn’t start recording: ${err.message}`;
}

async function start() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast('Recording isn’t supported in this browser.', 'error');
    return;
  }
  const deviceId = $('#device').value;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        noiseSuppression: $('#noise').checked,
        echoCancellation: $('#echo').checked,
        autoGainControl: $('#agc').checked,
      },
    });
  } catch (err) {
    toast(errorMessage(err), 'error');
    return;
  }
  listDevices();

  chunks = [];
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  mediaRecorder.onstop = finish;
  mediaRecorder.start(1000);

  elapsed = 0;
  runStart = performance.now();
  startMeter();
  setState('recording');
}

function stop() {
  elapsed = recordedMs();
  setState('processing');
  mediaRecorder.stop();
  for (const track of stream.getTracks()) track.stop();
  stopMeter();
}

function togglePause() {
  if (state === 'recording') {
    elapsed = recordedMs();
    mediaRecorder.pause();
    setState('paused');
  } else if (state === 'paused') {
    runStart = performance.now();
    mediaRecorder.resume();
    setState('recording');
  }
}

async function finish() {
  const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
  try {
    if (!blob.size) throw new Error('Nothing was recorded. Check that your microphone is working.');
    take = { blob, buffer: await decodeAudio(blob, 'your recording') };
  } catch (err) {
    toast(err.message, 'error');
    setState('idle');
    return;
  }
  setState('idle');
  showTake();
}

recordButton.addEventListener('click', () => (state === 'idle' ? start() : stop()));
pauseButton.addEventListener('click', togglePause);

async function listDevices() {
  const select = $('#device');
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId && d.label);
  if (!devices.length) return;
  const selected = select.value;
  select.innerHTML = '<option value="">Default microphone</option>';
  for (const device of devices) {
    if (device.deviceId === 'default') continue;
    const option = new Option(device.label, device.deviceId);
    select.append(option);
  }
  select.value = selected;
}

// Live level meter --------------------------------------------------------

function startMeter() {
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  context.createMediaStreamSource(stream).connect(analyser);
  meter = { context, analyser, samples: new Float32Array(analyser.fftSize), levels: [], frame: 0 };
  drawMeter();
}

function stopMeter() {
  if (!meter) return;
  cancelAnimationFrame(meter.frame);
  meter.context.close();
  meter = null;
}

function drawMeter() {
  const { width, height } = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  if (meter) {
    meter.analyser.getFloatTimeDomainData(meter.samples);
    let peak = 0;
    for (const s of meter.samples) peak = Math.max(peak, Math.abs(s));
    if (state === 'recording') meter.levels.push(Math.min(1, Math.sqrt(peak)));
    const bars = Math.floor(width / 4);
    if (meter.levels.length > bars) meter.levels.splice(0, meter.levels.length - bars);

    const styles = getComputedStyle(canvas);
    ctx.fillStyle = (state === 'recording' ? styles.getPropertyValue('--wave-active') : styles.getPropertyValue('--wave')).trim();
    const offset = width - meter.levels.length * 4;
    meter.levels.forEach((level, i) => {
      const h = Math.max(2, level * (height - 8));
      ctx.fillRect(offset + i * 4, (height - h) / 2, 2.5, h);
    });
    meter.frame = requestAnimationFrame(drawMeter);
  }
  $('#timer').textContent = formatTime(recordedMs() / 1000, 1);
}

// Review & save -----------------------------------------------------------

function defaultName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Recording ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

function trimCuts() {
  const { buffer } = take;
  return silenceCuts(buffer.duration, findSilences(buffer, { thresholdDb: -50, minLength: 0.2 }), { shortenPauses: false });
}

function updateSummary() {
  const removed = $('#trim').checked ? trimCuts().reduce((sum, c) => sum + c.end - c.start, 0) : 0;
  $('#summary').textContent = `Length: ${formatTime(take.buffer.duration - removed, 1)}${removed > 0.1 ? ` (${formatTime(removed, 1)} of silence trimmed)` : ''}`;
}

function showTake() {
  result = null;
  $('#name').value = defaultName();
  $('#duration').textContent = formatTime(take.buffer.duration, 1);
  previewBlob($('#take-audio'), take.blob);
  setStage('edit');
  waveform?.destroy();
  waveform = new Waveform($('#waveform'), take.buffer, { mode: 'view' });
  updateSummary();
}

$('#trim').addEventListener('change', updateSummary);

$('#run').addEventListener('click', async () => {
  setStage('working');
  progress.set(0, 'Saving as MP3…');
  try {
    const audio = $('#trim').checked ? cutRanges(take.buffer, trimCuts()) : take.buffer;
    const mono = audio.numberOfChannels === 1 || stereoWidth(audio) < 0.01;
    const blob = await encodeMp3(audio, { kbps: Number($('#bitrate').value), mono, onProgress: (p) => progress.set(p) });
    const name = `${$('#name').value.trim().replace(/[\\/:*?"<>|]+/g, '-') || 'Recording'}.mp3`;
    result = { blob, name };
    $('#result-meta').textContent = `${name} · ${formatTime(audio.duration, 0)} · ${formatBytes(blob.size)}`;
    previewBlob($('#result-audio'), blob);
    setStage('done');
  } catch (err) {
    toast(err.message, 'error');
    setStage('edit');
  }
});

$('#download').addEventListener('click', () => downloadBlob(result.blob, result.name));
$('#back').addEventListener('click', () => setStage('edit'));
for (const button of $$('[data-restart]')) {
  button.addEventListener('click', () => {
    if (take && !result && !confirm('Discard this recording?')) return;
    take = null;
    result = null;
    $('#timer').textContent = formatTime(0, 1);
    drawMeter();
    setStage('upload');
  });
}

window.addEventListener('beforeunload', (e) => {
  if (state === 'recording' || state === 'paused' || (take && !result)) e.preventDefault();
});

setState('idle');
drawMeter();
