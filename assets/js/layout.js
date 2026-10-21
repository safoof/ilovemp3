import { TOOLS } from './tools.js';
import { icon } from './icons.js';

const root = document.documentElement.dataset.root || '.';
const current = document.body.dataset.tool;

const header = document.querySelector('[data-site-header]');
if (header) {
  header.innerHTML = `
    <div class="container header-inner">
      <a class="logo" href="${root}/" aria-label="iLoveMP3 home">I${icon('heart')}MP3</a>
      <nav class="nav" aria-label="Tools">
        ${TOOLS.map((t) => `<a href="${root}/${t.slug}/"${t.slug === current ? ' aria-current="page"' : ''}>${t.short}</a>`).join('')}
      </nav>
      <a class="nav-all btn btn-secondary" href="${root}/#tools">All tools</a>
    </div>`;
}

const footer = document.querySelector('[data-site-footer]');
if (footer) {
  footer.innerHTML = `
    <div class="container footer-inner">
      <p>${icon('lock')} Your files are processed in your browser and never uploaded.</p>
      <p>© ${new Date().getFullYear()} iLoveMP3 · MP3 encoding by <a href="https://lame.sourceforge.io/">LAME</a></p>
    </div>`;
}
