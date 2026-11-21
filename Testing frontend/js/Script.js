/* ===== 1. Hero fish + seaweed/seagrass: scroll down = move along a path, scroll up = move back ===== */
(() => {
  const fishLayer = document.getElementById('fishLayer');
  const plantLayer = document.getElementById('plantLayer');
  const hero = document.getElementById('hero');
  if (!fishLayer || !plantLayer) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // x/y = start position (% of hero), w = width px, dx/dy = travel in px over one hero height,
  // rot = extra rotation in deg, c = fish color. Edit freely.
  const FISH = [
    { x: 8,  y: 22, w: 90,  dx:  520, dy:  120, rot:  10, c: '#1fb6c1' },
    { x: 78, y: 15, w: 70,  dx: -480, dy:  200, rot: -12, c: '#7fd1a8' },
    { x: 20, y: 70, w: 120, dx:  640, dy: -160, rot:  -8, c: '#e8f6f8' },
    { x: 85, y: 62, w: 100, dx: -560, dy: -120, rot:   8, c: '#1fb6c1' },
    { x: 45, y: 88, w: 60,  dx:  300, dy: -260, rot: -15, c: '#7fd1a8' },
    { x: 60, y: 8,  w: 50,  dx: -260, dy:  300, rot:  14, c: '#e8f6f8' },
    { x: 5,  y: 48, w: 55,  dx:  420, dy:   60, rot:   6, c: '#7fd1a8' },
    { x: 92, y: 85, w: 75,  dx: -700, dy: -200, rot: -6,  c: '#1fb6c1' }
  ];

  // Kelp stays rooted at the bottom. w/h = size px, dx/dy = drift px,
  // rot = lean deg, sc = how much it shrinks (0-1) over one hero height.
  const PLANTS = [
  ];

  // Seagrass grows out sideways from under the sidebar edge. y = % down the hero, w = blade length px,
  // flip = mirror vertically, sc = how far it retracts under the sidebar while scrolling.
  const SIDE_GRASS = [
    {y: 20, w: 210, flip: 0, dx: 40, dy: -30, rot: -6, sc: .8, c: '#4fbf8f'},
    {y: 49, w: 190, flip: 0, dx: 30, dy: -20, rot: -5, sc: .8, c: '#7fd1a8'},
    {y: 78, w: 200, flip: 0, dx: 35, dy: -25, rot: -7, sc: .8, c: '#3aa57a'}
  ];

  // Natural-looking blades are generated, not hand-drawn: every blade has its own length, angle,
  // curve and width, and they all lean the same way like a gentle current. (viewBox 160x120, root at x=0,y=60)
  const rng = seed => () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  function makeBlades(seed, count = 13) {
    const r = rng(seed), out = [];
    for (let b = 0; b < count; b++) {
      const th = -0.55 + r() * 0.8;                 // start angle
      const bend = 0.1 + r() * 0.35;                // lean with the current
      const wob = (r() - .5) * 0.5;                 // little S-curve
      const base = 2.5 + r() * 3.5;                 // half width at the root
      const len = (65 + r() * 85) * (1 - Math.max(0, th + bend) * .3);
      const steps = 14, L = [], R = [];
      let x = 0, y = 60 + (r() - .5) * 10;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const ang = th + bend * t * t + wob * Math.sin(t * Math.PI * 1.5);
        const w = base * Math.pow(1 - t, .85);      // tapers to a point
        L.push([x - Math.sin(ang) * w, y + Math.cos(ang) * w]);
        R.push([x + Math.sin(ang) * w, y - Math.cos(ang) * w]);
        x += Math.cos(ang) * len / steps;
        y += Math.sin(ang) * len / steps;
      }
      const f = p => p[0].toFixed(1) + ' ' + p[1].toFixed(1);
      out.push({d: 'M' + L.map(f).join('L') + 'L' + R.reverse().map(f).join('L') + 'Z', len});
    }
    return out.sort((p, q) => q.len - p.len);        // long blades behind, short in front
  }

  // Everything is sized for 100%; --z (in the CSS) scales it, so JS sizes follow the page scale.
  const Z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1;
  [FISH, PLANTS, SIDE_GRASS].forEach(list => list.forEach(f => {
    ['w', 'h', 'dx', 'dy'].forEach(k => { if (f[k] != null) f[k] *= Z; });
  }));

  // Every moving thing gets a function that turns progress (0..1.6) into a transform.
  const items = [];

  FISH.forEach((f, i) => {
    const el = document.createElement('div');
    el.className = 'fish' + (f.dx > 0 ? ' flip' : '');   // symbol faces left, flip when heading right
    el.style.cssText = `left:${f.x}%;top:${f.y}%;width:${f.w}px;color:${f.c};opacity:${0.55 + (i % 3) * 0.15};transition:margin .5s ease-out`;
    el.innerHTML = `<svg viewBox="0 0 120 60" style="--t:${2.4 + (i % 4) * .5}s;--d:${-i * .4}s"><use href="#fish"/></svg>`;
    fishLayer.appendChild(el);
    items.push({ el, fish: true, cur: 0, tf: p => `translate3d(${f.dx * p}px,${f.dy * p}px,0) rotate(${f.rot * p}deg)` });
  });

  PLANTS.forEach((f, i) => {
    const el = document.createElement('div');
    el.className = 'plant';
    el.style.cssText = `left:${f.x}%;width:${f.w}px;height:${f.h}px;color:${f.c};opacity:${0.75 + (i % 3) * 0.1}`;
    const vb = f.type === 'kelp' ? '0 0 60 200' : '0 0 80 140';
    el.innerHTML = `<svg viewBox="${vb}" preserveAspectRatio="xMidYMax meet" style="--t:${4 + (i % 4) * .8}s;--d:${-i * .7}s"><use href="#${f.type}"/></svg>`;
    plantLayer.appendChild(el);
    items.push({ el, cur: 0, tf: p => `translate3d(${f.dx * p}px,${f.dy * p}px,0) rotate(${f.rot * p}deg) scaleY(${1 - f.sc * Math.min(p, 1)})` });
  });

  SIDE_GRASS.forEach((f, i) => {
    const el = document.createElement('div');
    const h = f.w * .75;
    el.className = 'plant side';
    // roots are tucked well under the (wavy) sidebar edge
    el.style.cssText = `left:calc(var(--side) * .78);top:${f.y}%;width:${f.w}px;height:${h}px;margin-top:${-h / 2}px;color:${f.c};opacity:${0.85 + (i % 2) * 0.1}`;
    const blades = makeBlades(i * 977 + 31).map((bl, j) =>
      `<path class="blade" d="${bl.d}" fill="url(#gg${i})" fill-opacity="${(.7 + (j % 4) * .1).toFixed(2)}" style="--a:${(2.5 + bl.len / 150 * 4).toFixed(1)}deg;--bt:${(2.4 + ((i + j) % 5) * .55).toFixed(2)}s;--bd:${(-(i * 3 + j) * .37).toFixed(2)}s"/>`).join('');
    el.innerHTML = `<svg viewBox="0 0 160 120" style="--t:${3.6 + (i % 3) * .8}s;--d:${-i * .8}s"><defs><linearGradient id="gg${i}"><stop offset="0" stop-color="#145a45"/><stop offset="1" stop-color="currentColor"/></linearGradient></defs><g${f.flip ? ' transform="translate(0,120) scale(1,-1)"' : ''}>${blades}</g></svg>`;
    plantLayer.appendChild(el);
    items.push({
      el,
      cur: 0,
      tf: p => `translate3d(${f.dx * p}px,${f.dy * p}px,0) rotate(${f.rot * p}deg) scaleX(${1 - f.sc * Math.min(p, 1)})`
    });
  });

  let target = 0, running = false;
  const progress = () => Math.min(Math.max(scrollY / hero.offsetHeight, 0), 1.6);

  function render() {
    running = false;
    let moving = false;
    for (const it of items) {
      it.cur += (target - it.cur) * 0.1;                  // easing keeps it smooth both directions
      if (Math.abs(target - it.cur) > 0.0005) moving = true;
      it.el.style.transform = it.tf(it.cur);
    }
    if (moving) { running = true; requestAnimationFrame(render); }
  }
  const kick = () => { target = reduce ? 0 : progress(); if (!running) { running = true; requestAnimationFrame(render); } };

  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', kick);
  kick();

  // Fish gently dart away from the cursor
  hero.addEventListener('pointermove', e => {
    if (reduce) return;
    for (const it of items) {
      if (!it.fish) continue;
      const b = it.el.getBoundingClientRect();
      const ddx = b.left + b.width / 2 - e.clientX, ddy = b.top + b.height / 2 - e.clientY;
      const d = Math.hypot(ddx, ddy);
      it.el.style.marginLeft = d < 200 ? `${(ddx / d) * (200 - d) * .25}px` : '0px';
      it.el.style.marginTop  = d < 200 ? `${(ddy / d) * (200 - d) * .25}px` : '0px';
    }
  });
})();

/* ===== 2. Locked nav items when logged out (Measurement, Discussions) ===== */
(() => {
  const btn = document.getElementById('loginBtn');
  const label = document.getElementById('loginLabel');
  const isOn = () => document.body.classList.contains('logged-in');
  const setState = on => {
    document.body.classList.toggle('logged-in', on);
    label.textContent = on ? 'Sign Out' : 'Sign Up/In';
    document.querySelectorAll('.needs-login').forEach(a => {
      a.setAttribute('aria-disabled', String(!on));
      a.tabIndex = on ? 0 : -1;
    });
  };
  // Demo toggle – replace with your real auth check, e.g. setState(Boolean(user))
  btn.addEventListener('click', () => setState(!isOn()));
  btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setState(!isOn()); } });
  document.querySelectorAll('.needs-login').forEach(a =>
    a.addEventListener('click', e => { if (!isOn()) e.preventDefault(); }));
  setState(false);
})();

/* ===== 3. Ask Pickle AI: suggested searches ===== */
(() => {
  const ask = document.getElementById('ask');
  const input = document.getElementById('askInput');
  ask.querySelectorAll('.suggest button').forEach(b =>
    b.addEventListener('click', () => { input.value = b.textContent; input.focus(); }));
  input.addEventListener('input', () => ask.classList.toggle('has-text', input.value.trim() !== ''));
})();

/* ===== 4. Info cards slide in when the map section scrolls into view ===== */
(() => {
  const cards = document.querySelectorAll('.info-card');
  if (!('IntersectionObserver' in window)) { cards.forEach(c => c.classList.add('in')); return; }
  const io = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { threshold: 0.2 });
  cards.forEach(c => io.observe(c));
})();
