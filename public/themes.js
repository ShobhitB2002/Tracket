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
    cyberpunk: { name: 'Cyberpunk', desc: 'Neon rain, glitches', color: '#07010f', fonts: 'Rajdhani:wght@500;600;700&family=Share+Tech+Mono&family=Audiowide',
      pal: ['#ff2a6d', '#05d9e8', '#f9f871', '#00ff9f', '#b967ff', '#ff9e00', '#d1f7ff', '#ff6ec7'],
      words: { list: 'Gigs', running: '● JACKED IN', eyebrow: 'Uptime today' } },
    synthwave: { name: 'Synthwave', desc: '80s sunset, neon grid', color: '#12002b', fonts: 'Righteous&family=Inter:wght@400;500;600',
      pal: ['#ff71ce', '#01cdfe', '#05ffa1', '#b967ff', '#fffb96', '#ff9e64', '#ff4f8b', '#7df9ff'] },
    space: { name: 'Space', desc: 'Stars, a planet, shooting stars', color: '#03040c', fonts: 'Exo+2:wght@400;500;600;700',
      pal: ['#8ab4ff', '#c792ff', '#7af0c8', '#ffcf70', '#ff8fb1', '#5ee7ff', '#e8ecff', '#a3e635'],
      words: { list: 'Mission log', running: '● IN ORBIT', eyebrow: 'Flight time today' } },
    ocean: { name: 'Ocean', desc: 'Deep blue, waves, bubbles', color: '#021a2b', fonts: 'Quicksand:wght@500;600;700',
      pal: ['#4fd1ff', '#2ee6c5', '#9ab8ff', '#ffd27a', '#ff9aa8', '#7ff0ff', '#c3f0ff', '#8ce99a'] },
    forest: { name: 'Forest', desc: 'Moss, fog, falling leaves', color: '#0b140d', fonts: 'Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Nunito:wght@400;600;700',
      pal: ['#9be564', '#e6b85c', '#7cc7a0', '#d98f5a', '#b7a6e8', '#f2d98b', '#5fa86b', '#c9e89a'] },
    notebook: { name: 'Notebook', desc: 'Lined paper, sticky notes', color: '#f7f3e8', fonts: 'Patrick+Hand&family=Caveat:wght@600;700',
      pal: ['#1f4fd1', '#e04f5f', '#2e8b57', '#f2a900', '#7a4fd1', '#0e9aa7', '#e07b39', '#555f6d'],
      words: { list: 'Today’s notes', eyebrow: 'Hours written today' } },
    rpg: { name: 'Fantasy RPG', desc: 'Parchment, crimson, gold', color: '#e8d6ae', fonts: 'Cinzel:wght@600;700&family=Alegreya+Sans:wght@400;500;700',
      pal: ['#8c1c13', '#b8860b', '#3f7d20', '#4b3b8f', '#a0522d', '#1f6f8b', '#6b4226', '#c2410c'],
      words: { list: 'Quests', running: '⚔ ON A QUEST', eyebrow: 'Hours adventured' } },
    cricket: { name: 'Cricket', desc: 'Floodlights, LED scoreboard', color: '#04120b', fonts: 'Teko:wght@400;500;600&family=Inter:wght@400;500;600',
      pal: ['#ffd23f', '#52e08a', '#ff5d5d', '#8fd3ff', '#f1fff4', '#ff9f43', '#b18cff', '#3ddbd9'],
      words: { list: 'Innings', running: '🏏 AT THE CREASE', eyebrow: 'On the pitch today' } },
    festive: { name: 'Festive', desc: 'String lights, diyas, winter snow', color: '#14061a', fonts: 'Playfair+Display:wght@600;700&family=Nunito:wght@400;600;700',
      pal: ['#ffb13b', '#ff5e7e', '#6ee7a8', '#c49bff', '#ffd166', '#5ec8ff', '#ff8a5b', '#f5f5f5'] },
    eink: { name: 'E-ink', desc: 'Pure black and white, no motion', color: '#f2f2ee', fonts: 'IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;600',
      pal: ['#111111', '#444444', '#666666', '#888888', '#222222', '#555555', '#777777', '#333333'] },
    halloween: { name: 'Halloween', desc: 'Moon, fog, bats, pumpkins', color: '#0e0714', fonts: 'Creepster&family=Nunito:wght@400;600;700',
      pal: ['#ff7a1a', '#9b5de5', '#9be15d', '#ffd23f', '#ff4d4d', '#5ec8ff', '#fdf1e6', '#c77dff'],
      words: { list: 'Haunted tickets', running: '🎃 HAUNTING', eyebrow: 'Hours survived today' } },
  };
  const ORDER = ['default', 'system', 'dark', 'light', 'anime', 'manhwa', 'movies', 'coding', 'games', 'guardian', 'alienwatch',
    'cyberpunk', 'synthwave', 'space', 'ocean', 'forest', 'notebook', 'rpg', 'cricket', 'festive', 'eink', 'halloween'];
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
  // drifting particles per theme: [kind, count]; festive snows in Dec–Feb
  const winter = () => [11, 0, 1].includes(new Date().getMonth());
  const PARTS = { anime: ['petals', 14], ocean: ['bubbles', 18], forest: ['leaves', 12], halloween: ['bats', 5] };
  function setupScene() {
    if (!document.body) return;
    document.querySelectorAll('.petals,.parts').forEach((el) => el.remove());
    const cfg = current === 'festive' ? [winter() ? 'snow' : 'embers', 26] : PARTS[current];
    if (!cfg || calm()) return;
    const [kind, n] = cfg;
    const box = document.createElement('div');
    box.className = kind === 'petals' ? 'petals' : `parts ${kind}`; box.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.style.left = kind === 'bats' ? '-60px' : `${Math.random() * 100}%`;
      p.style.setProperty('--d', `${(kind === 'bats' ? 18 : kind === 'snow' ? 10 : 11) + Math.random() * 10}s`);
      p.style.setProperty('--w', `${-Math.random() * (kind === 'bats' ? 30 : 20)}s`);
      p.style.setProperty('--x', `${(Math.random() - 0.3) * 160}px`);
      p.style.setProperty('--s', `${3 + Math.random() * (kind === 'bubbles' ? 14 : 4)}px`);
      p.style.setProperty('--y', `${8 + Math.random() * 40}%`);
      if (kind === 'petals' || kind === 'leaves') p.style.transform = `scale(${0.6 + Math.random() * 0.7})`;
      box.appendChild(p);
    }
    document.body.appendChild(box);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupScene); else setupScene();

  // ---------- moments: 'h7', 'h8', 'hour', 'start', 'stop' ----------
  function burst(el, n, glyphs = ['✦', '✧', '❀', '♡'], colors = null) {
    const r = (el || document.body).getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span');
      s.className = colors ? 'spark fw' : 'spark'; s.textContent = glyphs[i % glyphs.length];
      if (colors) s.style.color = colors[i % colors.length];
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
    const card = (b, sm) => pop('bigcard', `<b>${b}</b><small>${sm}</small>`, 2700);
    if (current === 'cyberpunk') {
      if (kind === 'start' && !calm()) { document.documentElement.classList.add('glitching'); setTimeout(() => document.documentElement.classList.remove('glitching'), 480); }
      if (kind === 'h7') card('7H // DONE', 'Minimum cleared · jack out soon');
      if (kind === 'h8') card('OVERCLOCKED', '8 hours · cool down, runner');
    }
    if (current === 'synthwave') {
      if (kind === 'h7') card('Totally rad', '7 hours · minimum cleared');
      if (kind === 'h8') card('Max power', '8 hours · hit rewind tomorrow');
    }
    if (current === 'space') {
      if (kind === 'start' && !calm()) pop('shoot', '', 1200);
      if (kind === 'h7') card('Orbit reached', '7 hours · minimum done');
      if (kind === 'h8') card('Touchdown', '8 hours · mission complete');
    }
    if (current === 'ocean') {
      if (kind === 'start' && !calm()) burst(odo, 12, ['○', '◦', '°']);
      if (kind === 'h7') card('High tide', '7 hours · minimum done');
      if (kind === 'h8') card('Surface!', '8 hours · come up for air');
    }
    if (current === 'forest') {
      if (kind === 'h7') card('Deep roots', '7 hours grown 🌱');
      if (kind === 'h8') card('Full bloom', '8 hours · rest in the shade');
    }
    if (current === 'notebook') {
      if (kind === 'h7') pop('stamp', '7h ✓<small>minimum done</small>', 2300);
      if (kind === 'h8') pop('stamp', 'A+<small>8 hours · pens down</small>', 2300);
    }
    if (current === 'rpg') {
      if (kind === 'h7') card('Quest complete', '+7 hours of glory');
      if (kind === 'h8') card('Legendary', '8 hours · rest at the inn');
    }
    if (current === 'cricket') {
      if (kind === 'hour') card('FOUR!', 'Another hour to the boundary');
      if (kind === 'h7') card('CENTURY! 💯', '7 hours · raise the bat');
      if (kind === 'h8') card('Player of the match', '8 hours · walk off to applause');
    }
    if (current === 'festive') {
      const fw = ['✺', '✹', '✸', '✦', '❋'], cols = ['#ffd166', '#ff5e7e', '#6ee7a8', '#c49bff', '#5ec8ff'];
      if (kind === 'h7') { burst(odo, 28, fw, cols); card('Celebrate!', '7 hours · minimum done'); }
      if (kind === 'h8') { burst(odo, 40, fw, cols); card('Festival day', '8 hours · light it up'); }
    }
    if (current === 'halloween') {
      if (kind === 'h7') card('BOO!', '7 hours survived');
      if (kind === 'h8') card('Midnight', '8 hours · fly home');
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
