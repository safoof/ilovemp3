import { $, bindRange, effectTool } from '../effect-tool.js';
import { applyGain, cloneBuffer, dbToGain, gainToDb, limitPeaks, measureLoudness, peakLevel } from '../dsp.js';

let analysis = { peak: 1, loudness: -Infinity };

const formatDb = (db) => `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`;

const tool = effectTool({
  panelTitle: 'Volume',
  runLabel: 'Change volume',
  workingLabel: 'Adjusting the volume…',
  doneTitle: 'Your MP3 is ready',
  suffix: () => (Number($('#gain').value) >= 0 ? '-louder' : '-quieter'),
  onLoad(source) {
    analysis = { peak: peakLevel(source.buffer), loudness: measureLoudness(source.buffer) };
  },
  stats() {
    const loudness = Number.isFinite(analysis.loudness) ? ` · loudness ${analysis.loudness.toFixed(1)} LUFS` : '';
    return `Loudest peak: ${formatDb(gainToDb(analysis.peak))}${loudness}`;
  },
  summary() {
    const db = Number($('#gain').value);
    const peakAfter = gainToDb(analysis.peak) + db;
    if (peakAfter <= 0) return `The loudest peak will be at ${formatDb(peakAfter)}.`;
    return $('#limiter').checked
      ? 'The loudest parts will be gently limited so they don’t distort.'
      : 'Warning: the loudest parts will distort at this volume.';
  },
  async process(buffer) {
    const out = applyGain(cloneBuffer(buffer), dbToGain(Number($('#gain').value)));
    return $('#limiter').checked ? limitPeaks(out, -1) : out;
  },
});

bindRange($('#gain'), $('#gain-value'), (db) => `${formatDb(db)} · ${Math.round(dbToGain(db) * 100)}%`);
$('#gain').addEventListener('input', tool.refresh);
$('#limiter').addEventListener('change', tool.refresh);
$('#maximize').addEventListener('click', () => {
  const db = Math.max(-20, Math.min(30, Math.floor((-1 - gainToDb(analysis.peak)) * 2) / 2));
  $('#gain').value = String(db);
  $('#gain').dispatchEvent(new Event('input'));
});
