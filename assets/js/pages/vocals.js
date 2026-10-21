import { $, bindRange, effectTool } from '../effect-tool.js';
import { removeVocals, stereoWidth } from '../dsp.js';

const tool = effectTool({
  panelTitle: 'Vocal remover',
  runLabel: 'Remove vocals',
  workingLabel: 'Removing the vocals…',
  doneTitle: 'Your karaoke track is ready',
  suffix: '-instrumental',
  validate(source) {
    if (source.buffer.numberOfChannels < 2 || stereoWidth(source.buffer) < 0.02) {
      return 'This file is mono, so the vocals can’t be separated from the music. The vocal remover needs a stereo song.';
    }
    return null;
  },
  summary: () => 'Tip: compare the preview with the original to check the result.',
  process: (buffer) => removeVocals(buffer, { strength: Number($('#strength').value), keepBass: $('#keep-bass').checked }),
});

bindRange($('#strength'), $('#strength-value'), (value) => `${Math.round(value * 100)}%`);
$('#strength').addEventListener('input', tool.refresh);
$('#keep-bass').addEventListener('change', tool.refresh);
