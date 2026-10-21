import { icon } from './icons.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// ---------------------------------------------------------------------------
// Formatting

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** 83.456 -> "1:23.5" (decimals = 1). Hours are added when needed. */
export function formatTime(seconds, decimals = 1) {
  if (!Number.isFinite(seconds)) return '–:––';
  const factor = 10 ** decimals;
  const total = Math.round(Math.max(0, seconds) * factor) / factor;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = (total % 60).toFixed(decimals).padStart(decimals ? decimals + 3 : 2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Parses "1:23.5", "83.5" or "1:02:03" into seconds. Returns null if invalid. */
export function parseTime(text) {
  const parts = text.trim().split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d*\.?\d+$/.test(p))) return null;
  return parts.reduce((total, part) => total * 60 + parseFloat(part), 0);
}

export const stripExtension = (name) => name.replace(/\.[^./]+$/, '');
export const withSuffix = (name, suffix, ext) => `${stripExtension(name)}${suffix}.${ext}`;

// ---------------------------------------------------------------------------
// File types

const AUDIO_EXT = /\.(mp3|wav|wave|ogg|oga|opus|flac|m4a|m4b|aac|aif|aiff|caf|weba|wma)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|3gp)$/i;

export const isMp3 = (file) => /^audio\/(mpeg|mp3)$/.test(file.type) || /\.mp3$/i.test(file.name);
export const isAudioFile = (file) => file.type.startsWith('audio/') || AUDIO_EXT.test(file.name);
export const isMediaFile = (file) => isAudioFile(file) || file.type.startsWith('video/') || VIDEO_EXT.test(file.name);

// ---------------------------------------------------------------------------
// Page stages: upload -> edit -> working -> done

export function setStage(name) {
  document.body.dataset.stage = name;
  for (const panel of $$('[data-stage-panel]')) panel.hidden = panel.dataset.stagePanel !== name;
  for (const media of $$('audio')) media.pause();
  window.scrollTo({ top: 0 });
}

export const currentStage = () => document.body.dataset.stage;

/**
 * Wires every [data-pick] button to the file input and accepts files dropped
 * anywhere on the page.
 */
export function setupFilePicker({ input, accept, onFiles }) {
  const handle = (files) => {
    const accepted = files.filter(accept);
    if (!accepted.length) {
      if (files.length) toast('That file type isn’t supported here.', 'error');
      return;
    }
    if (accepted.length < files.length) toast(`Skipped ${files.length - accepted.length} unsupported file(s).`);
    onFiles(input.multiple ? accepted : accepted.slice(0, 1));
  };

  for (const button of $$('[data-pick]')) button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    handle([...input.files]);
    input.value = '';
  });

  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  const canDrop = () => !['working', 'done'].includes(currentStage());
  let depth = 0;

  document.addEventListener('dragenter', (e) => {
    if (!hasFiles(e) || !canDrop()) return;
    e.preventDefault();
    depth++;
    document.body.classList.add('is-dragging');
  });
  document.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) document.body.classList.remove('is-dragging');
  });
  document.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('is-dragging');
    if (canDrop()) handle([...e.dataTransfer.files]);
  });
}

export function createProgress(panel) {
  const bar = $('.progress-bar span', panel);
  const label = $('.progress-label', panel);
  const pct = $('.progress-pct', panel);
  return {
    busy(text) {
      panel.classList.add('is-busy');
      bar.style.width = '';
      label.textContent = text;
    },
    set(fraction, text) {
      panel.classList.remove('is-busy');
      const percent = Math.round(clamp(fraction, 0, 1) * 100);
      bar.style.width = `${percent}%`;
      pct.textContent = `${percent}%`;
      if (text) label.textContent = text;
    },
  };
}

export function toast(message, type = 'info') {
  let host = $('.toasts');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    document.body.append(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message;
  host.append(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 300);
  }, 5000);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Points an <audio> element at a blob, releasing the previous object URL. */
export function previewBlob(audio, blob) {
  if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
  if (blob) audio.src = URL.createObjectURL(blob);
  else audio.removeAttribute('src');
}

// ---------------------------------------------------------------------------
// File lists

let nextId = 1;

function fileRow(name, meta, iconName = 'note') {
  const li = document.createElement('li');
  li.className = 'file-item';
  li.innerHTML = `
    <span class="file-icon">${icon(iconName)}</span>
    <div class="file-info"><div class="file-name"></div><div class="file-meta"></div></div>`;
  $('.file-name', li).textContent = name;
  $('.file-name', li).title = name;
  $('.file-meta', li).textContent = meta;
  return li;
}

/** An editable list of selected files, optionally reorderable. */
export class FileQueue {
  constructor(list, { reorder = false, onChange = () => {} } = {}) {
    this.list = list;
    this.reorder = reorder;
    this.onChange = onChange;
    this.items = [];
    list.classList.toggle('is-reorderable', reorder);
    if (reorder) this.#enableDragSort();
  }

  add(files) {
    const added = files.map((file) => {
      const item = { id: nextId++, file, el: fileRow(file.name, formatBytes(file.size)) };
      this.#decorate(item);
      return item;
    });
    this.items.push(...added);
    this.list.append(...added.map((item) => item.el));
    this.#changed();
    return added;
  }

  remove(item) {
    item.el.remove();
    this.items = this.items.filter((i) => i !== item);
    this.#changed();
  }

  clear() {
    for (const item of this.items) item.el.remove();
    this.items = [];
    this.#changed();
  }

  move(item, delta) {
    const from = this.items.indexOf(item);
    const to = from + delta;
    if (to < 0 || to >= this.items.length) return;
    [this.items[from], this.items[to]] = [this.items[to], this.items[from]];
    this.list.append(...this.items.map((i) => i.el));
    this.#changed();
  }

  sortByName() {
    this.items.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true }));
    this.list.append(...this.items.map((i) => i.el));
    this.#changed();
  }

  setMeta(item, text, isError = false) {
    $('.file-meta', item.el).textContent = text;
    item.el.classList.toggle('is-error', isError);
  }

  #decorate(item) {
    const { el } = item;
    if (this.reorder) {
      el.draggable = true;
      el.insertAdjacentHTML('afterbegin', `<span class="file-grip">${icon('grip')}</span>`);
      $('.file-icon', el).innerHTML = '<span class="file-index"></span>';
    }
    const actions = document.createElement('div');
    actions.className = 'file-actions';
    actions.innerHTML = `${
      this.reorder
        ? `<button type="button" class="icon-btn" data-act="up" aria-label="Move up">${icon('up')}</button>
           <button type="button" class="icon-btn" data-act="down" aria-label="Move down">${icon('down')}</button>`
        : ''
    }<button type="button" class="icon-btn" data-act="remove" aria-label="Remove ${item.file.name}">${icon('x')}</button>`;
    actions.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'remove') this.remove(item);
      else if (act === 'up') this.move(item, -1);
      else if (act === 'down') this.move(item, 1);
    });
    el.append(actions);
  }

  #enableDragSort() {
    let dragged = null;
    this.list.addEventListener('dragstart', (e) => {
      dragged = e.target.closest('.file-item');
      if (!dragged) return;
      dragged.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
    });
    this.list.addEventListener('dragover', (e) => {
      if (!dragged) return;
      e.preventDefault();
      const over = e.target.closest('.file-item');
      if (!over || over === dragged) return;
      const rect = over.getBoundingClientRect();
      over[e.clientY > rect.top + rect.height / 2 ? 'after' : 'before'](dragged);
    });
    this.list.addEventListener('drop', (e) => {
      if (dragged) e.preventDefault();
    });
    this.list.addEventListener('dragend', () => {
      if (!dragged) return;
      dragged.classList.remove('is-dragging');
      dragged = null;
      const order = [...this.list.children];
      this.items.sort((a, b) => order.indexOf(a.el) - order.indexOf(b.el));
      this.#changed();
    });
  }

  #changed() {
    if (this.reorder) this.items.forEach((item, i) => ($('.file-index', item.el).textContent = i + 1));
    this.onChange(this.items);
  }
}

/** Renders finished files: [{ name, meta, blob?, error? }]. */
export function renderResults(list, results) {
  list.replaceChildren(
    ...results.map((result) => {
      const li = fileRow(result.name, result.meta, result.error ? 'alert' : 'note');
      li.classList.toggle('is-error', Boolean(result.error));
      if (result.blob) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-secondary btn-sm';
        button.innerHTML = `${icon('download')}<span>Download</span>`;
        button.addEventListener('click', () => downloadBlob(result.blob, result.name));
        li.append(button);
      }
      return li;
    }),
  );
}
