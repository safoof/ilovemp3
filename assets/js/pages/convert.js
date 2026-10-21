import '../layout.js';
import { $, FileQueue, createProgress, formatBytes, formatTime, isMediaFile, setStage, setupFilePicker, withSuffix } from '../ui.js';
import { decodeAudio, encodeMp3, encodeWav, probeDuration, render } from '../audio.js';
import { bindDownload, processAll, showResults } from '../batch.js';

const progress = createProgress($('[data-stage-panel="working"]'));
const runButton = $('#run');
const queue = new FileQueue($('#file-list'), { onChange: refresh });

setupFilePicker({ input: $('#file-input'), accept: isMediaFile, onFiles: add });
bindDownload();

async function add(files) {
  const items = queue.add(files);
  setStage('edit');
  for (const item of items) {
    probeDuration(item.file).then((duration) => {
      if (duration) queue.setMeta(item, `${formatTime(duration, 0)} · ${formatBytes(item.file.size)}`);
    });
  }
}

function refresh() {
  if (!queue.items.length && document.body.dataset.stage === 'edit') setStage('upload');
  runButton.disabled = !queue.items.length;
}

const format = () => $('input[name="format"]:checked').value;

function updateFormat() {
  const wav = format() === 'wav';
  $('#bitrate-field').hidden = wav;
  $('#format-help').textContent = wav
    ? 'WAV is uncompressed: perfect quality, but files are about 10 times bigger than MP3.'
    : 'MP3 plays everywhere. 192 kbps sounds great for music; use 128 kbps for speech.';
  runButton.textContent = `Convert to ${wav ? 'WAV' : 'MP3'}`;
}

for (const radio of document.querySelectorAll('input[name="format"]')) radio.addEventListener('change', updateFormat);
updateFormat();

runButton.addEventListener('click', async () => {
  const files = queue.items.map((item) => item.file);
  const wav = format() === 'wav';
  const kbps = Number($('#bitrate').value);

  setStage('working');
  const results = await processAll(files, progress, 'Converting', async (file, onProgress) => {
    const buffer = await decodeAudio(file);
    let blob;
    if (wav) {
      blob = encodeWav(await render(buffer, { channels: Math.min(2, buffer.numberOfChannels) }));
      onProgress(1);
    } else {
      blob = await encodeMp3(buffer, { kbps, onProgress });
    }
    return {
      name: withSuffix(file.name, '', wav ? 'wav' : 'mp3'),
      blob,
      meta: `${formatTime(buffer.duration, 0)} · ${formatBytes(blob.size)}`,
    };
  });

  const converted = results.filter((r) => r.blob).length;
  const failed = results.length - converted;
  showResults(results, {
    title: converted ? `Your ${converted === 1 ? 'file has' : 'files have'} been converted` : 'Conversion failed',
    meta: failed ? `${converted} converted, ${failed} couldn’t be read.` : `${converted} ${wav ? 'WAV' : 'MP3'} file${converted === 1 ? '' : 's'} ready.`,
    zipName: 'converted.zip',
  });
  setStage('done');
});

$('#back').addEventListener('click', () => setStage('edit'));
$('#restart').addEventListener('click', () => {
  queue.clear();
  setStage('upload');
});
