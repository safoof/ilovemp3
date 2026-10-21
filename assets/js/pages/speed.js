import { $, bindRange, effectTool } from '../effect-tool.js';
import { changeRate, changeTempo } from '../dsp.js';
import { formatTime } from '../ui.js';

const speed = () => Number($('#speed').value);
const formatSpeed = (value) => `${Number(value.toFixed(2))}×`;

const tool = effectTool({
  panelTitle: 'Speed',
  runLabel: 'Change speed',
  workingLabel: 'Changing the speed…',
  doneTitle: 'Your MP3 is ready',
  suffix: () => `-${Number(speed().toFixed(2))}x`,
  summary: (source) => `New length: ${formatTime(source.buffer.duration / speed(), 0)} (was ${formatTime(source.buffer.duration, 0)})`,
  process(buffer, { onProgress }) {
    return $('#keep-pitch').checked ? changeTempo(buffer, speed(), onProgress) : changeRate(buffer, speed());
  },
});

bindRange($('#speed'), $('#speed-value'), formatSpeed);
$('#speed').addEventListener('input', tool.refresh);
$('#keep-pitch').addEventListener('change', tool.refresh);
$('#speed-presets').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-value]');
  if (!chip) return;
  $('#speed').value = chip.dataset.value;
  $('#speed').dispatchEvent(new Event('input'));
});
