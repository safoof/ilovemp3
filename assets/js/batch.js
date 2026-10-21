// Shared flow for tools that process a list of files one after another.
import { icon } from './icons.js';
import { $, downloadBlob, renderResults } from './ui.js';
import { createZip } from './zip.js';

/**
 * Runs task(file, onProgress) for each file in turn. A failure only affects
 * that file: it is reported in the results instead of stopping the batch.
 */
export async function processAll(files, progress, verb, task) {
  const results = [];
  for (const [i, file] of files.entries()) {
    const label = files.length > 1 ? `${verb} file ${i + 1} of ${files.length}…` : `${verb} your file…`;
    progress.set(i / files.length, label);
    try {
      results.push(await task(file, (p) => progress.set((i + p) / files.length)));
    } catch (err) {
      results.push({ name: file.name, meta: err.message, error: true });
    }
  }
  return results;
}

let downloadAction = null;

/** Fills the done stage: #result-title, #result-meta, #download and #results. */
export function showResults(results, { title, meta, zipName }) {
  const ok = results.filter((r) => r.blob);
  const button = $('#download');
  $('#result-title').textContent = title;
  $('#result-meta').textContent = meta;
  renderResults($('#results'), results);
  $('#results').hidden = results.length < 2 && ok.length === results.length;

  button.hidden = ok.length === 0;
  if (ok.length === 1) {
    button.innerHTML = `${icon('download')}Download file`;
    downloadAction = () => downloadBlob(ok[0].blob, ok[0].name);
  } else {
    button.innerHTML = `${icon('download')}Download all (ZIP)`;
    downloadAction = async () => {
      button.disabled = true;
      try {
        downloadBlob(await createZip(ok), zipName);
      } finally {
        button.disabled = false;
      }
    };
  }
}

export function bindDownload() {
  $('#download').addEventListener('click', () => downloadAction?.());
}
