import { $, bindRange, effectTool } from '../effect-tool.js';
import { addReverb, changeRate, limitPeaks } from '../dsp.js';
import { formatTime } from '../ui.js';

const STYLES = {
  slowed: { speed: 0.85, mix: 0.4, size: 3 },
  super: { speed: 0.7, mix: 0.5, size: 4.5 },
  nightcore: { speed: 1.25, mix: 0, size: 2 },
  spedup: { speed: 1.15, mix: 0.1, size: 1.5 },
};

const value = (id) => Number($(`#${id}`).value);

const tool = effectTool({
  panelTitle: 'Style',
  runLabel: 'Create my version',
  workingLabel: 'Creating your version…',
  doneTitle: 'Your new version is ready',
  suffix() {
    if (value('speed') < 1) return value('mix') > 0 ? '-slowed-reverb' : '-slowed';
    if (value('speed') > 1) return '-sped-up';
    return '-reverb';
  },
  summary: (source) => `New length: ${formatTime(source.buffer.duration / value('speed'), 0)}`,
  async process(buffer) {
    const slowed = await changeRate(buffer, value('speed'));
    const out = await addReverb(slowed, { mix: value('mix'), size: value('size') });
    return limitPeaks(out, -1);
  },
});

const updaters = [
  bindRange($('#speed'), $('#speed-value'), (v) => `${Number(v.toFixed(2))}×`),
  bindRange($('#mix'), $('#mix-value'), (v) => (v ? `${Math.round(v * 100)}%` : 'Off')),
  bindRange($('#size'), $('#size-value'), (v) => `${v} s`),
];

function selectStyle(id) {
  for (const chip of $('#styles').children) chip.setAttribute('aria-pressed', String(chip.dataset.style === id));
  if (id) {
    for (const [key, v] of Object.entries(STYLES[id])) $(`#${key}`).value = String(v);
    updaters.forEach((update) => update());
  }
  tool.refresh();
}

$('#styles').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-style]');
  if (chip) selectStyle(chip.dataset.style);
});
for (const id of ['speed', 'mix', 'size']) $(`#${id}`).addEventListener('input', () => selectStyle(null));

selectStyle('slowed');
