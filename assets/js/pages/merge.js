import '../layout.js';
import { $, FileQueue, createProgress, downloadBlob, formatBytes, formatTime, isAudioFile, previewBlob, setStage, setupFilePicker, toast } from '../ui.js';
import { Mp3Writer, decodeAudio, probeDuration } from '../audio.js';

const progress = createProgress($('[data-stage-panel="working"]'));
const runButton = $('#run');
const queue = new FileQueue($('#file-list'), { reorder: true, onChange: refresh });
let result = null;

setupFilePicker({ input: $('#file-input'), accept: isAudioFile, onFiles: add });

async function add(files) {
  const items = queue.add(files);
  setStage('edit');
  await Promise.all(
    items.map(async (item) => {
      item.duration = await probeDuration(item.file);
      queue.setMeta(item, `${item.duration ? `${formatTime(item.duration, 0)} · ` : ''}${formatBytes(item.file.size)}`);
    }),
  );
  refresh();
}

function refresh() {
  const count = queue.items.length;
  if (!count && document.body.dataset.stage === 'edit') setStage('upload');
  const total = queue.items.reduce((sum, item) => sum + (item.duration ?? 0), 0);
  runButton.disabled = count < 2;
  $('#summary').textContent =
    count < 2 ? 'Add at least two files to merge.' : `${count} files${total ? ` · about ${formatTime(total, 0)} in total` : ''}`;
}

$('#sort').addEventListener('click', () => queue.sortByName());

runButton.addEventListener('click', async () => {
  const items = [...queue.items];
  const gap = Number($('#gap').value);
  const writer = new Mp3Writer({ kbps: Number($('#bitrate').value), channels: 2 });
  let duration = 0;

  setStage('working');
  try {
    for (const [i, item] of items.entries()) {
      progress.set(i / items.length, `Merging file ${i + 1} of ${items.length}…`);
      // Decode one file at a time so long merges don't use too much memory.
      const buffer = await decodeAudio(item.file);
      await writer.write(buffer, (p) => progress.set((i + p) / items.length));
      duration += buffer.duration;
      if (gap && i < items.length - 1) {
        await writer.writeSilence(gap);
        duration += gap;
      }
    }
    const blob = await writer.finish();
    result = { blob, name: 'merged.mp3' };
    $('#result-meta').textContent = `${items.length} files · ${formatTime(duration, 0)} · ${formatBytes(blob.size)}`;
    previewBlob($('#result-audio'), blob);
    setStage('done');
  } catch (err) {
    writer.abort();
    toast(err.message, 'error');
    setStage('edit');
  }
});

$('#download').addEventListener('click', () => downloadBlob(result.blob, result.name));
$('#back').addEventListener('click', () => setStage('edit'));
$('#restart').addEventListener('click', () => {
  queue.clear();
  setStage('upload');
});
