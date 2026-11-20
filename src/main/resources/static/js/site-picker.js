// Searchable site picker grouped by risk. Usage:
//   const picker = SitePicker.create(element, {sites, onSelect: id => ...}); picker.set(id);
window.SitePicker = (() => {
  'use strict';
  const GROUPS = [
    {keys: ['high', 'elevated'], label: 'Висок и повишен риск'},
    {keys: ['watch'], label: 'Под наблюдение'},
    {keys: ['low'], label: 'Нисък риск'},
    {keys: [undefined, null, 'unknown'], label: 'Участъци без заредена оценка'}
  ];

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function create(root, {sites, onSelect, allLabel, label}) {
    let current = null, open = false, active = -1, rows = [];
    root.classList.add('picker');
    const trigger = el('button', 'picker-trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const dot = el('i', 'picker-dot');
    const name = el('span', 'picker-name', allLabel || 'Избери участък');
    const score = el('span', 'picker-score');
    const chevron = el('span', 'picker-chevron');
    chevron.innerHTML = '<svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg>';
    trigger.append(dot, name, score, chevron);
    if (label) trigger.setAttribute('aria-label', `${label} · ${name.textContent}`);

    const pop = el('div', 'picker-pop');
    pop.hidden = true;
    const search = el('input', 'picker-search');
    search.type = 'search';
    search.placeholder = 'Търси сред ' + sites.length + ' участъка';
    search.setAttribute('aria-label', 'Търси участък');
    const list = el('div', 'picker-list');
    list.setAttribute('role', 'listbox');
    pop.append(search, list);
    root.append(trigger, pop);

    function render() {
      const q = search.value.trim().toLocaleLowerCase('bg');
      list.replaceChildren();
      rows = [];
      if (allLabel && !q) {
        const all = el('button', 'picker-row', allLabel);
        all.type = 'button';
        all.classList.add('picker-all');
        all.setAttribute('role', 'option');
        all.setAttribute('aria-selected', String(current == null));
        all.addEventListener('click', () => choose(null));
        list.append(all);
        rows.push(all);
      }
      for (const g of GROUPS) {
        const items = sites.filter(s => g.keys.includes(s.statusKey) && (!q || s.name.toLocaleLowerCase('bg').includes(q)));
        if (!items.length) continue;
        list.append(el('div', 'picker-group', `${g.label} · ${items.length}`));
        for (const s of items) {
          const row = el('button', 'picker-row');
          row.type = 'button';
          row.setAttribute('role', 'option');
          row.setAttribute('aria-selected', String(s.id === current));
          const d = el('i', 'picker-dot');
          if (s.statusKey) d.style.background = `var(--marker-${s.statusKey})`;
          const text = el('span', 'picker-text');
          text.append(el('strong', null, s.name), el('small', null, s.topThreat && s.topThreat !== '—' ? s.topThreat : s.status));
          row.append(d, text, el('span', 'picker-row-score', s.riskScore));
          row.addEventListener('click', () => choose(s.id));
          row.addEventListener('mousemove', () => highlight(rows.indexOf(row)));
          list.append(row);
          rows.push(row);
        }
      }
      if (!rows.length) list.append(el('p', 'picker-empty', 'Няма съвпадения. Промени търсенето или го изчисти.'));
      highlight(Math.max(0, rows.findIndex(r => r.getAttribute('aria-selected') === 'true')));
    }

    function highlight(i) {
      rows.forEach((r, j) => r.classList.toggle('is-active', j === i));
      active = i;
      const row = rows[i];
      if (!row) return;
      const top = row.offsetTop - list.offsetTop;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = top + row.offsetHeight - list.clientHeight;
      }
    }

    function setOpen(state) {
      open = state;
      pop.hidden = !state;
      trigger.setAttribute('aria-expanded', String(state));
      if (state) { search.value = ''; render(); search.focus(); }
    }

    function choose(id) {
      set(id);
      setOpen(false);
      trigger.focus();
      onSelect?.(id);
    }

    function set(id) {
      const s = sites.find(x => x.id === id);
      if (!s && id != null) return;
      current = id;
      name.textContent = s?.name || allLabel || 'Избери участък';
      dot.style.background = s?.statusKey ? `var(--marker-${s.statusKey})` : '';
      score.textContent = s?.riskScore == null ? '' : s.riskScore + '/100';
      if (label) trigger.setAttribute('aria-label', `${label} · ${name.textContent}`);
    }

    trigger.addEventListener('click', () => setOpen(!open));
    search.addEventListener('input', render);
    pop.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(rows.length - 1, active + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(0, active - 1)); }
      else if (e.key === 'Enter' && rows[active]) { e.preventDefault(); rows[active].click(); }
      else if (e.key === 'Escape') { setOpen(false); trigger.focus(); }
    });
    document.addEventListener('mousedown', e => { if (open && !root.contains(e.target)) setOpen(false); });
    return {
      set,
      updateSites(next) {
        sites = next;
        search.placeholder = 'Търси сред ' + sites.length + ' участъка';
        set(current);
        if (open) render();
      }
    };
  }
  return {create};
})();
