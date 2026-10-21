import '../layout.js';
import { CATEGORIES, TOOLS } from '../tools.js';
import { icon } from '../icons.js';
import { $ } from '../ui.js';

const filters = $('.filters');
const grid = $('.tool-grid');

grid.innerHTML = TOOLS.map(
  (tool) => `
    <a class="tool-card" href="${tool.slug}/" data-category="${tool.category}" style="--tool-color: ${tool.color}">
      <span class="tool-icon">${icon(tool.icon)}</span>
      <h2>${tool.name}</h2>
      <p>${tool.description}</p>
    </a>`,
).join('');

const used = new Set(TOOLS.map((t) => t.category));
filters.innerHTML = CATEGORIES.filter((c) => c.id === 'all' || used.has(c.id))
  .map((c) => `<button type="button" class="chip" data-filter="${c.id}" aria-pressed="${c.id === 'all'}">${c.label}</button>`)
  .join('');

filters.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-filter]');
  if (!chip) return;
  for (const other of filters.children) other.setAttribute('aria-pressed', String(other === chip));
  for (const card of grid.children) card.hidden = chip.dataset.filter !== 'all' && card.dataset.category !== chip.dataset.filter;
});
