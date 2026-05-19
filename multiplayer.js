// ═══════════════════════════════════════════════════════════════
// BodyArcade — Multiplayer (Supabase Realtime)
// • Async Ghost Mode (top 5 scores per world load as ghost runners)
// • Live 50-player Lobby (real-time progress + leaderboard)
// • Global Leaderboard
// ═══════════════════════════════════════════════════════════════
'use strict';

const SUPABASE_URL = 'https://ikkhvgmenjtauzmugeyk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlra2h2Z21lbmp0YXV6bXVnZXlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMDQ4NTcsImV4cCI6MjA5NDc4MDg1N30.cfjKygwR0CDTiTTDjWrlkbTKRcMWHl4O5Gm_abSpDBM';

let sb = null;

(function initSupabase(){
  if (typeof supabase === 'undefined') {
    console.warn('Supabase SDK not loaded yet');
    return;
  }
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
})();

// ═══════════════════════════════════════════════════════════════
// 1. GLOBAL LEADERBOARD + Run Upload
// ═══════════════════════════════════════════════════════════════
async function uploadRun(stats) {
  if (!sb) return null;
  try {
    const row = {
      name: (stats.name || 'Anonymous').slice(0, 30),
      score: stats.score | 0,
      distance: stats.distance | 0,
      kcal: +(stats.kcal || 0).toFixed(2),
      combo: stats.combo | 0,
      world: stats.world || 'mountain',
      diff: stats.diff || 'medium',
    };
    const { data, error } = await sb.from('runs').insert(row).select();
    if (error) { console.warn('upload run err', error); return null; }
    return data && data[0];
  } catch (e) { console.warn('upload err', e); return null; }
}

async function fetchTopRuns(world, limit=10) {
  if (!sb) return [];
  const q = sb.from('runs').select('*').order('score', { ascending: false }).limit(limit);
  if (world) q.eq('world', world);
  const { data, error } = await q;
  if (error) { console.warn('fetch runs err', error); return []; }
  return data || [];
}

async function fetchMyRank(score, world) {
  if (!sb) return null;
  let q = sb.from('runs').select('id', { count: 'exact', head: true }).gt('score', score);
  if (world) q = q.eq('world', world);
  const { count, error } = await q;
  if (error) return null;
  return (count || 0) + 1;
}

// ═══════════════════════════════════════════════════════════════
// 2. ASYNC GHOST MODE — load top 5 scores, animate as ghosts
// ═══════════════════════════════════════════════════════════════
let ghostRunners = []; // visible during game

async function loadGhosts(world) {
  ghostRunners = await fetchTopRuns(world, 5);
  return ghostRunners;
}

function getGhosts() { return ghostRunners; }

// Live progress simulation for ghosts during your run.
// Each ghost has a "speed" based on their final score over 90s run.
// We render their progress next to your progress bar.
function renderGhostLeaderboard(myScore, elapsedSec, totalSec) {
  if (!ghostRunners.length) return '';
  // Each ghost's simulated current score at this elapsed time
  const list = ghostRunners.map(g => {
    const progress = Math.min(1, elapsedSec / totalSec);
    return { name: g.name, currentScore: Math.floor(g.score * progress), isMe: false };
  });
  list.push({ name: 'YOU', currentScore: Math.floor(myScore), isMe: true });
  list.sort((a,b) => b.currentScore - a.currentScore);
  return list.slice(0, 6).map((p, i) => {
    return `<div style="display:flex;align-items:center;gap:6px;padding:2px 6px;font-family:Bangers,cursive;font-size:12px;letter-spacing:.04em;${p.isMe?'background:rgba(255,196,36,.15);border-radius:4px;':''}">
      <span style="color:#aab4c2;width:14px;text-align:right;">${i+1}.</span>
      <span style="flex:1;color:${p.isMe?'#ffc424':'#fff'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px;">${escapeMP(p.name)}</span>
      <span style="color:${p.isMe?'#ffc424':'#5cdfff'};">${p.currentScore}</span>
    </div>`;
  }).join('');
}

function escapeMP(s) {
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ═══════════════════════════════════════════════════════════════
// 3. LIVE LOBBY — real-time 50-player race
// ═══════════════════════════════════════════════════════════════
const LOBBY = {
  channel: null,
  lobbyId: null,
  myId: null,
  players: new Map(),
  state: 'idle', // idle, waiting, countdown, racing, done
  onChange: null,
};

function genLobbyId() {
  // Each 5-minute window has its own lobby ID — players auto-grouped
  const slot = Math.floor(Date.now() / (5*60*1000));
  return 'race-' + slot;
}

async function joinLobby(myName) {
  if (!sb) { alert('Multiplayer not ready'); return false; }
  LOBBY.lobbyId = genLobbyId();
  LOBBY.myId = 'p' + Math.random().toString(36).slice(2, 10);
  LOBBY.players.clear();
  LOBBY.state = 'waiting';

  // Subscribe to lobby channel
  LOBBY.channel = sb.channel('lobby:' + LOBBY.lobbyId, { config: { presence: { key: LOBBY.myId } } });

  LOBBY.channel
    .on('presence', { event: 'sync' }, () => {
      const state = LOBBY.channel.presenceState();
      LOBBY.players.clear();
      Object.entries(state).forEach(([id, presences]) => {
        const p = presences[0];
        if (p) LOBBY.players.set(id, p);
      });
      if (LOBBY.onChange) LOBBY.onChange();
    })
    .on('broadcast', { event: 'progress' }, ({ payload }) => {
      const ex = LOBBY.players.get(payload.id);
      if (ex) {
        Object.assign(ex, payload);
        if (LOBBY.onChange) LOBBY.onChange();
      }
    })
    .on('broadcast', { event: 'start' }, () => {
      LOBBY.state = 'countdown';
      if (LOBBY.onChange) LOBBY.onChange();
    });

  await LOBBY.channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await LOBBY.channel.track({
        id: LOBBY.myId,
        name: (myName || 'Player').slice(0, 20),
        score: 0,
        progress: 0,
        ready: false,
        ts: Date.now(),
      });
    }
  });
  return true;
}

async function setLobbyReady(ready) {
  if (!LOBBY.channel) return;
  await LOBBY.channel.track({
    ...LOBBY.players.get(LOBBY.myId),
    id: LOBBY.myId,
    ready,
    ts: Date.now(),
  });
}

async function broadcastProgress(progress, score) {
  if (!LOBBY.channel) return;
  LOBBY.channel.send({
    type: 'broadcast',
    event: 'progress',
    payload: { id: LOBBY.myId, score, progress, ts: Date.now() },
  });
}

async function leaveLobby() {
  if (LOBBY.channel) {
    await LOBBY.channel.unsubscribe();
    LOBBY.channel = null;
    LOBBY.lobbyId = null;
    LOBBY.players.clear();
    LOBBY.state = 'idle';
  }
}

function getLobbyState() {
  return {
    state: LOBBY.state,
    players: Array.from(LOBBY.players.values()).sort((a,b) => (b.score||0) - (a.score||0)),
    myId: LOBBY.myId,
    lobbyId: LOBBY.lobbyId,
  };
}

// ═══════════════════════════════════════════════════════════════
// 4. UI: Live Lobby modal
// ═══════════════════════════════════════════════════════════════
async function openLiveLobby() {
  if (!sb) {
    alert('Multiplayer not available — try refreshing the page.');
    return;
  }
  let modal = document.getElementById('lobby-modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'lobby-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);padding:24px;';
  modal.innerHTML = `
    <div style="background:linear-gradient(180deg,#1a2540,#0a1018);border:3px solid #e8302a;border-radius:18px;padding:28px;max-width:680px;width:100%;box-shadow:0 12px 50px rgba(232,48,42,.25);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-family:Bangers,cursive;font-size:30px;color:#ff6b6b;text-shadow:0 4px 0 #5a0a07;letter-spacing:.04em;">⚔️ LIVE LOBBY</div>
        <div style="cursor:pointer;color:#aab4c2;font-size:28px;line-height:1;" onclick="closeLiveLobby()">×</div>
      </div>
      <div id="lobby-info" style="color:#aab4c2;font-size:13px;margin-bottom:18px;">Joining…</div>
      <div id="lobby-players" style="background:rgba(0,0,0,.3);border-radius:10px;border:1px solid #2a3548;padding:8px;max-height:340px;overflow-y:auto;margin-bottom:14px;"></div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
        <button id="lobby-ready-btn" onclick="lobbyReady()" style="font-family:Bangers,cursive;font-size:18px;letter-spacing:.06em;padding:12px 28px;border-radius:12px;border:3px solid #5a3a00;background:linear-gradient(180deg,#ffd95c,#ffc424,#c08800);color:#3a1f00;box-shadow:0 4px 0 #5a3a00;cursor:pointer;">I'M READY ✓</button>
        <button onclick="closeLiveLobby()" style="font-family:Bangers,cursive;font-size:18px;letter-spacing:.06em;padding:12px 28px;border-radius:12px;border:3px solid #0a1018;background:#2a3548;color:#fff;box-shadow:0 4px 0 #0a1018;cursor:pointer;">LEAVE</button>
      </div>
      <div style="margin-top:14px;font-size:11px;color:#5a6878;text-align:center;line-height:1.5;">New lobby every 5 min · 50-player races · Press READY when all set, race starts when 80% ready or in 60s</div>
    </div>
  `;
  document.body.appendChild(modal);
  const name = (typeof S !== 'undefined' && S.name) ? S.name : 'Player';
  const joined = await joinLobby(name);
  if (!joined) {
    document.getElementById('lobby-info').textContent = 'Could not join lobby.';
    return;
  }
  LOBBY.onChange = renderLobbyUI;
  renderLobbyUI();
  // Auto-start timer
  startLobbyAutoStart();
}

function renderLobbyUI() {
  const info = document.getElementById('lobby-info');
  const list = document.getElementById('lobby-players');
  if (!info || !list) return;
  const players = Array.from(LOBBY.players.values());
  const readyCount = players.filter(p => p.ready).length;
  info.innerHTML = `<b style="color:#5cdfff;">${players.length}/50</b> players · <b style="color:#ffc424;">${readyCount} ready</b> · Lobby <code style="color:#5a6878;">${LOBBY.lobbyId || ''}</code>`;
  list.innerHTML = players.map((p, i) => {
    const isMe = p.id === LOBBY.myId;
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;margin-bottom:3px;background:${isMe?'rgba(255,196,36,.12)':'transparent'};">
      <span style="font-family:Bangers,cursive;width:28px;color:#aab4c2;">${i+1}</span>
      <span style="flex:1;color:${isMe?'#ffc424':'#fff'};font-weight:600;">${escapeMP(p.name)}${isMe?' (YOU)':''}</span>
      <span style="font-size:12px;color:${p.ready?'#5cdfff':'#aab4c2'};letter-spacing:.06em;font-family:Bangers,cursive;">${p.ready?'✓ READY':'WAITING'}</span>
    </div>`;
  }).join('') || '<div style="text-align:center;color:#aab4c2;padding:20px;">Waiting for players…</div>';
}

let lobbyAutoStartTimer = null;
function startLobbyAutoStart() {
  let countdown = 60;
  if (lobbyAutoStartTimer) clearInterval(lobbyAutoStartTimer);
  lobbyAutoStartTimer = setInterval(() => {
    countdown--;
    const info = document.getElementById('lobby-info');
    const players = Array.from(LOBBY.players.values());
    const readyCount = players.filter(p => p.ready).length;
    if (info) {
      info.innerHTML = `<b style="color:#5cdfff;">${players.length}/50</b> players · <b style="color:#ffc424;">${readyCount} ready</b> · Starts in <b style="color:#ff6b6b;">${countdown}s</b>`;
    }
    // Auto-start if 80%+ ready OR timer up
    const enoughReady = players.length >= 2 && readyCount / players.length >= 0.8;
    if (countdown <= 0 || enoughReady) {
      clearInterval(lobbyAutoStartTimer);
      lobbyAutoStartTimer = null;
      startLobbyRace();
    }
  }, 1000);
}

function startLobbyRace() {
  closeLiveLobby();
  if (typeof startCamera === 'function') {
    // Force jungle world + medium difficulty for fair lobby race
    if (typeof S !== 'undefined') {
      S.lobbyMode = true;
      S.course = 'mountain'; // Free world so all can join
      S.diff = 'medium';
    }
    startCamera();
  }
}

function lobbyReady() {
  setLobbyReady(true);
  const btn = document.getElementById('lobby-ready-btn');
  if (btn) {
    btn.textContent = '✓ READY!';
    btn.style.background = 'linear-gradient(180deg,#5cdfff,#1aa8e8)';
    btn.style.color = '#fff';
    btn.disabled = true;
  }
}

function closeLiveLobby() {
  if (lobbyAutoStartTimer) { clearInterval(lobbyAutoStartTimer); lobbyAutoStartTimer = null; }
  leaveLobby();
  const m = document.getElementById('lobby-modal');
  if (m) m.remove();
}

// ═══════════════════════════════════════════════════════════════
// 5. GLOBAL LEADERBOARD PANEL
// ═══════════════════════════════════════════════════════════════
async function showGlobalLeaderboard(world) {
  let modal = document.getElementById('global-lb');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'global-lb';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);padding:24px;overflow-y:auto;';
  modal.innerHTML = `
    <div style="background:linear-gradient(180deg,#1a2540,#0a1018);border:3px solid #ffc424;border-radius:18px;padding:28px;max-width:580px;width:100%;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
        <div style="font-family:Bangers,cursive;font-size:30px;color:#ffc424;text-shadow:0 4px 0 #5a3a00;letter-spacing:.04em;">🌍 GLOBAL LEADERBOARD</div>
        <div style="cursor:pointer;color:#aab4c2;font-size:28px;line-height:1;" onclick="document.getElementById('global-lb').remove()">×</div>
      </div>
      <div id="lb-content" style="color:#aab4c2;text-align:center;padding:20px;">Loading…</div>
    </div>
  `;
  document.body.appendChild(modal);
  const top = await fetchTopRuns(world, 20);
  const lbEl = document.getElementById('lb-content');
  if (lbEl) {
    if (!top.length) {
      lbEl.innerHTML = '<div style="padding:30px;">No scores yet — be the first!</div>';
    } else {
      lbEl.innerHTML = `<div style="display:flex;flex-direction:column;gap:4px;">${top.map((r, i) => {
        const m = ['🥇','🥈','🥉'];
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;background:${i<3?'rgba(255,196,36,.08)':'rgba(26,37,64,.4)'};border:1px solid ${i<3?'rgba(255,196,36,.3)':'#2a3548'};">
          <div style="font-family:Bangers,cursive;font-size:18px;width:34px;color:#ffc424;">${m[i]||i+1}</div>
          <div style="flex:1;color:#fff;font-weight:600;">${escapeMP(r.name)}</div>
          <div style="font-size:12px;color:#aab4c2;">${r.world}</div>
          <div style="font-family:Bangers,cursive;font-size:22px;color:#5cdfff;text-shadow:0 2px 0 #0a3040;">${r.score}</div>
        </div>`;
      }).join('')}</div>`;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════
window.BAmulti = {
  uploadRun, fetchTopRuns, fetchMyRank,
  loadGhosts, getGhosts, renderGhostLeaderboard,
  joinLobby, setLobbyReady, broadcastProgress, leaveLobby, getLobbyState,
  openLiveLobby, closeLiveLobby, lobbyReady,
  showGlobalLeaderboard,
};
