// Tracket themes: the list, applying one (before first paint, no flash), fonts
// on demand, a few theme words, and each theme's little effects.
// Loaded in <head>; the dashboard uses window.TT. Styles live in themes.css.
(function () {
  'use strict';
  const GF = 'https://fonts.googleapis.com/css2?display=swap&family=';
  const THEMES = {
    default: { name: 'Default', desc: 'Amber glow on midnight', color: '#0b0b10',
      pal: ['#ffb547', '#5cf2b0', '#a78bfa', '#5cc8ff', '#ff8fab', '#f5e663', '#ff7a45', '#7ee081'] },
    system: { name: 'Match device', desc: 'Light or dark, like your device' },
    dark: { name: 'Dark', desc: 'Calm grey, one blue accent', color: '#0f1115', fonts: 'Inter:wght@400;500;600;800',
      pal: ['#5b9cff', '#3ecf8e', '#a58cf5', '#f5a524', '#f06a6a', '#38bdf8', '#e879f9', '#a3e635'] },
    light: { name: 'Light', desc: 'White cards, soft shadows', color: '#f3f4f7', fonts: 'Inter:wght@400;500;600;800',
      pal: ['#2563eb', '#059669', '#7c3aed', '#d97706', '#e11d48', '#0891b2', '#c026d3', '#65a30d'] },
    anime: { name: 'Anime', desc: 'Pastel dusk, sakura, sparkles', color: '#1b1230', fonts: 'M+PLUS+Rounded+1c:wght@400;500;700;800&family=Fredoka:wght@500;600;700',
      pal: ['#ff8ccf', '#7ef0d0', '#b79bff', '#ffd36e', '#8fd3ff', '#ffa8a8', '#c3f584', '#f7b2ff'] },
    manhwa: { name: 'Manhwa', desc: 'Ink panels, halftone, SFX', color: '#f4eee2', fonts: 'Bangers&family=Nunito:wght@400;600;700;800',
      pal: ['#ff4a1c', '#1e6bff', '#ffb300', '#00a86b', '#e0002a', '#5b3cc4', '#00a3c4', '#ff7ab6'] },
    movies: { name: 'Movies', desc: 'Velvet, marquee lights, film strip', color: '#0c0406', fonts: 'Bebas+Neue&family=Limelight&family=Inter:wght@400;500;600',
      pal: ['#f2c14e', '#d7263d', '#f5ecd9', '#e07a3f', '#9b1b30', '#c9a0ff', '#8fd694', '#ffe08a'],
      words: { list: 'Now showing', running: '● NOW PLAYING', eyebrow: 'Runtime today' } },
    coding: { name: 'Coding', desc: 'Terminal green, blinking cursor', color: '#070a07',
      pal: ['#39ff88', '#7cc4ff', '#ffd866', '#ff6188', '#ab9df2', '#78dce8', '#fc9867', '#a9dc76'],
      words: { list: '~/tickets', running: '● PROCESS RUNNING', eyebrow: 'uptime --today' } },
    games: { name: 'Games', desc: 'Pixel arcade, XP, level ups', color: '#0d0b1f', fonts: 'Press+Start+2P&family=VT323&family=Pixelify+Sans:wght@400;600',
      pal: ['#ffd23f', '#3dff9a', '#ff3864', '#3ec6ff', '#8b5cf6', '#ff6b35', '#f4f1ff', '#b8ff3d'],
      words: { list: 'Quest log', running: '▶ QUEST ACTIVE', eyebrow: 'XP today', xp: true } },
    guardian: { name: 'Night Guardian', desc: 'Rainy city, yellow searchlight', color: '#06070a', fonts: 'Oswald:wght@500;600;700&family=Inter:wght@400;500;600',
      pal: ['#ffd400', '#7f8cff', '#e9ecf2', '#ff8a00', '#5a6b8c', '#b7c4dd', '#ffe98a', '#9aa3b5'],
      words: { list: 'Case files', running: '● ON PATROL', eyebrow: 'On watch today' } },
    alienwatch: { name: 'Alien Watch', desc: 'Lime alien tech, glowing dial', color: '#040704', fonts: 'Orbitron:wght@600;800&family=Chakra+Petch:wght@400;500;600;700',
      pal: ['#6cff2e', '#eeffef', '#16c43a', '#8fe3ff', '#b8ff8f', '#2e8b57', '#d4ff3d', '#5ce1a0'],
      words: { list: 'Missions', running: '● POWERED UP', eyebrow: 'Charge today' } },
  };
  const ORDER = ['default', 'system', 'dark', 'light', 'anime', 'manhwa', 'movies', 'coding', 'games', 'guardian', 'alienwatch'];
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const lightMq = matchMedia('(prefers-color-scheme: light)');
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  let choice = THEMES[get('tk_theme')] ? get('tk_theme') : 'default';
  const resolve = (c) => (c === 'system' ? (lightMq.matches ? 'light' : 'dark') : THEMES[c] ? c : 'default');
  let current = resolve(choice);
  const listeners = [];

  function loadFonts(t) {
    const f = THEMES[t]?.fonts;
    if (!f || document.getElementById(`tf-${t}`)) return;
    const l = document.createElement('link');
    l.id = `tf-${t}`; l.rel = 'stylesheet'; l.href = GF + f;
    document.head.appendChild(l);
  }

  function paint() {
    const de = document.documentElement;
    if (current === 'default') delete de.dataset.theme; else de.dataset.theme = current;
    loadFonts(current);
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = THEMES[current].color;
    setupScene();
  }

  // Apply a choice (a theme key or 'system'). Returns the theme now showing.
  function apply(c) {
    choice = THEMES[c] ? c : 'default';
    set('tk_theme', choice);
    const before = current;
    current = resolve(choice);
    paint();
    if (before !== current) listeners.forEach((fn) => fn(current));
    return current;
  }
  lightMq.addEventListener?.('change', () => { if (choice === 'system') apply('system'); });

  // ---------- scenery (always-on decoration) ----------
  function setupScene() {
    if (!document.body) return;
    document.querySelector('.petals')?.remove();
    if (current === 'anime' && !calm()) {
      const box = document.createElement('div');
      box.className = 'petals'; box.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 14; i++) {
        const p = document.createElement('i');
        p.style.left = `${Math.random() * 100}%`;
        p.style.setProperty('--d', `${11 + Math.random() * 10}s`);
        p.style.setProperty('--w', `${-Math.random() * 20}s`);
        p.style.setProperty('--x', `${(Math.random() - 0.3) * 160}px`);
        p.style.transform = `scale(${0.6 + Math.random() * 0.7})`;
        box.appendChild(p);
      }
      document.body.appendChild(box);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupScene); else setupScene();

  // ---------- moments: 'h7', 'h8', 'hour', 'start', 'stop' ----------
  function burst(el, n) {
    const r = (el || document.body).getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.className = 'spark'; s.textContent = ['✦', '✧', '❀', '♡'][i % 4];
      s.style.left = `${r.left + r.width * (0.2 + Math.random() * 0.6)}px`;
      s.style.top = `${r.top + r.height * (0.3 + Math.random() * 0.4)}px`;
      const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 120;
      s.style.setProperty('--dx', `${Math.cos(a) * d}px`); s.style.setProperty('--dy', `${Math.sin(a) * d}px`);
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 1200);
    }
  }
  function pop(cls, html, ms) {
    const el = document.createElement('div');
    el.className = cls; el.innerHTML = html; el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }
  let ac = null;
  function tone(notes) {
    if (get('tk_sound') !== '1') return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      let t = ac.currentTime;
      for (const [f, d] of notes) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'square'; o.frequency.value = f;
        g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d);
        t += d * 0.85;
      }
    } catch {}
  }
  function fx(kind) {
    if (calm() && kind !== 'start' && kind !== 'stop') return;
    const odo = document.getElementById('odo');
    if (current === 'anime' && (kind === 'h7' || kind === 'h8' || kind === 'hour')) burst(odo, kind === 'hour' ? 10 : 22);
    if (current === 'manhwa') {
      const w = { h7: 'DING!', h8: 'BOOM!', hour: 'TICK!' }[kind];
      if (w) pop('sfx', w, 1400);
    }
    if (current === 'movies') {
      if (kind === 'h7') pop('credit', '<b>7 Hours</b><small>The minimum · a Tracket production</small>', 2700);
      if (kind === 'h8') pop('credit', '<b>That’s a wrap</b><small>8 hours · roll the credits</small>', 2700);
      if (kind === 'start' && !calm()) pop('clap', 'ACTION!', 1400);
      if (kind === 'stop' && !calm()) pop('clap', 'CUT!', 1400);
    }
    if (current === 'guardian') {
      if (kind === 'start' && !calm()) pop('flash', '', 800);
      if (kind === 'h7') pop('signal', '<b>7 Hours</b><small>The city is safe · minimum done</small>', 2700);
      if (kind === 'h8') pop('signal', '<b>Patrol over</b><small>8 hours · go home, hero</small>', 2700);
    }
    if (current === 'alienwatch') {
      if (kind === 'start' && !calm()) pop('warp', '', 1000);
      if (kind === 'h7') pop('charge', '<b>Power up</b><small>7h minimum reached</small>', 2500);
      if (kind === 'h8') pop('charge', '<b>Fully charged</b><small>8 hours · time to power down</small>', 2500);
    }
    if (current === 'games') {
      if (kind === 'h7') { pop('lvlup', 'LEVEL UP!<small>7h minimum cleared</small>', 1900); tone([[523, 0.09], [659, 0.09], [784, 0.09], [1047, 0.22]]); }
      if (kind === 'h8') { pop('lvlup', 'MAX LEVEL<small>8h — go rest, hero</small>', 1900); tone([[784, 0.1], [988, 0.1], [1175, 0.1], [1568, 0.28]]); }
      if (kind === 'start') tone([[988, 0.07], [1319, 0.18]]); // coin
      if (kind === 'stop') tone([[659, 0.08], [440, 0.16]]);
    }
  }

  // Preview card for the picker: wears its own theme.
  function card(k, sel) {
    const t = THEMES[k], look = resolve(k);
    const pal = THEMES[look].pal;
    return `<button class="thm ${sel ? 'sel' : ''}" data-pick="${k}" data-theme="${look}" aria-pressed="${sel}">
      <span class="tp"><i class="chip"></i><span class="n">05<em>:</em>14</span>
        <span class="b">${pal.slice(0, 4).map((c, i) => `<i style="background:${c};flex:${[5, 3, 2, 1][i]}"></i>`).join('')}</span></span>
      <span class="tg"><b>${t.name}</b><span class="tick">✓</span></span><small>${t.desc}</small></button>`;
  }
  function grid() { ORDER.forEach(loadFonts); return `<div class="thgrid">${ORDER.map((k) => card(k, k === choice)).join('')}</div>`; }

  paint();
  window.TT = {
    THEMES, ORDER, apply, fx, grid,
    choice: () => choice, current: () => current,
    palette: () => THEMES[current].pal,
    word: (k, fallback) => THEMES[current].words?.[k] ?? fallback,
    xp: () => !!THEMES[current].words?.xp,
    sound: (on) => { if (on !== undefined) set('tk_sound', on ? '1' : '0'); return get('tk_sound') === '1'; },
    onChange: (fn) => listeners.push(fn),
  };
})();
