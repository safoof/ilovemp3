import { CATEGORIES, TOOLS } from './tools.js';
import { icon } from './icons.js';

const root = document.documentElement.dataset.root || '.';
const current = document.body.dataset.tool;
const link = (tool) => `${root}/${tool.slug}/`;
const currentAttr = (tool) => (tool.slug === current ? ' aria-current="page"' : '');

function menuGroups() {
  return CATEGORIES.filter((c) => c.id !== 'all')
    .map((category) => {
      const tools = TOOLS.filter((t) => t.category === category.id);
      if (!tools.length) return '';
      return `
        <div class="menu-group">
          <h3>${category.label}</h3>
          ${tools
            .map(
              (t) => `<a class="menu-item" href="${link(t)}"${currentAttr(t)}>
                <span class="menu-icon" style="--tool-color: ${t.color}">${icon(t.icon)}</span>${t.name}</a>`,
            )
            .join('')}
        </div>`;
    })
    .join('');
}

const header = document.querySelector('[data-site-header]');
if (header) {
  header.innerHTML = `
    <div class="container header-inner">
      <a class="logo" href="${root}/" aria-label="iLoveMP3 home">I${icon('heart')}MP3</a>
      <nav class="nav" aria-label="Popular tools">
        ${TOOLS.filter((t) => t.featured)
          .map((t) => `<a href="${link(t)}"${currentAttr(t)}>${t.short}</a>`)
          .join('')}
      </nav>
      <div class="menu">
        <button type="button" class="menu-button" aria-expanded="false" aria-controls="tools-menu">
          ${icon('grid')}<span>All tools</span>${icon('down')}
        </button>
        <div class="menu-panel" id="tools-menu" hidden>
          <div class="menu-grid">${menuGroups()}</div>
        </div>
      </div>
    </div>`;

  const button = header.querySelector('.menu-button');
  const panel = header.querySelector('.menu-panel');
  const setOpen = (open) => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', () => setOpen(panel.hidden));
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !e.target.closest('.menu')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      setOpen(false);
      button.focus();
    }
  });
}

const footer = document.querySelector('[data-site-footer]');
if (footer) {
  footer.innerHTML = `
    <div class="container footer-inner">
      <p>${icon('lock')} Your files are processed in your browser and never uploaded.</p>
      <p>© ${new Date().getFullYear()} iLoveMP3 · MP3 encoding by <a href="https://lame.sourceforge.io/">LAME</a></p>
    </div>`;
}
