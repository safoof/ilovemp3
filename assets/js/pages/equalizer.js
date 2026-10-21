import { $, effectTool } from '../effect-tool.js';
import { EQ_BANDS, equalize, limitPeaks } from '../dsp.js';

const PRESETS = {
  bass: { label: 'Bass boost', gains: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0] },
  extraBass: { label: 'Extra bass', gains: [11, 10, 8, 5, 1, 0, 0, 0, 0, 0] },
  treble: { label: 'Treble boost', gains: [0, 0, 0, 0, 0, 0, 2, 4, 6, 7] },
  vocal: { label: 'Clear vocals', gains: [-4, -3, -2, 0, 1, 3, 4, 3, 1, 0] },
  loudness: { label: 'Loudness', gains: [6, 5, 3, 0, -1, -1, 0, 2, 4, 5] },
  lessBass: { label: 'Reduce bass', gains: [-9, -8, -6, -3, -1, 0, 0, 0, 0, 0] },
  flat: { label: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
};

let activePreset = 'bass';

const tool = effectTool({
  panelTitle: 'Equalizer',
  runLabel: 'Apply equalizer',
  workingLabel: 'Applying the equalizer…',
  doneTitle: 'Your MP3 is ready',
  suffix: () => (activePreset && activePreset !== 'flat' ? `-${PRESETS[activePreset].label.toLowerCase().replace(/\s+/g, '-')}` : '-eq'),
  summary: () => (activePreset ? `${PRESETS[activePreset].label} preset` : 'Custom settings'),
  async process(buffer) {
    // Boosting adds energy, so limit the peaks to avoid distortion.
    return limitPeaks(await equalize(buffer, gains()), -1);
  },
});

const sliders = buildSliders();

function buildSliders() {
  const container = $('#eq');
  return EQ_BANDS.map((frequency) => {
    const label = frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);
    const band = document.createElement('label');
    band.className = 'eq-band';
    band.innerHTML = `
      <output class="eq-value"></output>
      <input type="range" min="-12" max="12" step="1" value="0" aria-label="${label} Hz" />
      <span class="eq-freq">${label}</span>`;
    container.append(band);
    const input = band.querySelector('input');
    const output = band.querySelector('output');
    input.addEventListener('input', () => {
      output.textContent = formatGain(Number(input.value));
      setPreset(null);
    });
    return { input, output };
  });
}

const formatGain = (db) => (db > 0 ? `+${db}` : db < 0 ? `−${-db}` : '0');
const gains = () => sliders.map(({ input }) => Number(input.value));

function setPreset(id) {
  activePreset = id;
  if (id) {
    PRESETS[id].gains.forEach((gain, i) => {
      sliders[i].input.value = String(gain);
      sliders[i].output.textContent = formatGain(gain);
    });
  }
  for (const chip of $('#eq-presets').children) chip.setAttribute('aria-pressed', String(chip.dataset.preset === id));
  tool.refresh();
}

$('#eq-presets').innerHTML = Object.entries(PRESETS)
  .map(([id, preset]) => `<button type="button" class="chip chip-sm" data-preset="${id}">${preset.label}</button>`)
  .join('');
$('#eq-presets').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-preset]');
  if (chip) setPreset(chip.dataset.preset);
});

setPreset('bass');
