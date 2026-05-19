// ═══════════════════════════════════════════════════════════════
// BodyArcade — Realistic Game Core
// ═══════════════════════════════════════════════════════════════
'use strict';

// ──────── STATE ────────
const S = {
  name: 'Champion', weight: 70, age: 28,
  diff: 'medium', course: 'mountain',
  hearts: 3, score: 0, distance: 0, calories: 0, combo: 0, bestCombo: 0,
};

const DIFF = {
  easy:   { spd: 0.85, react: 5.0, label: 'Easy' },
  medium: { spd: 1.10, react: 4.0, label: 'Medium' },
  hard:   { spd: 1.45, react: 3.0, label: 'Hard' },
  insane: { spd: 1.85, react: 2.0, label: 'Insane' },
};

// 10 worlds — realistic, NO neon. Photographic palettes.
// First 3 (mountain, desert, forest) = FREE, rest = PRO ONLY
const COURSES = [
  { id:'mountain', emoji:'🏔️', name:'ALPS',     sky:[ '#3a5878','#5a7898','#a8bccc'], ground:'#3a3530', accent:'#c8b896', fog:0.012, rain:0,   free:true  },
  { id:'desert',   emoji:'🏜️', name:'DESERT',   sky:[ '#d87838','#e8a868','#f4d090'], ground:'#a87038', accent:'#d8a868', fog:0.010, rain:0,   free:true  },
  { id:'forest',   emoji:'🌲', name:'FOREST',   sky:[ '#3a5840','#6a8848','#a8b888'], ground:'#3a2818', accent:'#5a7038', fog:0.018, rain:0,   free:true  },
  { id:'storm',    emoji:'⛈️', name:'STORM',    sky:[ '#1a2030','#2a3548','#4a5868'], ground:'#1a2028', accent:'#3a4858', fog:0.025, rain:120, free:false },
  { id:'sunset',   emoji:'🌅', name:'SUNSET',   sky:[ '#3a2848','#a85838','#f8c878'], ground:'#3a2828', accent:'#c87848', fog:0.012, rain:0,   free:false },
  { id:'snow',     emoji:'❄️', name:'ARCTIC',   sky:[ '#5a7898','#a8c8d8','#e8f0f8'], ground:'#c8d8e8', accent:'#e8f0f8', fog:0.022, rain:60,  free:false },
  { id:'jungle',   emoji:'🌴', name:'JUNGLE',   sky:[ '#286848','#58a878','#c8e898'], ground:'#382818', accent:'#487038', fog:0.020, rain:80,  free:false },
  { id:'city',     emoji:'🏙️', name:'CITY',     sky:[ '#1a2540','#3a4868','#6a7898'], ground:'#2a2a30', accent:'#48586a', fog:0.014, rain:0,   free:false },
  { id:'volcano',  emoji:'🌋', name:'VOLCANO',  sky:[ '#1a0808','#582020','#c84028'], ground:'#3a1818', accent:'#a83020', fog:0.020, rain:0,   free:false },
  { id:'ocean',    emoji:'🌊', name:'COAST',    sky:[ '#2a4858','#5a8098','#a8c8d8'], ground:'#4a5868', accent:'#7898a8', fog:0.012, rain:0,   free:false },
];

// ──────── MONETIZATION HELPERS ────────
const GUMROAD_PRO = 'https://dorukctn.gumroad.com/l/ithhc';
const GUMROAD_LIFETIME = 'https://dorukctn.gumroad.com/l/czrhwp';

function isPro() {
  return localStorage.getItem('ba_pro') === '1';
}

function todayStr() {
  return new Date().toISOString().slice(0,10);
}

function getDailyRuns() {
  const data = JSON.parse(localStorage.getItem('ba_daily')||'{}');
  return data[todayStr()] || 0;
}

function incDailyRuns() {
  const data = JSON.parse(localStorage.getItem('ba_daily')||'{}');
  const k = todayStr();
  data[k] = (data[k] || 0) + 1;
  // Cleanup old days
  Object.keys(data).forEach(d => { if(d < k && Date.now() - new Date(d).getTime() > 7*86400000) delete data[d]; });
  localStorage.setItem('ba_daily', JSON.stringify(data));
}

const DAILY_FREE_LIMIT = 5;

function canRunToday() {
  return isPro() || getDailyRuns() < DAILY_FREE_LIMIT;
}

function showLockModal(reason, ctaUrl) {
  // Build a simple modal overlay
  let m = $('lock-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'lock-modal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);';
    document.body.appendChild(m);
  }
  m.style.display = 'flex';
  m.innerHTML = `
    <div style="background:linear-gradient(180deg,#1a2540,#0a1018);border:3px solid #ffc424;border-radius:18px;padding:36px 28px;max-width:420px;width:90vw;text-align:center;box-shadow:0 12px 40px rgba(255,196,36,.3);position:relative;">
      <div style="position:absolute;top:10px;right:14px;cursor:pointer;color:#aab4c2;font-size:24px;line-height:1;" onclick="document.getElementById('lock-modal').style.display='none'">×</div>
      <div style="font-size:54px;margin-bottom:8px;">🔒</div>
      <div style="font-family:'Bangers',cursive;font-size:34px;color:#ffc424;text-shadow:0 4px 0 #5a3a00;letter-spacing:.04em;margin-bottom:10px;">UNLOCK PRO</div>
      <div style="font-size:15px;color:#aab4c2;margin-bottom:24px;line-height:1.5;">${reason}</div>
      <div style="background:rgba(255,196,36,.08);border:1px solid rgba(255,196,36,.2);border-radius:12px;padding:14px;margin-bottom:24px;text-align:left;">
        <div style="font-family:'Bangers',cursive;font-size:18px;color:#ffc424;margin-bottom:8px;letter-spacing:.04em;">PRO INCLUDES:</div>
        <div style="color:#fff;font-size:13px;line-height:1.8;">
          ✓ <b>All 10 worlds</b> unlocked<br/>
          ✓ <b>Hard &amp; Insane</b> difficulty<br/>
          ✓ <b>Unlimited daily runs</b><br/>
          ✓ Workout history &amp; graphs<br/>
          ✓ 2-player split-screen
        </div>
      </div>
      <a href="${ctaUrl||GUMROAD_PRO}" target="_blank" style="display:block;font-family:'Bangers',cursive;font-size:22px;letter-spacing:.06em;padding:14px;border-radius:12px;background:linear-gradient(180deg,#ffd95c,#ffc424,#c08800);color:#3a1f00;text-decoration:none;border:3px solid #5a3a00;box-shadow:0 5px 0 #5a3a00, 0 10px 20px rgba(255,196,36,.3);">GET PRO — $4.99 →</a>
      <div style="margin-top:14px;font-size:12px;color:#5a6878;">Or get <a href="${GUMROAD_LIFETIME}" target="_blank" style="color:#ffc424;text-decoration:underline;">Lifetime for $99</a> — one-time</div>
    </div>
  `;
  if (window.plausible) window.plausible('Lock Modal', { props: { reason } });
}

// Allow unlocking via URL ?pro=1 for testing or after Gumroad purchase
if (location.search.includes('pro=1')) {
  localStorage.setItem('ba_pro','1');
  alert('🎉 PRO unlocked! Welcome to BodyArcade Pro.');
}

// ──────── EXERCISES (with SVG icons) ────────
const EX = {
  jump:   { label:'JUMP',   color:'#5cdfff', svg:`<g fill="#fff" stroke="#0a3a5a" stroke-width="2"><path d="M50 18 a8 8 0 1 0 0.1 0z"/><path d="M50 28 v22 M50 28 L36 38 M50 28 L64 38 M50 50 L38 72 M50 50 L62 72" stroke-linecap="round" stroke-width="6" fill="none"/></g>` },
  squat:  { label:'SQUAT',  color:'#a8e85a', svg:`<g fill="#fff" stroke="#1a3a0a" stroke-width="2"><path d="M50 18 a8 8 0 1 0 0.1 0z"/><path d="M50 28 v18 M50 28 L36 42 M50 28 L64 42 M50 46 L38 60 L38 78 M50 46 L62 60 L62 78" stroke-linecap="round" stroke-width="6" fill="none"/></g>` },
  duck:   { label:'DUCK',   color:'#ffa848', svg:`<g fill="#fff" stroke="#3a1a0a" stroke-width="2"><path d="M30 30 a8 8 0 1 0 0.1 0z"/><path d="M38 38 L60 38 M60 38 L72 50 M60 38 L72 30 M38 38 L48 60 L42 78 M48 60 L58 60 L58 78" stroke-linecap="round" stroke-width="6" fill="none"/></g>` },
  left:   { label:'LEAN ←', color:'#c898ff', svg:`<g fill="#fff" stroke="#2a0a3a" stroke-width="2"><path d="M62 18 a8 8 0 1 0 0.1 0z"/><path d="M62 28 L48 50 M48 50 L34 58 M48 50 L52 72 M62 28 L70 44" stroke-linecap="round" stroke-width="6" fill="none"/><path d="M28 80 L16 80 M22 74 L16 80 L22 86" stroke="#ffc424" stroke-width="5" fill="none" stroke-linecap="round"/></g>` },
  right:  { label:'LEAN →', color:'#c898ff', svg:`<g fill="#fff" stroke="#2a0a3a" stroke-width="2"><path d="M38 18 a8 8 0 1 0 0.1 0z"/><path d="M38 28 L52 50 M52 50 L66 58 M52 50 L48 72 M38 28 L30 44" stroke-linecap="round" stroke-width="6" fill="none"/><path d="M72 80 L84 80 M78 74 L84 80 L78 86" stroke="#ffc424" stroke-width="5" fill="none" stroke-linecap="round"/></g>` },
};
const EX_TYPES = ['jump','squat','duck','left','right'];

// ──────── DOM ────────
const $ = (id) => document.getElementById(id);

// ═══════════════════════════════════════════════════════════════
// ONBOARDING BG + HERO ANIMATIONS
// ═══════════════════════════════════════════════════════════════
function obBgAnim() {
  const c = $('obBg'); if (!c) return;
  const ctx = c.getContext('2d');
  function resize() { c.width = innerWidth; c.height = innerHeight; }
  resize(); addEventListener('resize', resize);
  const stars = []; for (let i = 0; i < 80; i++) stars.push({ x: Math.random(), y: Math.random()*.6, r: Math.random()*1.5+.3, t: Math.random() });
  function frame(ts) {
    ctx.fillStyle = 'rgba(10,16,24,.18)'; ctx.fillRect(0,0,c.width,c.height);
    for (const s of stars) {
      const a = .4 + Math.sin(ts*.001 + s.t*8)*.4;
      ctx.fillStyle = `rgba(200,220,255,${a})`;
      ctx.beginPath(); ctx.arc(s.x*c.width, s.y*c.height, s.r, 0, 6.28); ctx.fill();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function obHeroAnim() {
  // mini cinematic preview: scrolling road with barricade silhouettes
  const c = $('obHero'); if (!c) return;
  const ctx = c.getContext('2d');
  function resize() { const r = c.getBoundingClientRect(); c.width = r.width; c.height = r.height; }
  resize(); addEventListener('resize', resize);
  let off = 0;
  function frame(ts) {
    const W = c.width, H = c.height;
    // sky gradient
    const sky = ctx.createLinearGradient(0,0,0,H);
    sky.addColorStop(0,'#1a2540'); sky.addColorStop(.5,'#3a4868'); sky.addColorStop(1,'#6a7898');
    ctx.fillStyle = sky; ctx.fillRect(0,0,W,H);
    // mountains
    ctx.fillStyle = '#0a1018';
    ctx.beginPath(); ctx.moveTo(0,H*.55);
    for (let i = 0; i <= 12; i++) ctx.lineTo(W*i/12, H*.55 - Math.sin(i*1.7)*30 - 20);
    ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.fill();
    // road perspective
    const horizon = H*.55;
    ctx.fillStyle = '#2a2a30';
    ctx.beginPath(); ctx.moveTo(W*.4,horizon); ctx.lineTo(W*.6,horizon); ctx.lineTo(W*1.05,H); ctx.lineTo(W*-.05,H); ctx.fill();
    // yellow center dashes
    off = (off + 6) % 50;
    ctx.strokeStyle = '#ffc424'; ctx.lineWidth = 4;
    for (let i = 0; i < 8; i++) {
      const t = (i*50 + off) / (H - horizon);
      if (t < 0 || t > 1) continue;
      const y1 = horizon + t*(H-horizon);
      const y2 = horizon + Math.min(1,t+.06)*(H-horizon);
      ctx.lineWidth = 2 + t*5;
      ctx.beginPath(); ctx.moveTo(W*.5, y1); ctx.lineTo(W*.5, y2); ctx.stroke();
    }
    // barricade
    const bcT = (ts*.0008) % 1;
    if (bcT > .3) {
      const bcY = horizon + bcT*(H-horizon);
      const bcS = (bcT-.3)*2.2;
      const bcW = W*.45*bcS;
      ctx.save(); ctx.translate(W*.5, bcY);
      ctx.fillStyle = '#fff'; ctx.fillRect(-bcW/2, -20*bcS, bcW, 40*bcS);
      // stripes
      ctx.fillStyle = '#ff6b1a';
      for (let i = 0; i < 8; i++) {
        if (i % 2 === 0) continue;
        ctx.fillRect(-bcW/2 + bcW*i/8, -20*bcS, bcW/8, 40*bcS);
      }
      ctx.strokeStyle = '#0a1018'; ctx.lineWidth = 2; ctx.strokeRect(-bcW/2, -20*bcS, bcW, 40*bcS);
      ctx.restore();
    }
    // vignette
    const vg = ctx.createRadialGradient(W/2,H/2,W*.3,W/2,H/2,W*.7);
    vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(0,0,0,.6)');
    ctx.fillStyle = vg; ctx.fillRect(0,0,W,H);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ═══════════════════════════════════════════════════════════════
// ONBOARDING LOGIC
// ═══════════════════════════════════════════════════════════════
function obGo(n) {
  document.querySelectorAll('.ob-slide').forEach(s => s.classList.remove('active'));
  $('ob-' + n).classList.add('active');
}

function pickDiff(el) {
  const diff = el.dataset.diff;
  // Lock Hard & Insane for free users
  if ((diff === 'hard' || diff === 'insane') && !isPro()) {
    showLockModal(`<b>${diff.toUpperCase()}</b> difficulty is Pro-only. Unlock all difficulties + 10 worlds + unlimited runs.`, GUMROAD_PRO);
    return;
  }
  document.querySelectorAll('[data-diff]').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  S.diff = diff;
}

function startCamera() {
  // Check daily run limit
  if (!canRunToday()) {
    showLockModal(`<b>Daily run limit reached</b> (${DAILY_FREE_LIMIT}/day for Free). Come back tomorrow — or go Pro for unlimited runs.`, GUMROAD_PRO);
    return;
  }
  showScreen('screen-cam');
}

function buildCourseGrid() {
  const grid = $('ob-courses'); grid.innerHTML = '';
  COURSES.forEach((c, i) => {
    const d = document.createElement('div');
    const locked = !c.free && !isPro();
    d.className = 'ob-course' + (c.id === S.course && !locked ? ' selected' : '');
    d.dataset.id = c.id;
    if (locked) {
      d.style.opacity = '0.5';
      d.style.position = 'relative';
      d.innerHTML = `<div>${c.emoji}</div><div class="ob-course-name">${c.name}</div><div style="position:absolute;top:6px;right:6px;font-size:14px;">🔒</div>`;
    } else {
      const badge = c.free ? '<div style="position:absolute;top:4px;left:4px;font-family:Bangers,cursive;font-size:9px;letter-spacing:.06em;padding:2px 6px;border-radius:4px;background:#5cdfff;color:#0a2540;">FREE</div>' : '';
      d.style.position = 'relative';
      d.innerHTML = `${badge}<div>${c.emoji}</div><div class="ob-course-name">${c.name}</div>`;
    }
    d.onclick = () => {
      if (locked) {
        showLockModal(`<b>${c.name}</b> is a Pro world. Unlock all 10 worlds + unlimited runs.`, GUMROAD_PRO);
        return;
      }
      document.querySelectorAll('.ob-course').forEach(e => e.classList.remove('selected'));
      d.classList.add('selected'); S.course = c.id;
    };
    grid.appendChild(d);
  });
}

// Read URL hash for preselected world from landing page
(function preselectFromHash(){
  const m = location.hash.match(/world=([a-z]+)/i);
  if (m) {
    const wid = m[1].toLowerCase();
    // Map landing IDs to game IDs
    const map = { jungle:'jungle', volcano:'volcano', arctic:'snow', desert:'desert', ocean:'ocean', haunted:'sunset', space:'storm', crystal:'snow', temple:'mountain', neon:'city' };
    const target = map[wid] || (COURSES.find(c=>c.id===wid)?.id);
    if (target) S.course = target;
  }
})();

function saveProfile() {
  const n = $('i-name').value.trim(); if (n) S.name = n;
  const w = parseFloat($('i-weight').value); if (w > 20) S.weight = w;
  const a = parseInt($('i-age').value); if (a > 5) S.age = a;
  obGo(3);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

// ═══════════════════════════════════════════════════════════════
// CAMERA
// ═══════════════════════════════════════════════════════════════
let camStream = null, demoMode = false;
async function requestCamera() {
  $('cam-error').style.display = 'none';
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
    $('camVideo').srcObject = camStream;
    demoMode = false;
    beginCountdown();
  } catch (e) {
    $('cam-error').style.display = 'block';
  }
}
function skipCamera() { demoMode = true; beginCountdown(); }

function beginCountdown() {
  showScreen('screen-countdown');
  let n = 3;
  $('cd-num').textContent = n;
  const iv = setInterval(() => {
    n--;
    if (n > 0) { $('cd-num').textContent = n; $('cd-num').style.animation = 'none'; void $('cd-num').offsetWidth; $('cd-num').style.animation = 'cdPop .9s ease'; }
    else { clearInterval(iv); $('cd-num').textContent = 'GO!'; setTimeout(startGame, 600); }
  }, 900);
}

// ═══════════════════════════════════════════════════════════════
// AUDIO
// ═══════════════════════════════════════════════════════════════
let audioCtx = null, masterGain = null, musicNode = null, audioOn = false;
function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain(); masterGain.gain.value = 0.0; masterGain.connect(audioCtx.destination);
}
function sfx(freq, dur, type='sine', vol=.3) {
  // SFX only when user has loaded Spotify? No - keep SFX disabled by default
  return; // music + sfx disabled per user request
}
function playMusic() { /* disabled */ }
function stopMusic() { /* disabled */ }
function toggleAudio() { /* deprecated */ }

// ── SPOTIFY ──
function openSpotify() {
  const p = $('spotify-panel');
  p.style.display = p.style.display === 'block' ? 'none' : 'block';
}
function closeSpotify() { $('spotify-panel').style.display = 'none'; }
function loadSpotify() {
  const url = $('spotify-url').value.trim();
  if (!url) return;
  // Parse Spotify URL → embed
  const m = url.match(/spotify\.com\/(playlist|track|album|artist)\/([a-zA-Z0-9]+)/);
  if (!m) { alert('Invalid Spotify URL. Paste a track, playlist or album link.'); return; }
  const embedUrl = `https://open.spotify.com/embed/${m[1]}/${m[2]}?utm_source=generator&theme=0`;
  $('spotify-embed').innerHTML = `<iframe style="border-radius:8px;width:100%;height:152px;" src="${embedUrl}" frameborder="0" allowfullscreen="" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
  localStorage.setItem('ba_spotify', url);
}
// auto-restore last Spotify
addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('ba_spotify');
  if (saved) { $('spotify-url').value = saved; }
});

// ═══════════════════════════════════════════════════════════════
// 3D ENGINE — REALISTIC, NO NEON
// ═══════════════════════════════════════════════════════════════
let renderer, scene, camera, composer;
let roadMesh, recyclables = [], obstacles = [];
let rainSystem = null;
let speedSmooth = 0, distTotal = 0, scoreVal = 0;
let animId = null;
const ROAD_LEN = 200, ROAD_WIDTH = 10;

// — Procedural asphalt texture
function makeAsphaltTexture(courseAccent) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 1024;
  const ctx = c.getContext('2d');
  // base asphalt
  const g = ctx.createLinearGradient(0,0,0,c.height);
  g.addColorStop(0,'#2a2a30'); g.addColorStop(.5,'#1a1a20'); g.addColorStop(1,'#2a2a30');
  ctx.fillStyle = g; ctx.fillRect(0,0,c.width,c.height);
  // noise grain
  const img = ctx.getImageData(0,0,c.width,c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - .5) * 40;
    img.data[i]   = Math.max(0, Math.min(255, img.data[i]   + n));
    img.data[i+1] = Math.max(0, Math.min(255, img.data[i+1] + n));
    img.data[i+2] = Math.max(0, Math.min(255, img.data[i+2] + n));
  }
  ctx.putImageData(img,0,0);
  // outer white edges
  ctx.fillStyle = '#d0d0c8'; ctx.fillRect(0,0,16,c.height); ctx.fillRect(c.width-16,0,16,c.height);
  // YELLOW center double line
  ctx.fillStyle = '#e8c020';
  ctx.fillRect(c.width*.5-8, 0, 6, c.height);
  ctx.fillRect(c.width*.5+2, 0, 6, c.height);
  // white dashed lane markers
  ctx.fillStyle = '#d8d8d0';
  for (let y = 0; y < c.height; y += 120) {
    ctx.fillRect(c.width*.25-4, y, 8, 60);
    ctx.fillRect(c.width*.75-4, y, 8, 60);
  }
  // cracks
  ctx.strokeStyle = 'rgba(8,8,12,.7)'; ctx.lineWidth = 1;
  for (let k = 0; k < 30; k++) {
    ctx.beginPath();
    let x = Math.random()*c.width, y = Math.random()*c.height;
    ctx.moveTo(x,y);
    for (let i = 0; i < 5; i++) { x += (Math.random()-.5)*40; y += (Math.random()-.5)*40; ctx.lineTo(x,y); }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 8);
  tex.anisotropy = 8;
  return tex;
}

// — Procedural sky texture (3-stop gradient w/ clouds)
function makeSkyTexture(palette) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0,0,0,c.height);
  g.addColorStop(0, palette[0]);
  g.addColorStop(.5, palette[1]);
  g.addColorStop(1, palette[2]);
  ctx.fillStyle = g; ctx.fillRect(0,0,c.width,c.height);
  // soft cloud bands
  for (let k = 0; k < 30; k++) {
    const x = Math.random()*c.width, y = Math.random()*c.height*.7;
    const r = 30 + Math.random()*120;
    const grd = ctx.createRadialGradient(x,y,0,x,y,r);
    grd.addColorStop(0, 'rgba(255,255,255,.18)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(x,y,r,0,6.28); ctx.fill();
  }
  return new THREE.CanvasTexture(c);
}

// — Distant silhouette horizon (mountains/skyline)
function makeHorizonTexture(courseId) {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  ctx.fillStyle = 'rgba(10,12,18,.92)';
  ctx.beginPath(); ctx.moveTo(0, c.height);
  if (courseId === 'city') {
    // skyline
    let x = 0;
    while (x < c.width) {
      const w = 30 + Math.random()*80;
      const h = 60 + Math.random()*160;
      ctx.lineTo(x, c.height - h);
      ctx.lineTo(x + w, c.height - h);
      x += w;
    }
  } else {
    // mountains
    let x = 0;
    while (x <= c.width) {
      const peak = 80 + Math.random()*140;
      ctx.lineTo(x, c.height - peak);
      x += 40 + Math.random()*60;
    }
  }
  ctx.lineTo(c.width, c.height); ctx.closePath(); ctx.fill();
  // window lights for city
  if (courseId === 'city') {
    ctx.fillStyle = 'rgba(255,210,120,.7)';
    for (let i = 0; i < 200; i++) {
      ctx.fillRect(Math.random()*c.width, c.height - Math.random()*140, 2, 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  return tex;
}

function initThree() {
  const canvas = $('gameCanvas');
  const W = innerWidth, H = innerHeight;
  const course = COURSES.find(c => c.id === S.course) || COURSES[0];

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(W, H);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  scene = new THREE.Scene();
  scene.background = makeSkyTexture(course.sky);
  scene.fog = new THREE.FogExp2(new THREE.Color(course.sky[1]).multiplyScalar(.7), course.fog);

  camera = new THREE.PerspectiveCamera(70, W/H, .1, 500);
  camera.position.set(0, 2.0, 4);
  camera.lookAt(0, 1.5, -10);

  // — LIGHTING (realistic)
  const sunColor = new THREE.Color(course.sky[2]).lerp(new THREE.Color('#fff'), .5);
  const sun = new THREE.DirectionalLight(sunColor, 1.1);
  sun.position.set(20, 30, -10);
  scene.add(sun);

  const ambient = new THREE.AmbientLight(new THREE.Color(course.sky[0]).lerp(new THREE.Color('#fff'), .3), .55);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(new THREE.Color(course.sky[1]), new THREE.Color(course.ground), .4);
  scene.add(hemi);

  // — ROAD
  recyclables = [];
  obstacles = [];

  const asphaltTex = makeAsphaltTexture(course.accent);
  const roadGeo = new THREE.PlaneGeometry(ROAD_WIDTH, ROAD_LEN, 1, 1);
  const roadMat = new THREE.MeshLambertMaterial({ map: asphaltTex });
  roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.rotation.x = -Math.PI/2;
  roadMesh.position.set(0, 0, -ROAD_LEN/2);
  scene.add(roadMesh);

  // — Side ground (course-tinted)
  const sideGroundMat = new THREE.MeshLambertMaterial({ color: course.ground });
  const sideL = new THREE.Mesh(new THREE.PlaneGeometry(80, ROAD_LEN), sideGroundMat);
  sideL.rotation.x = -Math.PI/2; sideL.position.set(-45, -.01, -ROAD_LEN/2); scene.add(sideL);
  const sideR = sideL.clone(); sideR.position.x = 45; scene.add(sideR);

  // — Curbs along road edge
  const curbMat = new THREE.MeshLambertMaterial({ color: '#3a3a3a' });
  const curbGeo = new THREE.BoxGeometry(.4, .25, ROAD_LEN);
  for (const x of [-ROAD_WIDTH/2 - .2, ROAD_WIDTH/2 + .2]) {
    const c = new THREE.Mesh(curbGeo, curbMat);
    c.position.set(x, .12, -ROAD_LEN/2);
    scene.add(c);
  }

  // — Distant horizon ring
  const horizonTex = makeHorizonTexture(course.id);
  const horizonGeo = new THREE.CylinderGeometry(200, 200, 50, 64, 1, true);
  const horizonMat = new THREE.MeshBasicMaterial({ map: horizonTex, transparent: true, side: THREE.BackSide, depthWrite: false });
  const horizon = new THREE.Mesh(horizonGeo, horizonMat);
  horizon.position.y = 12; scene.add(horizon);

  // — Scenery (recyclable street props)
  buildScenery(course);

  // — Rain particles
  if (course.rain > 0) {
    const rainCount = course.rain * 8;
    const rainGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount; i++) {
      positions[i*3]   = (Math.random()-.5) * 80;
      positions[i*3+1] = Math.random() * 30;
      positions[i*3+2] = -Math.random() * ROAD_LEN;
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const rainMat = new THREE.PointsMaterial({
      color: course.id === 'snow' ? 0xffffff : 0xaac8e0,
      size: course.id === 'snow' ? .25 : .12,
      transparent: true, opacity: course.id === 'snow' ? .9 : .6,
      depthWrite: false,
    });
    rainSystem = new THREE.Points(rainGeo, rainMat);
    scene.add(rainSystem);
  } else {
    rainSystem = null;
  }

  // — Post-processing removed (using direct renderer for stability)
  composer = null;
}

function addRecyclable(obj, span) {
  obj.userData.span = span || ROAD_LEN;
  recyclables.push(obj);
}

function buildScenery(course) {
  // Course-specific street props (lamps, trees, rocks) — realistic only
  const SPAN = ROAD_LEN;
  const reg = (o) => { scene.add(o); addRecyclable(o, SPAN); return o; };

  // Street lamps every 10m on both sides
  if (['city','storm','sunset','ocean'].includes(course.id)) {
    const lampPoleMat = new THREE.MeshLambertMaterial({ color: '#1a1a1a' });
    const lampHeadMat = new THREE.MeshBasicMaterial({ color: '#ffd47a' });
    for (let z = 0; z > -ROAD_LEN; z -= 12) {
      for (const sx of [-1, 1]) {
        const g = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(.08, .1, 5, 6), lampPoleMat);
        pole.position.y = 2.5; g.add(pole);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(.7, .08, .08), lampPoleMat);
        arm.position.set(-sx*.35, 4.8, 0); g.add(arm);
        const head = new THREE.Mesh(new THREE.BoxGeometry(.5, .25, .35), lampHeadMat);
        head.position.set(-sx*.7, 4.7, 0); g.add(head);
        g.position.set(sx * (ROAD_WIDTH/2 + 1.2), 0, z);
        reg(g);
      }
    }
  }

  // Trees (forest/jungle/mountain)
  if (['forest','jungle','mountain','sunset'].includes(course.id)) {
    const trunkMat = new THREE.MeshLambertMaterial({ color: '#3a2818' });
    const leafCols = course.id === 'jungle' ? ['#1a5828','#2a6838','#3a7848'] :
                     course.id === 'forest' ? ['#2a4828','#1a3818','#3a5828'] :
                     ['#2a3828','#3a4838','#1a2818'];
    for (let z = 0; z > -ROAD_LEN; z -= 8) {
      for (const sx of [-1, 1]) {
        const g = new THREE.Group();
        const h = 5 + Math.random()*4;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.2, .35, h, 6), trunkMat);
        trunk.position.y = h/2; g.add(trunk);
        for (let k = 0; k < 3; k++) {
          const r = 2.2 - k*.4;
          const leafMat = new THREE.MeshLambertMaterial({ color: leafCols[k % leafCols.length] });
          const cone = new THREE.Mesh(new THREE.ConeGeometry(r, r*1.4, 7), leafMat);
          cone.position.y = h + k*1.0;
          g.add(cone);
        }
        const x = sx * (ROAD_WIDTH/2 + 3 + Math.random()*8);
        g.position.set(x, 0, z + Math.random()*4);
        reg(g);
      }
    }
  }

  // Desert: cacti + dunes
  if (course.id === 'desert') {
    const cactusMat = new THREE.MeshLambertMaterial({ color: '#5a7838' });
    const duneMat = new THREE.MeshLambertMaterial({ color: '#a87838' });
    for (let z = 0; z > -ROAD_LEN; z -= 10) {
      for (const sx of [-1, 1]) {
        if (Math.random() > .5) {
          const g = new THREE.Group();
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.25, .3, 2.5, 6), cactusMat);
          trunk.position.y = 1.25; g.add(trunk);
          if (Math.random() > .4) {
            const arm = new THREE.Mesh(new THREE.CylinderGeometry(.18, .22, 1.4, 6), cactusMat);
            arm.position.set(.3, 1.4, 0); arm.rotation.z = -.3; g.add(arm);
          }
          g.position.set(sx*(ROAD_WIDTH/2 + 2 + Math.random()*5), 0, z);
          reg(g);
        } else {
          const dune = new THREE.Mesh(new THREE.SphereGeometry(2.5+Math.random()*2, 8, 5), duneMat);
          dune.scale.y = .3;
          dune.position.set(sx*(ROAD_WIDTH/2 + 5 + Math.random()*8), 0, z);
          reg(dune);
        }
      }
    }
  }

  // Mountains: rocks
  if (['mountain','snow','volcano'].includes(course.id)) {
    const rockColor = course.id === 'volcano' ? '#2a1818' : course.id === 'snow' ? '#a8b8c8' : '#5a5048';
    const rockMat = new THREE.MeshLambertMaterial({ color: rockColor, flatShading: true });
    for (let z = 0; z > -ROAD_LEN; z -= 9) {
      for (const sx of [-1, 1]) {
        const g = new THREE.Group();
        const size = .8 + Math.random()*1.4;
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), rockMat);
        rock.position.y = size*.5;
        rock.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
        g.add(rock);
        if (course.id === 'snow') {
          const snowCap = new THREE.Mesh(new THREE.SphereGeometry(size*.8, 8, 4, 0, 6.28, 0, Math.PI/2), new THREE.MeshLambertMaterial({color:'#f0f4f8'}));
          snowCap.position.y = size*.7; g.add(snowCap);
        }
        g.position.set(sx*(ROAD_WIDTH/2 + 2 + Math.random()*6), 0, z + Math.random()*3);
        reg(g);
      }
    }
  }

  // Volcano: lava cracks + glow rocks
  if (course.id === 'volcano') {
    for (let z = 0; z > -ROAD_LEN; z -= 14) {
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(2+Math.random()*3, .8), new THREE.MeshBasicMaterial({color:'#ff5020',transparent:true,opacity:.7}));
      glow.rotation.x = -Math.PI/2;
      glow.position.set((Math.random()-.5)*30, .02, z);
      reg(glow);
    }
  }

  // City: small buildings between lamps
  if (course.id === 'city') {
    const buildingMat = new THREE.MeshLambertMaterial({ color: '#2a2a32' });
    const winMat = new THREE.MeshBasicMaterial({ color: '#e8c878' });
    for (let z = 0; z > -ROAD_LEN; z -= 14) {
      for (const sx of [-1, 1]) {
        const g = new THREE.Group();
        const w = 4 + Math.random()*3, h = 8 + Math.random()*10, d = 4 + Math.random()*3;
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), buildingMat);
        b.position.y = h/2; g.add(b);
        for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
          if (Math.random() > .4) continue;
          const win = new THREE.Mesh(new THREE.BoxGeometry(.4, .4, .1), winMat);
          win.position.set(-w/2 + 1 + c*1.2, 2 + r*2, d/2 + .05);
          g.add(win);
        }
        g.position.set(sx*(ROAD_WIDTH/2 + 6 + Math.random()*3), 0, z);
        reg(g);
      }
    }
  }

  // Ocean: distant boats hint + railing posts
  if (course.id === 'ocean') {
    const postMat = new THREE.MeshLambertMaterial({ color: '#5a5048' });
    for (let z = 0; z > -ROAD_LEN; z -= 4) {
      for (const sx of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(.15, 1, .15), postMat);
        p.position.set(sx*(ROAD_WIDTH/2 + .5), .5, z); reg(p);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// OBSTACLE: REAL TRAFFIC BARRICADE (orange + white stripes)
// ═══════════════════════════════════════════════════════════════
function buildBarricade(exType) {
  const g = new THREE.Group();
  const stripeWidth = 9, stripeHeight = 1.4;
  // Striped panel(s) — main rectangle made of canvas texture
  const stripeC = document.createElement('canvas');
  stripeC.width = 512; stripeC.height = 80;
  const sctx = stripeC.getContext('2d');
  sctx.fillStyle = '#f4f0e8'; sctx.fillRect(0,0,512,80);
  for (let i = 0; i < 12; i++) {
    if (i % 2 === 0) continue;
    sctx.fillStyle = '#ff6b1a';
    sctx.beginPath();
    sctx.moveTo(i*44, 0);
    sctx.lineTo(i*44 + 60, 0);
    sctx.lineTo(i*44 + 100, 80);
    sctx.lineTo(i*44 + 40, 80);
    sctx.closePath();
    sctx.fill();
  }
  // border
  sctx.strokeStyle = '#1a1a1a'; sctx.lineWidth = 6;
  sctx.strokeRect(3, 3, 506, 74);
  const stripeTex = new THREE.CanvasTexture(stripeC);
  const stripeMat = new THREE.MeshLambertMaterial({ map: stripeTex });
  const stripeBackMat = new THREE.MeshLambertMaterial({ color: '#d0c8b8' });

  // Build differently per exercise:
  // jump → low wide barrier
  // duck → high horizontal bar
  // squat → mid bar
  // left/right → barrier blocking one side
  if (exType === 'jump') {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(stripeWidth, stripeHeight, .25), [stripeBackMat,stripeBackMat,stripeBackMat,stripeBackMat,stripeMat,stripeMat]);
    panel.position.y = .7; g.add(panel);
    // legs
    const legMat = new THREE.MeshLambertMaterial({color:'#1a1a1a'});
    for (const x of [-stripeWidth/2 + .3, stripeWidth/2 - .3]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(.2, 1.4, .8), legMat);
      leg.position.set(x, .7, 0); g.add(leg);
    }
  } else if (exType === 'duck') {
    // overhead bar with vertical posts
    const postMat = new THREE.MeshLambertMaterial({color:'#1a1a1a'});
    for (const x of [-stripeWidth/2, stripeWidth/2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(.25, 3.6, .25), postMat);
      post.position.set(x, 1.8, 0); g.add(post);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(stripeWidth, .8, .25), [stripeBackMat,stripeBackMat,stripeBackMat,stripeBackMat,stripeMat,stripeMat]);
    bar.position.y = 3.0; g.add(bar);
  } else if (exType === 'squat') {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(stripeWidth, stripeHeight*1.5, .25), [stripeBackMat,stripeBackMat,stripeBackMat,stripeBackMat,stripeMat,stripeMat]);
    panel.position.y = 1.5; g.add(panel);
    const legMat = new THREE.MeshLambertMaterial({color:'#1a1a1a'});
    for (const x of [-stripeWidth/2 + .3, stripeWidth/2 - .3]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(.2, 2.5, .8), legMat);
      leg.position.set(x, 1.25, 0); g.add(leg);
    }
  } else if (exType === 'left' || exType === 'right') {
    // half-width barrier on one side
    const side = exType === 'left' ? 1 : -1; // blocks right side if lean left
    const halfW = stripeWidth/2;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(halfW, 2.4, .25), [stripeBackMat,stripeBackMat,stripeBackMat,stripeBackMat,stripeMat,stripeMat]);
    panel.position.set(side * halfW/2, 1.2, 0); g.add(panel);
    const legMat = new THREE.MeshLambertMaterial({color:'#1a1a1a'});
    const leg = new THREE.Mesh(new THREE.BoxGeometry(.2, 2.4, .8), legMat);
    leg.position.set(side * (halfW - .3), 1.2, 0); g.add(leg);
  }
  return g;
}

// ═══════════════════════════════════════════════════════════════
// GAME LOOP
// ═══════════════════════════════════════════════════════════════
let nextSpawn = 0, spawnIv = 5, graceT = 8, lastTime = 0;
let promptActive = null, smoothSpeed = 0, frameCount = 0;
let runStartTs = 0, runDuration = 90; // 90 seconds = 1 run

function startGame() {
  showScreen('screen-game');
  initThree();
  S.hearts = 3; S.score = 0; S.distance = 0; S.calories = 0; S.combo = 0; S.bestCombo = 0;
  scoreVal = 0; distTotal = 0; smoothSpeed = 0;
  nextSpawn = graceT; spawnIv = DIFF[S.diff].react + 1.5;
  promptActive = null;
  obstacles = [];
  graceT = 6;
  lastTime = performance.now()/1000;
  runStartTs = performance.now()/1000;

  renderHearts();
  setupPose();
  if (animId) cancelAnimationFrame(animId);
  loop();

  addEventListener('resize', onResize);
}

function onResize() {
  if (!renderer) return;
  const W = innerWidth, H = innerHeight;
  renderer.setSize(W, H);
  camera.aspect = W/H; camera.updateProjectionMatrix();
}

function renderHearts() {
  const c = $('hud-hearts'); c.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const d = document.createElement('div');
    d.className = 'hud-heart' + (i >= S.hearts ? ' empty' : '');
    c.appendChild(d);
  }
}

function flashScreen(kind) {
  const f = $('flash');
  f.className = kind;
  setTimeout(() => { f.className = ''; }, 220);
}

function showStatus(text, color) {
  const el = $('hud-status');
  el.textContent = text;
  el.style.color = color;
  el.className = 'hud-status show';
  setTimeout(() => { el.classList.remove('show'); }, 600);
}

function spawnObstacle() {
  const type = EX_TYPES[Math.floor(Math.random() * EX_TYPES.length)];
  const mesh = buildBarricade(type);
  mesh.position.z = -90;
  mesh.userData = {
    type, hit: false, prompt: false, passed: false,
    spawnTime: performance.now()/1000,
  };
  scene.add(mesh);
  obstacles.push(mesh);
}

function showPrompt(exType, secLeft) {
  const ex = EX[exType];
  $('hud-prompt-icon').innerHTML = ex.svg;
  $('hud-prompt-label').textContent = ex.label;
  $('hud-prompt-timer').textContent = secLeft.toFixed(1) + 's';
  $('hud-prompt').classList.add('show');
}
function hidePrompt() { $('hud-prompt').classList.remove('show'); }

function passObstacle(obs) {
  obs.userData.passed = true;
  S.score += 100 + S.combo * 20;
  S.combo++;
  S.bestCombo = Math.max(S.bestCombo, S.combo);
  // calories: METs * weight * time
  S.calories += 0.08 * (S.weight / 70);
  flashScreen('good');
  showStatus('PERFECT!', '#5cdfff');
  sfx(660, .18, 'square', .25);
  sfx(880, .14, 'square', .2);
  if (S.combo > 1) {
    $('hud-combo').style.display = 'flex';
    $('hud-combo-text').textContent = 'x' + S.combo;
  }
}

function failObstacle(obs) {
  obs.userData.hit = true;
  S.hearts--;
  S.combo = 0;
  $('hud-combo').style.display = 'none';
  flashScreen('bad');
  showStatus('MISS!', '#ff5050');
  sfx(180, .35, 'sawtooth', .3);
  renderHearts();
  if (S.hearts <= 0) gameOver();
}

function loop() {
  animId = requestAnimationFrame(loop);
  frameCount++;
  const now = performance.now()/1000;
  let dt = now - lastTime; lastTime = now;
  dt = Math.min(dt, 0.05);

  const elapsed = now - runStartTs;
  const targetSpeed = DIFF[S.diff].spd * (1 + Math.min(.5, elapsed/120));
  smoothSpeed += (targetSpeed - smoothSpeed) * Math.min(1, dt * 2.5);

  distTotal += smoothSpeed * dt * 6;
  scoreVal += dt * smoothSpeed * 8;
  S.distance = Math.floor(distTotal);

  // — scroll all recyclables (road, scenery, dashes)
  const moveZ = smoothSpeed * dt * 9;
  for (const r of recyclables) {
    r.position.z += moveZ;
    if (r.position.z > 6) r.position.z -= r.userData.span;
  }
  // — scroll road texture for asphalt motion
  if (roadMesh && roadMesh.material.map) {
    roadMesh.material.map.offset.y -= moveZ / ROAD_LEN * 8;
  }
  // — rain falls
  if (rainSystem) {
    const pos = rainSystem.geometry.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i+1] -= 30 * dt; // fall speed
      pos[i+2] += moveZ;
      if (pos[i+1] < 0) { pos[i+1] = 20 + Math.random()*10; pos[i] = (Math.random()-.5)*80; }
      if (pos[i+2] > 6) pos[i+2] -= ROAD_LEN;
    }
    rainSystem.geometry.attributes.position.needsUpdate = true;
  }

  // — camera bob (smooth)
  camera.position.y = 2.0 + Math.sin(now * 4) * .04;
  camera.position.x = Math.sin(now * 2.5) * .025;
  camera.rotation.z = Math.sin(now * 3) * .005;

  // — obstacle spawning
  graceT -= dt;
  if (graceT <= 0) {
    nextSpawn -= dt;
    if (nextSpawn <= 0 && obstacles.filter(o => !o.userData.passed && !o.userData.hit).length < 2) {
      spawnObstacle();
      nextSpawn = spawnIv + (Math.random()-.5)*.6;
    }
  }

  // — obstacle progression
  for (const obs of obstacles) {
    obs.position.z += moveZ;
    const dist = -obs.position.z; // distance to player
    // start showing prompt when 4s away
    const timeToReach = dist / (smoothSpeed * 9);
    if (!obs.userData.passed && !obs.userData.hit) {
      if (dist < 50 && dist > 1 && !obs.userData.prompted) {
        obs.userData.prompted = true;
        promptActive = obs;
      }
      if (promptActive === obs) {
        showPrompt(obs.userData.type, Math.max(0, timeToReach));
        // check pose detection
        const detected = detectPose(obs.userData.type);
        if (detected) {
          passObstacle(obs);
          promptActive = null;
          hidePrompt();
        } else if (dist < 2.5) {
          // failed to perform action in time
          failObstacle(obs);
          promptActive = null;
          hidePrompt();
        }
      }
    }
    if (obs.position.z > 8) {
      scene.remove(obs);
    }
  }
  obstacles = obstacles.filter(o => o.position.z <= 8);

  // — HUD update
  if (frameCount % 3 === 0) {
    const progress = Math.min(100, (elapsed / runDuration) * 100);
    $('hud-progress').style.width = progress + '%';
    $('hud-dist').textContent = S.distance;
    $('hud-score').textContent = Math.floor(scoreVal + S.score);
    $('hud-cal').textContent = S.calories.toFixed(1);
  }

  // — finish run
  if (elapsed > runDuration) { gameOver(true); return; }

  renderer.render(scene, camera);
}

// ═══════════════════════════════════════════════════════════════
// POSE DETECTION — MediaPipe with GREEN SKELETON overlay
// ═══════════════════════════════════════════════════════════════
let poseLandmarker = null, poseCamera = null, lastLandmarks = null;
let poseHistory = []; // for velocity/state detection
let baselineY = null, baselineShoulderX = null;
let actionCooldown = {};

const POSE_CONNECTIONS = [
  [11,12],[11,13],[13,15],[12,14],[14,16], // arms + shoulders
  [11,23],[12,24],[23,24],                  // torso
  [23,25],[25,27],[27,29],[27,31],          // left leg
  [24,26],[26,28],[28,30],[28,32],          // right leg
];

function setupPose() {
  if (demoMode || !camStream || typeof Pose === 'undefined') return;
  const video = $('camVideo');
  const overlay = $('poseOverlay');
  const octx = overlay.getContext('2d');

  const sizeOverlay = () => {
    const r = $('camPip').getBoundingClientRect();
    overlay.width = r.width; overlay.height = r.height;
  };
  sizeOverlay(); addEventListener('resize', sizeOverlay);

  poseLandmarker = new Pose({
    locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${f}`,
  });
  poseLandmarker.setOptions({
    modelComplexity: 0, // fastest
    smoothLandmarks: true,
    enableSegmentation: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  poseLandmarker.onResults((res) => {
    octx.clearRect(0, 0, overlay.width, overlay.height);
    if (!res.poseLandmarks) return;
    lastLandmarks = res.poseLandmarks;

    // Draw GREEN skeleton
    const W = overlay.width, H = overlay.height;
    octx.strokeStyle = '#39ff6a';
    octx.lineWidth = 3;
    octx.shadowColor = '#39ff6a';
    octx.shadowBlur = 6;
    for (const [a,b] of POSE_CONNECTIONS) {
      const la = res.poseLandmarks[a], lb = res.poseLandmarks[b];
      if (!la || !lb || la.visibility < .3 || lb.visibility < .3) continue;
      octx.beginPath();
      octx.moveTo(la.x*W, la.y*H);
      octx.lineTo(lb.x*W, lb.y*H);
      octx.stroke();
    }
    // Joint dots
    octx.fillStyle = '#5cff8a';
    octx.shadowBlur = 8;
    for (const lm of res.poseLandmarks) {
      if (lm.visibility < .3) continue;
      octx.beginPath(); octx.arc(lm.x*W, lm.y*H, 3.5, 0, 6.28); octx.fill();
    }
    octx.shadowBlur = 0;

    // Update detection state
    updatePoseState(res.poseLandmarks);
  });

  poseCamera = new Camera(video, {
    onFrame: async () => { await poseLandmarker.send({ image: video }); },
    width: 320, height: 240,
  });
  poseCamera.start();
}

const POSE_STATE = { jump:false, squat:false, duck:false, left:false, right:false };

function updatePoseState(lm) {
  // Use hip (23,24) average Y as body-Y reference; shoulder midpoint X for lean.
  const hipY = (lm[23].y + lm[24].y) / 2;
  const shY = (lm[11].y + lm[12].y) / 2;
  const shX = (lm[11].x + lm[12].x) / 2;
  const hipX = (lm[23].x + lm[24].x) / 2;
  const headY = lm[0].y;

  if (baselineY === null) { baselineY = hipY; baselineShoulderX = shX; return; }
  // slow drift baseline
  baselineY = baselineY * 0.992 + hipY * 0.008;
  baselineShoulderX = baselineShoulderX * 0.992 + shX * 0.008;

  // JUMP: hip rose meaningfully (lower y = up in image coords)
  POSE_STATE.jump  = (baselineY - hipY) > 0.06;
  // SQUAT: hip dropped, head Y dropped a lot
  POSE_STATE.squat = (hipY - baselineY) > 0.05 && (lm[0].y > 0.35);
  // DUCK: head Y dropped (head closer to bottom of frame)
  POSE_STATE.duck  = (headY > 0.45) && !POSE_STATE.squat;
  // LEAN LEFT/RIGHT (mirror: video is flipped, so left lean = shoulders move right in raw coords)
  const leanDelta = shX - baselineShoulderX;
  POSE_STATE.right = leanDelta < -0.07;
  POSE_STATE.left  = leanDelta > 0.07;
}

function detectPose(exType) {
  if (demoMode) return Math.random() > 0.985;
  // Real pose state
  if (POSE_STATE[exType]) return true;
  // Keyboard fallback (for testing on desktop)
  if (keyState[exType]) return true;
  return false;
}

// Keyboard fallback for testing
const keyState = {};
addEventListener('keydown', (e) => {
  const map = { 'arrowup':'jump', 'space':'jump', ' ':'jump', 'arrowdown':'duck', 'shift':'squat', 'arrowleft':'left', 'arrowright':'right' };
  const k = e.key.toLowerCase();
  if (map[k]) keyState[map[k]] = true;
});
addEventListener('keyup', (e) => {
  const map = { 'arrowup':'jump', 'space':'jump', ' ':'jump', 'arrowdown':'duck', 'shift':'squat', 'arrowleft':'left', 'arrowright':'right' };
  const k = e.key.toLowerCase();
  if (map[k]) setTimeout(() => keyState[map[k]] = false, 50);
});

// ═══════════════════════════════════════════════════════════════
// GAME OVER
// ═══════════════════════════════════════════════════════════════
function gameOver(finished) {
  if (animId) cancelAnimationFrame(animId);
  // Count this run against daily limit (for free users)
  if (!isPro()) incDailyRuns();
  showScreen('screen-gameover');
  const finalScore = Math.floor(scoreVal + S.score);
  $('go-msg').textContent = finished
    ? `Crushed it, ${S.name}!`
    : `Nice try, ${S.name}! Run again?`;
  $('go-score').textContent = finalScore;
  $('go-dist').textContent = S.distance + 'M';
  $('go-cal').textContent = S.calories.toFixed(1);
  $('go-combo').textContent = S.bestCombo;
  // Save to local leaderboard
  saveRun({ score: finalScore, distance: S.distance, calories: +S.calories.toFixed(1), combo: S.bestCombo, course: S.course, ts: Date.now() });
  renderLeaderboard();
  if (window.plausible) window.plausible('Run Complete', { props: { course: S.course, diff: S.diff } });
}

function saveRun(run) {
  const list = JSON.parse(localStorage.getItem('ba_runs') || '[]');
  list.push(run);
  list.sort((a,b) => b.score - a.score);
  localStorage.setItem('ba_runs', JSON.stringify(list.slice(0, 50)));
}

function renderLeaderboard() {
  const list = JSON.parse(localStorage.getItem('ba_runs') || '[]').slice(0, 5);
  const el = $('leaderboard-list');
  if (!list.length) { el.innerHTML = '<div style="color:#aab4c2;font-size:13px;text-align:center;padding:8px;">No runs yet — start crushing!</div>'; return; }
  el.innerHTML = list.map((r, i) => {
    const c = COURSES.find(c => c.id === r.course) || COURSES[0];
    const medal = ['🥇','🥈','🥉','4.','5.'][i];
    return `<div style="display:grid;grid-template-columns:32px 1fr auto auto;gap:10px;align-items:center;padding:6px 4px;border-bottom:1px solid #2a3548;font-size:13px;">
      <div style="font-family:'Bangers',cursive;color:#ffc424;font-size:18px;">${medal}</div>
      <div>${c.emoji} ${c.name}</div>
      <div style="color:#aab4c2;">${r.distance}M</div>
      <div style="font-family:'Bangers',cursive;color:#fff;font-size:18px;">${r.score}</div>
    </div>`;
  }).join('');
}

function shareRun() {
  const score = Math.floor(scoreVal + S.score);
  const text = `Just scored ${score} on BodyArcade 🔥 ${S.distance}M run, ${S.calories.toFixed(1)} kcal burned. Move your body, rule the game.`;
  const url = 'https://bodyarcade.com/';
  if (navigator.share) {
    navigator.share({ title: 'BodyArcade', text, url }).catch(() => {});
  } else {
    // Twitter intent fallback
    open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
  }
  if (window.plausible) window.plausible('Share Run');
}

function restartGame() { startGame(); }
function goHome() {
  if (animId) cancelAnimationFrame(animId);
  showScreen('screen-onboard');
}

// ═══════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════
addEventListener('DOMContentLoaded', () => {
  buildCourseGrid();
  obBgAnim();
  obHeroAnim();
  // Show lock icons on difficulty cards if not Pro
  if (!isPro()) {
    const lh = $('lock-hard'); if (lh) lh.style.display = 'block';
    const li = $('lock-insane'); if (li) li.style.display = 'block';
  }
  // Add "runs left today" hint on slide 1
  const obSlide1 = $('ob-1');
  if (obSlide1 && !isPro()) {
    const left = DAILY_FREE_LIMIT - getDailyRuns();
    const hint = document.createElement('div');
    hint.style.cssText = 'margin-top:14px;font-family:Bangers,cursive;font-size:14px;letter-spacing:.08em;color:#5cdfff;';
    hint.textContent = left > 0 ? `${left} FREE RUNS LEFT TODAY` : 'NO FREE RUNS LEFT — UNLOCK PRO';
    obSlide1.appendChild(hint);
  } else if (obSlide1 && isPro()) {
    const hint = document.createElement('div');
    hint.style.cssText = 'margin-top:14px;font-family:Bangers,cursive;font-size:14px;letter-spacing:.08em;color:#ffc424;';
    hint.textContent = '⭐ PRO MEMBER — UNLIMITED RUNS';
    obSlide1.appendChild(hint);
  }
});
