// Shared interactive map: satellite / street base maps, wheel zoom, full screen, fit-to-coast and scale.
// Usage: const {map} = SeaMap.create('map', {onReset: () => ...});
window.SeaMap = (() => {
  'use strict';
  const BLACK_SEA_BG = [[41.95, 27.35], [43.75, 28.65]];

  function baseLayers() {
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, maxNativeZoom: 18, attribution: 'Сателит © Esri, Maxar, Earthstar Geographics'
    });
    const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap'
    });
    return {satellite, street};
  }

  function button(html, title, onClick) {
    const b = L.DomUtil.create('button', 'seamap-btn');
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = html;
    L.DomEvent.disableClickPropagation(b);
    L.DomEvent.on(b, 'click', e => { L.DomEvent.preventDefault(e); onClick(b); });
    return b;
  }

  const ICONS = {
    expand: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    collapse: '<svg viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
    home: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg>'
  };

  function create(id, options = {}) {
    const el = document.getElementById(id);
    const map = L.map(el, {scrollWheelZoom: true, zoomSnap: 1, wheelPxPerZoomLevel: 110, zoomControl: false, attributionControl: true});
    map.fitBounds(options.bounds || BLACK_SEA_BG);
    const layers = baseLayers();
    let current = options.base === 'street' ? 'street' : 'satellite';
    layers[current].addTo(map);
    el.classList.toggle('is-satellite', current === 'satellite');

    L.control.zoom({position: 'topleft', zoomInTitle: 'Приближи', zoomOutTitle: 'Отдалечи'}).addTo(map);
    L.control.scale({imperial: false, position: 'bottomleft'}).addTo(map);

    // Base-map switch.
    const Switch = L.Control.extend({
      onAdd() {
        const box = L.DomUtil.create('div', 'seamap-switch');
        L.DomEvent.disableClickPropagation(box);
        for (const [key, label] of [['satellite', 'Сателит'], ['street', 'Карта']]) {
          const b = L.DomUtil.create('button', '', box);
          b.type = 'button';
          b.textContent = label;
          b.setAttribute('aria-pressed', String(key === current));
          L.DomEvent.on(b, 'click', () => {
            if (key === current) return;
            map.removeLayer(layers[current]);
            current = key;
            layers[current].addTo(map);
            el.classList.toggle('is-satellite', current === 'satellite');
            box.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
          });
        }
        return box;
      }
    });
    new Switch({position: 'topright'}).addTo(map);

    // Full screen and reset view.
    const shell = el.closest('.map-shell') || el;
    const Tools = L.Control.extend({
      onAdd() {
        const box = L.DomUtil.create('div', 'seamap-tools');
        box.append(button(ICONS.home, options.resetLabel || 'Цялото крайбрежие', () => {
          if (options.onReset) options.onReset(map); else map.fitBounds(options.bounds || BLACK_SEA_BG);
        }));
        const toggle = button(ICONS.expand, 'Цял екран', () => setFull(!shell.classList.contains('is-fullscreen')));
        box.append(toggle);
        function setFull(on) {
          shell.classList.toggle('is-fullscreen', on);
          document.body.classList.toggle('has-fullscreen-map', on);
          toggle.innerHTML = on ? ICONS.collapse : ICONS.expand;
          toggle.title = on ? 'Изход от цял екран (Esc)' : 'Цял екран';
          setTimeout(() => map.invalidateSize({pan: false}), 60);
        }
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && shell.classList.contains('is-fullscreen')) setFull(false); });
        return box;
      }
    });
    new Tools({position: 'topleft'}).addTo(map);
    return {map};
  }

  /** Colour for an AI ecologist status key. */
  const RISK = {high: '#ff3b30', elevated: '#ff9f0a', watch: '#ffcc00', low: '#34c759'};
  const RISK_LABEL = {high: 'Висок риск', elevated: 'Повишен риск', watch: 'Под наблюдение', low: 'Нисък риск'};
  return {create, RISK, RISK_LABEL};
})();
