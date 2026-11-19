(() => {
  'use strict';
  const shell = document.querySelector('.app-shell');
  const toggle = document.querySelector('.rail-toggle');
  const key = 'seaguard.compactNavigation';
  let compact = false;
  try {
    compact = localStorage.getItem(key) === 'true';
  } catch {
    // Navigation remains usable when browser storage is unavailable.
  }

  function render() {
    shell.classList.toggle('is-compact', compact);
    toggle.setAttribute('aria-expanded', String(!compact));
    toggle.title = compact ? 'Разгъни навигацията' : 'Свий навигацията';
    toggle.setAttribute('aria-label', toggle.title);
  }

  render();
  toggle.hidden = false;
  toggle.addEventListener('click', () => {
    compact = !compact;
    render();
    try {
      localStorage.setItem(key, String(compact));
    } catch {
      // The current page still reflects the selected layout.
    }
  });
})();
