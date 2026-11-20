/* ===== 1. Hero fish: scroll down = swim along a path, scroll up = swim back ===== */
(() => {
  const layer = document.getElementById('fishLayer');
  const hero = document.getElementById('hero');
  if (!layer) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // x/y = start position (% of hero), w = width px, dx/dy = travel in px over one hero height,
  // rot = extra rotation in deg, color = fish color. Edit freely.
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

  const items = FISH.map((f, i) => {
    const el = document.createElement('div');
    el.className = 'fish' + (f.dx > 0 ? ' flip' : '');   // symbol faces left, flip when heading right
    el.style.cssText = `left:${f.x}%;top:${f.y}%;width:${f.w}px;color:${f.c};opacity:${0.55 + (i % 3) * 0.15}`;
    el.innerHTML = `<svg viewBox="0 0 120 60" style="--t:${2.4 + (i % 4) * .5}s;--d:${-i * .4}s"><use href="#fish"/></svg>`;
    layer.appendChild(el);
    return { el, f, cur: 0 };
  });

  let target = 0, running = false;
  const progress = () => Math.min(Math.max(scrollY / hero.offsetHeight, 0), 1.6);

  function render() {
    running = false;
    let moving = false;
    for (const it of items) {
      it.cur += (target - it.cur) * 0.1;                  // easing keeps it smooth both directions
      if (Math.abs(target - it.cur) > 0.0005) moving = true;
      const p = it.cur, { dx, dy, rot } = it.f;
      it.el.style.transform = `translate3d(${dx * p}px,${dy * p}px,0) rotate(${rot * p}deg)`;
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
    const r = hero.getBoundingClientRect();
    for (const it of items) {
      const b = it.el.getBoundingClientRect();
      const ddx = b.left + b.width / 2 - e.clientX, ddy = b.top + b.height / 2 - e.clientY;
      const d = Math.hypot(ddx, ddy);
      it.el.style.marginLeft = d < 200 ? `${(ddx / d) * (200 - d) * .25}px` : '0px';
      it.el.style.marginTop  = d < 200 ? `${(ddy / d) * (200 - d) * .25}px` : '0px';
    }
  });
  layer.querySelectorAll('.fish').forEach(el => el.style.transition = 'margin .5s ease-out');
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
