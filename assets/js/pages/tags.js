import '../layout.js';
import { icon } from '../icons.js';
import { $, downloadBlob, formatBytes, formatTime, isMp3, previewBlob, setStage, setupFilePicker, toast } from '../ui.js';
import { GENRES, buildTag, looksLikeMp3, readTags } from '../id3.js';

const FIELDS = ['title', 'artist', 'albumArtist', 'album', 'year', 'track', 'genre', 'comment'];
const form = $('#tag-form');
const coverButton = $('#cover');
const coverInput = $('#cover-input');
const sourceAudio = $('#source-audio');

let source = null; // { file, bytes, info }
let cover = null; // { mime, data } | null
let coverUrl = null;
let result = null;

$('#genres').innerHTML = [...GENRES].sort().map((g) => `<option value="${g.replace(/&/g, '&amp;')}">`).join('');

setupFilePicker({ input: $('#file-input'), accept: isMp3, onFiles: ([file]) => load(file) });

async function load(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = readTags(bytes);
  if (!looksLikeMp3(bytes, info.audioStart)) {
    toast(`“${file.name}” doesn’t look like an MP3 file.`, 'error');
    return;
  }
  source = { file, bytes, info };

  for (const name of FIELDS) form.elements[name].value = info.tags[name] ?? '';
  setCover(info.tags.picture);

  $('#file-name').textContent = file.name;
  $('#file-info').textContent = formatBytes(file.size);
  previewBlob(sourceAudio, file);
  sourceAudio.onloadedmetadata = () => {
    $('#file-info').textContent = `${formatTime(sourceAudio.duration, 0)} · ${formatBytes(file.size)}`;
  };
  setStage('edit');
}

// Cover art -----------------------------------------------------------------

function setCover(picture) {
  cover = picture;
  if (coverUrl) URL.revokeObjectURL(coverUrl);
  coverUrl = picture ? URL.createObjectURL(new Blob([picture.data], { type: picture.mime })) : null;
  coverButton.innerHTML = coverUrl
    ? `<img alt="Cover art" src="${coverUrl}">`
    : `<span class="cover-empty">${icon('image')}Add cover art</span>`;
  $('#cover-save').hidden = !picture;
  $('#cover-remove').hidden = !picture;
}

/** Players reliably support JPEG and PNG covers, so anything else is converted to JPEG. */
async function readImage(file) {
  if (file.type === 'image/jpeg' || file.type === 'image/png') {
    return { mime: file.type, data: new Uint8Array(await file.arrayBuffer()) };
  }
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  return { mime: 'image/jpeg', data: new Uint8Array(await blob.arrayBuffer()) };
}

coverButton.addEventListener('click', () => coverInput.click());
$('#cover-change').addEventListener('click', () => coverInput.click());
$('#cover-remove').addEventListener('click', () => setCover(null));
$('#cover-save').addEventListener('click', () => {
  const ext = cover.mime === 'image/png' ? 'png' : 'jpg';
  downloadBlob(new Blob([cover.data], { type: cover.mime }), `cover.${ext}`);
});
coverInput.addEventListener('change', async () => {
  const file = coverInput.files[0];
  coverInput.value = '';
  if (!file) return;
  try {
    setCover(await readImage(file));
  } catch {
    toast('That image couldn’t be opened. Try a JPEG or PNG.', 'error');
  }
});

// Saving --------------------------------------------------------------------

function finish(tagBytes, title) {
  const { bytes, info, file } = source;
  const blob = new Blob([tagBytes, bytes.subarray(info.audioStart, info.audioEnd)], { type: 'audio/mpeg' });
  result = { blob, name: file.name };
  $('#result-title').textContent = title;
  $('#result-meta').textContent = `${result.name} · ${formatBytes(blob.size)}`;
  setStage('done');
}

$('#run').addEventListener('click', () => {
  const tags = { ...source.info.tags, picture: cover };
  for (const name of FIELDS) tags[name] = form.elements[name].value;
  finish(buildTag(tags), 'Your tags have been saved');
});

$('#strip').addEventListener('click', () => finish(new Uint8Array(0), 'All tags have been removed'));

$('#download').addEventListener('click', () => downloadBlob(result.blob, result.name));
$('#back').addEventListener('click', () => setStage('edit'));
