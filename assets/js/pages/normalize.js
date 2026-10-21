import '../layout.js';
import { $, FileQueue, createProgress, formatBytes, isAudioFile, isMp3, setStage, setupFilePicker, withSuffix } from '../ui.js';
import { decodeAudio, encodeMp3, suggestBitrate } from '../audio.js';
import { applyGain, cloneBuffer, dbToGain, gainToDb, limitPeaks, measureLoudness, peakLevel } from '../dsp.js';
import { readTags, withTags } from '../id3.js';
import { bindDownload, processAll, showResults } from '../batch.js';

const CEILING = -1; // dB
const progress = createProgress($('[data-stage-panel="working"]'));
const runButton = $('#run');
const queue = new FileQueue($('#file-list'), { onChange: refresh });

setupFilePicker({ input: $('#file-input'), accept: isAudioFile, onFiles: add });
bindDownload();

function add(files) {
  queue.add(files);
  setStage('edit');
}

function refresh() {
  if (!queue.items.length && document.body.dataset.stage === 'edit') setStage('upload');
  runButton.disabled = !queue.items.length;
}

const formatLufs = (value) => `${value.toFixed(1).replace('-', '−')} LUFS`;
const formatDb = (value) => `${value.toFixed(1).replace('-', '−')} dB`;

/** Applies the gain needed to reach the target loudness, limiting peaks. */
function normalizeLoudness(buffer, target) {
  const before = measureLoudness(buffer);
  if (!Number.isFinite(before)) throw new Error('This file is silent or too short to measure.');
  let out = limitPeaks(applyGain(cloneBuffer(buffer), dbToGain(target - before)), CEILING);
  // Heavy limiting lowers loudness a little, so make one correction pass.
  const shortfall = target - measureLoudness(out);
  if (shortfall > 0.3) out = limitPeaks(applyGain(out, dbToGain(shortfall)), CEILING);
  return { out, before: formatLufs(before), after: formatLufs(measureLoudness(out)), change: Math.abs(target - before) };
}

function normalizePeak(buffer) {
  const peak = gainToDb(peakLevel(buffer));
  if (!Number.isFinite(peak)) throw new Error('This file is silent.');
  const out = applyGain(cloneBuffer(buffer), dbToGain(CEILING - peak));
  return { out, before: `peak ${formatDb(peak)}`, after: `peak ${formatDb(CEILING)}`, change: Math.abs(CEILING - peak) };
}

runButton.addEventListener('click', async () => {
  const files = queue.items.map((item) => item.file);
  const target = $('input[name="target"]:checked').value;

  setStage('working');
  const results = await processAll(files, progress, 'Normalizing', async (file, onProgress) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const buffer = await decodeAudio(bytes, file.name);
    const info = isMp3(file) ? readTags(bytes) : null;
    const { out, before, after, change } = target === 'peak' ? normalizePeak(buffer) : normalizeLoudness(buffer, Number(target));

    if (change < 0.5 && info) {
      return { name: file.name, blob: file, meta: `${before} · already at the target, kept the original` };
    }
    const kbps = info ? Math.max(128, suggestBitrate(info.audioEnd - info.audioStart, buffer.duration)) : 192;
    let blob = await encodeMp3(out, { kbps, onProgress });
    if (info) blob = withTags(blob, info.tags);
    return { name: withSuffix(file.name, '-normalized', 'mp3'), blob, meta: `${before} → ${after} · ${formatBytes(blob.size)}` };
  });

  const ok = results.filter((r) => r.blob).length;
  const failed = results.length - ok;
  showResults(results, {
    title: ok ? `Your ${ok === 1 ? 'file has' : 'files have'} been normalized` : 'Normalizing failed',
    meta: failed ? `${ok} normalized, ${failed} couldn’t be processed.` : `Target: ${target === 'peak' ? `peaks at ${formatDb(CEILING)}` : formatLufs(Number(target))}`,
    zipName: 'normalized.zip',
  });
  setStage('done');
});

$('#back').addEventListener('click', () => setStage('edit'));
$('#restart').addEventListener('click', () => {
  queue.clear();
  setStage('upload');
});
