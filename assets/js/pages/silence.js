import { $, effectTool } from '../effect-tool.js';
import { cutRanges, findSilences, silenceCuts } from '../dsp.js';
import { formatTime } from '../ui.js';

function settings() {
  const shortenPauses = $('input[name="mode"]:checked').value === 'all';
  const keepPause = Number($('#keep-pause').value);
  return {
    shortenPauses,
    keepPause,
    thresholdDb: Number($('#threshold').value),
    // Edges only: any silence counts. Pauses: only ones longer than we keep.
    minLength: shortenPauses ? keepPause : 0.1,
  };
}

function cutsFor(buffer) {
  const options = settings();
  return silenceCuts(buffer.duration, findSilences(buffer, options), options);
}

let cuts = [];

const tool = effectTool({
  panelTitle: 'Silence',
  runLabel: 'Remove silence',
  workingLabel: 'Removing silence…',
  doneTitle: 'Silence removed',
  suffix: '-trimmed',
  summary(source) {
    cuts = cutsFor(source.buffer);
    const removed = cuts.reduce((sum, cut) => sum + cut.end - cut.start, 0);
    if (removed < 0.05) return 'No silence found with these settings. Try counting quieter parts as silence.';
    return `Removes ${formatTime(removed, 1)} in ${cuts.length} place${cuts.length === 1 ? '' : 's'}. New length: ${formatTime(source.buffer.duration - removed, 0)}.`;
  },
  async process(buffer, { preview }) {
    if (!preview) {
      if (!cuts.length) throw new Error('No silence found with these settings.');
      return cutRanges(buffer, cuts);
    }
    return cutRanges(buffer, cutsFor(buffer));
  },
});

function update() {
  $('#pause-field').hidden = !settings().shortenPauses;
  tool.refresh();
}

for (const el of document.querySelectorAll('input[name="mode"], #keep-pause, #threshold')) el.addEventListener('change', update);
update();
