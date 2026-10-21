import { $, bindRange, effectTool } from '../effect-tool.js';
import { shiftPitch } from '../dsp.js';

const INTERVALS = ['', 'half step', 'whole step', 'minor third', 'major third', 'fourth', 'tritone', 'fifth', 'minor sixth', 'major sixth', 'minor seventh', 'major seventh', 'octave'];

const semitones = () => Number($('#semitones').value);

function describe(value) {
  if (!value) return 'Original pitch';
  const sign = value > 0 ? '+' : '−';
  return `${sign}${Math.abs(value)} semitone${Math.abs(value) === 1 ? '' : 's'}`;
}

const tool = effectTool({
  panelTitle: 'Pitch',
  runLabel: 'Change pitch',
  workingLabel: 'Shifting the pitch…',
  doneTitle: 'Your MP3 is ready',
  suffix: () => `-pitch${semitones() > 0 ? '+' : ''}${semitones()}`,
  summary() {
    const value = semitones();
    if (!value) return 'Move the slider to change the key.';
    const interval = INTERVALS[Math.abs(value)];
    return `${value > 0 ? 'Up' : 'Down'} ${/^[aeiou]/.test(interval) ? 'an' : 'a'} ${interval}. The tempo stays the same.`;
  },
  process: (buffer, { onProgress }) => shiftPitch(buffer, semitones(), onProgress),
});

bindRange($('#semitones'), $('#pitch-value'), describe);
$('#semitones').addEventListener('input', tool.refresh);
document.querySelector('.stepper').addEventListener('click', (e) => {
  const button = e.target.closest('[data-step]');
  if (!button) return;
  const step = Number(button.dataset.step);
  $('#semitones').value = String(step ? semitones() + step : 0);
  $('#semitones').dispatchEvent(new Event('input'));
});
