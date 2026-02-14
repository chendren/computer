const LCARS_COLORS = [
  '#FF9900', '#CC99CC', '#9999FF', '#FF9966',
  '#CC6699', '#99CCFF', '#FFCC00',
];

export function getLcarsColor(index) {
  return LCARS_COLORS[index % LCARS_COLORS.length];
}

export function createEl(tag, className, content) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (content) {
    if (typeof content === 'string') {
      el.innerHTML = content;
    } else {
      el.appendChild(content);
    }
  }
  return el;
}

export function clearEmpty(container) {
  const empty = container.querySelector('.empty-state');
  if (empty) empty.remove();
}
