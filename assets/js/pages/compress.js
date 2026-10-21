import '../layout.js';
import { $, FileQueue, createProgress, formatBytes, isAudioFile, setStage, setupFilePicker, withSuffix } from '../ui.js';
import { decodeAudio, encodeMp3 } from '../audio.js';
import { readTags, withTags } from '../id3.js';
import { bindDownload, processAll, showResults } from '../batch.js';

const LEVELS = {
  light: { kbps: 192 },
  recommended: { kbps: 128 },
  strong: { kbps: 96 },
  extreme: { kbps: 48, sampleRate: 22050, mono: true },
};

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

const percentSmaller = (before, after) => Math.round((1 - after / before) * 100);

runButton.addEventListener('click', async () => {
  const files = queue.items.map((item) => item.file);
  const level = LEVELS[$('input[name="level"]:checked').value];

  setStage('working');
  const results = await processAll(files, progress, 'Compressing', async (file, onProgress) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { tags } = readTags(bytes);
    const buffer = await decodeAudio(bytes, file.name);
    const blob = withTags(await encodeMp3(buffer, { ...level, onProgress }), tags);

    // Re-encoding always costs a little quality, so it has to be worth it.
    if (blob.size > file.size * 0.95) {
      return { name: file.name, blob: file, before: file.size, after: file.size, meta: `${formatBytes(file.size)} · already well compressed, kept the original` };
    }
    return {
      name: withSuffix(file.name, '-compressed', 'mp3'),
      blob,
      before: file.size,
      after: blob.size,
      meta: `${formatBytes(file.size)} → ${formatBytes(blob.size)} (${percentSmaller(file.size, blob.size)}% smaller)`,
    };
  });

  const ok = results.filter((r) => r.blob);
  const before = ok.reduce((sum, r) => sum + r.before, 0);
  const after = ok.reduce((sum, r) => sum + r.after, 0);
  const saved = before ? percentSmaller(before, after) : 0;
  const failed = results.length - ok.length;

  let title = 'Compression failed';
  if (saved > 0) title = `Your ${ok.length === 1 ? 'MP3 is' : 'MP3s are'} now ${saved}% smaller`;
  else if (ok.length) title = `Your ${ok.length === 1 ? 'file is' : 'files are'} already well compressed`;

  showResults(results, {
    title,
    meta: [ok.length && `${formatBytes(before)} → ${formatBytes(after)}`, failed && `${failed} file${failed === 1 ? '' : 's'} couldn’t be read`]
      .filter(Boolean)
      .join(' · '),
    zipName: 'compressed.zip',
  });
  setStage('done');
});

$('#back').addEventListener('click', () => setStage('edit'));
$('#restart').addEventListener('click', () => {
  queue.clear();
  setStage('upload');
});
