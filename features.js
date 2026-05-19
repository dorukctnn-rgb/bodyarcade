// ═══════════════════════════════════════════════════════════════
// BodyArcade — Killer Features (client-side)
// Friend Challenge · Daily Challenge · Achievements · Skins · Tournaments
// ═══════════════════════════════════════════════════════════════
'use strict';

// ──────── HELPERS ────────
const $f = (id) => document.getElementById(id);
const _b64e = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
const _b64d = (str) => { try { return JSON.parse(decodeURIComponent(escape(atob(str)))); } catch(e){ return null; } };

// ═══════════════════════════════════════════════════════════════
// 1. FRIEND CHALLENGE — viral share/beat-my-score
// ═══════════════════════════════════════════════════════════════
const FRIEND = { active: null }; // active challenge data

(function loadFriendFromURL(){
  const m = location.search.match(/[?&]c=([^&]+)/);
  if (!m) return;
  const data = _b64d(m[1]);
  if (data && data.name && data.score && data.world) {
    FRIEND.active = data;
    // Force same world + difficulty
    if (typeof S !== 'undefined') {
      S.course = data.world;
      S.diff = data.diff || 'medium';
    }
  }
})();

function showFriendBanner() {
  if (!FRIEND.active) return;
  const f = FRIEND.active;
  const wname = (typeof COURSES !== 'undefined' && COURSES.find(c=>c.id===f.world))?.name || f.world;
  let banner = $f('friend-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'friend-banner';
    banner.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:200;background:linear-gradient(180deg,#e8302a,#a01b15);border:2px solid #5a0a07;border-radius:14px;padding:10px 22px;box-shadow:0 5px 0 #5a0a07, 0 12px 28px rgba(0,0,0,.5);font-family:Bangers,cursive;font-size:18px;letter-spacing:.06em;color:#fff;text-shadow:0 2px 0 rgba(0,0,0,.4);';
    document.body.appendChild(banner);
  }
  banner.innerHTML = `⚔️ BEAT <b>${escapeHtml(f.name)}</b>'S ${f.score} IN ${wname}`;
}
function hideFriendBanner() {
  const b = $f('friend-banner'); if (b) b.remove();
}

function generateChallengeURL(score, world, diff, name) {
  const data = { name: (name||'Champion').slice(0,20), score, world, diff, ts: Date.now() };
  return location.origin + '/BodyArcade.html?c=' + _b64e(data);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Show challenge result on game over (called from features hook)
function showChallengeResult(myScore) {
  if (!FRIEND.active) return null;
  const f = FRIEND.active;
  const won = myScore > f.score;
  return `
    <div style="margin:20px auto;padding:18px 22px;max-width:520px;background:linear-gradient(180deg,#1a2540,#0a1018);border:3px solid ${won?'#5cdfff':'#ff6b1a'};border-radius:14px;text-align:center;">
      <div style="font-family:Bangers,cursive;font-size:24px;letter-spacing:.06em;color:${won?'#5cdfff':'#ff6b1a'};text-shadow:0 3px 0 rgba(0,0,0,.4);margin-bottom:8px;">
        ${won ? '⚔️ YOU BEAT ' + escapeHtml(f.name).toUpperCase() : '💪 ' + escapeHtml(f.name).toUpperCase() + ' STILL LEADS'}
      </div>
      <div style="display:flex;justify-content:space-around;align-items:center;font-family:Bangers,cursive;color:#fff;">
        <div><div style="font-size:14px;color:#aab4c2;">YOU</div><div style="font-size:32px;color:#ffc424;text-shadow:0 3px 0 #5a3a00;">${myScore}</div></div>
        <div style="font-size:18px;color:#5a6878;">VS</div>
        <div><div style="font-size:14px;color:#aab4c2;">${escapeHtml(f.name).toUpperCase()}</div><div style="font-size:32px;color:#fff;">${f.score}</div></div>
      </div>
      <div style="margin-top:10px;font-size:13px;color:#aab4c2;">
        ${won
          ? '🔥 Now share YOUR score back to your friend!'
          : 'Difference: <b style="color:#ff6b1a">' + (f.score - myScore) + '</b> points'}
      </div>
    </div>`;
}

function shareChallenge(score, world, diff, name) {
  const url = generateChallengeURL(score, world, diff, name);
  const text = `I just scored ${score} on BodyArcade 🎮💪 Can you beat me?\n\n${url}`;
  if (navigator.share) {
    navigator.share({ title: 'BodyArcade Challenge', text, url }).catch(()=>{});
  } else {
    navigator.clipboard.writeText(url).then(() => {
      toast('🔗 Challenge link copied! Send it to a friend.');
    });
  }
  if (window.plausible) window.plausible('Friend Challenge Share');
}

// ═══════════════════════════════════════════════════════════════
// 2. DAILY CHALLENGE — date-seeded
// ═══════════════════════════════════════════════════════════════
function dailySeed() {
  const d = new Date(); return d.getFullYear()*10000 + (d.getMonth()+1)*100 + d.getDate();
}
function srand(seed) {
  return () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
}

function getDailyChallenge() {
  const seed = dailySeed();
  const rand = srand(seed);
  const worlds = (typeof COURSES !== 'undefined' ? COURSES.map(c=>c.id) : ['mountain','desert','forest']);
  const diffs = ['easy','medium','hard','insane'];
  const targetScores = [1500, 2500, 4000, 6000];
  const dIdx = Math.floor(rand()*4);
  return {
    seed,
    world: worlds[Math.floor(rand()*Math.min(3, worlds.length))], // free worlds only
    diff: diffs[Math.min(dIdx, 1)], // easy or medium for free users
    target: targetScores[dIdx],
    reward: dIdx >= 2 ? 'PRO_PERK' : 'BADGE',
  };
}

function isDailyCompletedToday() {
  return localStorage.getItem('ba_daily_done') === String(dailySeed());
}

function markDailyComplete() {
  localStorage.setItem('ba_daily_done', String(dailySeed()));
  const streak = (parseInt(localStorage.getItem('ba_daily_streak')||'0')) + 1;
  localStorage.setItem('ba_daily_streak', String(streak));
  localStorage.setItem('ba_daily_last', String(dailySeed()));
  unlockAchievement('daily-3', streak >= 3);
  unlockAchievement('daily-7', streak >= 7);
  unlockAchievement('daily-30', streak >= 30);
  return streak;
}

function getDailyStreak() {
  return parseInt(localStorage.getItem('ba_daily_streak')||'0');
}

// ═══════════════════════════════════════════════════════════════
// 3. ACHIEVEMENTS
// ═══════════════════════════════════════════════════════════════
const ACHIEVEMENTS = [
  { id:'first-run',  name:'First Steps',     icon:'🎮', desc:'Complete your first run' },
  { id:'10-runs',    name:'Regular',         icon:'🏃', desc:'Complete 10 runs' },
  { id:'100-runs',   name:'Dedicated',       icon:'🔥', desc:'Complete 100 runs' },
  { id:'100-kcal',   name:'Calorie Burner',  icon:'🔥', desc:'Burn 100 total calories' },
  { id:'1000-kcal',  name:'Inferno',         icon:'🌋', desc:'Burn 1000 total calories' },
  { id:'combo-10',   name:'Unstoppable',     icon:'⚡', desc:'Get a 10+ combo' },
  { id:'combo-25',   name:'Untouchable',     icon:'💎', desc:'Get a 25+ combo' },
  { id:'daily-3',    name:'On a Roll',       icon:'📅', desc:'3-day daily streak' },
  { id:'daily-7',    name:'Weekly Warrior',  icon:'🗓️', desc:'7-day daily streak' },
  { id:'daily-30',   name:'Iron Will',       icon:'🏆', desc:'30-day daily streak' },
  { id:'beat-friend',name:'Trash Talker',    icon:'⚔️', desc:'Beat a friend challenge' },
  { id:'all-worlds', name:'World Tour',      icon:'🌍', desc:'Play all 10 worlds (Pro)' },
  { id:'first-pro',  name:'Champion',        icon:'👑', desc:'Upgrade to Pro' },
  { id:'speed-demon',name:'Speed Demon',     icon:'💀', desc:'Complete a run on Insane' },
  { id:'social',     name:'Influencer',      icon:'📤', desc:'Share a challenge' },
];

function unlockAchievement(id, condition=true) {
  if (!condition) return false;
  const have = JSON.parse(localStorage.getItem('ba_achievements')||'[]');
  if (have.includes(id)) return false;
  have.push(id);
  localStorage.setItem('ba_achievements', JSON.stringify(have));
  const ach = ACHIEVEMENTS.find(a=>a.id===id);
  if (ach) {
    toast(`🏆 ACHIEVEMENT: ${ach.icon} ${ach.name}`, 4000);
    if (window.plausible) window.plausible('Achievement', { props: { id } });
  }
  return true;
}

function getUnlockedAchievements() {
  return JSON.parse(localStorage.getItem('ba_achievements')||'[]');
}

// Track totals
function trackRun(stats) {
  const totals = JSON.parse(localStorage.getItem('ba_totals')||'{"runs":0,"kcal":0}');
  totals.runs++;
  totals.kcal += stats.kcal || 0;
  localStorage.setItem('ba_totals', JSON.stringify(totals));
  unlockAchievement('first-run');
  unlockAchievement('10-runs', totals.runs >= 10);
  unlockAchievement('100-runs', totals.runs >= 100);
  unlockAchievement('100-kcal', totals.kcal >= 100);
  unlockAchievement('1000-kcal', totals.kcal >= 1000);
  unlockAchievement('combo-10', (stats.combo||0) >= 10);
  unlockAchievement('combo-25', (stats.combo||0) >= 25);
  unlockAchievement('speed-demon', stats.diff === 'insane');
  // Track worlds played
  if (stats.world) {
    const worlds = JSON.parse(localStorage.getItem('ba_worlds_played')||'[]');
    if (!worlds.includes(stats.world)) worlds.push(stats.world);
    localStorage.setItem('ba_worlds_played', JSON.stringify(worlds));
    unlockAchievement('all-worlds', worlds.length >= 10);
  }
  // Friend challenge
  if (FRIEND.active && stats.score > FRIEND.active.score) {
    unlockAchievement('beat-friend');
  }
  // Daily challenge
  const daily = getDailyChallenge();
  if (stats.world === daily.world && stats.score >= daily.target && !isDailyCompletedToday()) {
    const streak = markDailyComplete();
    toast(`✅ DAILY DONE! Streak: ${streak} 🔥`, 4000);
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. CHARACTER SKINS — cosmetic IAP
// ═══════════════════════════════════════════════════════════════
const SKINS = [
  { id:'default',   name:'Runner',     emoji:'🏃', color:'#ffc424', price:0,    free:true },
  { id:'ninja',     name:'Ninja',      emoji:'🥷', color:'#1a1a2e', price:2.99 },
  { id:'knight',    name:'Knight',     emoji:'🛡️', color:'#9ca3af', price:2.99 },
  { id:'astronaut', name:'Astronaut',  emoji:'🧑‍🚀', color:'#e8f0f8', price:4.99 },
  { id:'wizard',    name:'Wizard',     emoji:'🧙', color:'#a855f7', price:4.99 },
  { id:'robot',     name:'Robot',      emoji:'🤖', color:'#60a5fa', price:4.99 },
  { id:'devil',     name:'Demon',      emoji:'😈', color:'#dc2626', price:9.99 },
  { id:'angel',     name:'Angel',      emoji:'👼', color:'#fde047', price:9.99 },
];

function ownedSkins() {
  if (typeof isPro==='function' && isPro()) return SKINS.map(s=>s.id);
  return ['default', ...JSON.parse(localStorage.getItem('ba_skins')||'[]')];
}

function currentSkin() {
  return localStorage.getItem('ba_active_skin') || 'default';
}

function setActiveSkin(id) {
  if (!ownedSkins().includes(id)) return false;
  localStorage.setItem('ba_active_skin', id);
  return true;
}

function showSkinShop() {
  let modal = $f('skin-shop'); if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'skin-shop';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);overflow-y:auto;padding:24px;';
  const owned = ownedSkins();
  const active = currentSkin();
  modal.innerHTML = `
    <div style="background:linear-gradient(180deg,#1a2540,#0a1018);border:3px solid #ffc424;border-radius:18px;padding:28px;max-width:680px;width:100%;box-shadow:0 12px 40px rgba(255,196,36,.2);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
        <div style="font-family:Bangers,cursive;font-size:30px;color:#ffc424;text-shadow:0 4px 0 #5a3a00;letter-spacing:.04em;">CHARACTER SHOP</div>
        <div style="cursor:pointer;color:#aab4c2;font-size:28px;line-height:1;" onclick="closeSkinShop()">×</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px;">
        ${SKINS.map(s => {
          const isOwned = owned.includes(s.id);
          const isActive = active === s.id;
          return `<div onclick="${isOwned ? `setActiveSkin('${s.id}');showSkinShop();` : `buySkin('${s.id}')`}" style="cursor:pointer;background:${isActive?'rgba(255,196,36,.15)':'rgba(26,37,64,.5)'};border:3px solid ${isActive?'#ffc424':isOwned?'#5cdfff':'#2a3548'};border-radius:14px;padding:14px 8px;text-align:center;transition:transform .15s;position:relative;${isOwned?'':'opacity:0.85;'}">
            <div style="font-size:40px;margin-bottom:6px;filter:drop-shadow(0 3px 6px rgba(0,0,0,.5));">${s.emoji}</div>
            <div style="font-family:Bangers,cursive;font-size:14px;color:#fff;letter-spacing:.04em;text-shadow:0 2px 0 #000;">${s.name}</div>
            <div style="font-size:11px;color:${isActive?'#ffc424':isOwned?'#5cdfff':'#aab4c2'};margin-top:4px;font-weight:700;letter-spacing:.05em;">${isActive?'EQUIPPED':isOwned?'OWNED':'$'+s.price.toFixed(2)}</div>
            ${!isOwned ? '<div style="position:absolute;top:6px;right:8px;font-size:14px;">🔒</div>' : ''}
          </div>`;
        }).join('')}
      </div>
      <div style="text-align:center;font-size:13px;color:#aab4c2;">⭐ Pro members get ALL skins for free</div>
    </div>
  `;
  document.body.appendChild(modal);
}

function closeSkinShop() { const m=$f('skin-shop'); if(m) m.remove(); }

function buySkin(skinId) {
  // Open Gumroad checkout in new tab (real flow: separate Gumroad product per skin or single bundle)
  const skin = SKINS.find(s=>s.id===skinId);
  if (!skin) return;
  // For now, all skins = Pro upgrade (or set up separate Gumroad products later)
  if (typeof showLockModal === 'function') {
    showLockModal(`Unlock the <b>${skin.name}</b> skin and all other cosmetics with Pro.`, GUMROAD_PRO);
  } else {
    window.open('https://dorukctn.gumroad.com/l/ithhc','_blank');
  }
}

// ═══════════════════════════════════════════════════════════════
// 5. WEEKLY TOURNAMENT
// ═══════════════════════════════════════════════════════════════
function currentWeek() {
  const d = new Date();
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - start) / 86400000 + start.getDay() + 1) / 7);
}

const WEEKLY_THEMES = [
  { week: 1, theme: 'NEW YEAR SPRINT',  world: 'mountain', diff:'medium' },
  { week: 2, theme: 'JUNGLE GAUNTLET',  world: 'forest',   diff:'hard' },
  { week: 3, theme: 'DESERT MARATHON',  world: 'desert',   diff:'medium' },
  { week: 4, theme: 'VOLCANO RUSH',     world: 'volcano',  diff:'hard' },
  { week: 5, theme: 'STORM CHASE',      world: 'storm',    diff:'insane' },
  { week: 6, theme: 'OCEAN BREEZE',     world: 'ocean',    diff:'easy' },
  { week: 7, theme: 'CITY BLITZ',       world: 'city',     diff:'medium' },
  { week: 8, theme: 'ARCTIC EXPEDITION',world: 'snow',     diff:'hard' },
  { week: 9, theme: 'SUNSET CRUISE',    world: 'sunset',   diff:'medium' },
  { week: 10,theme: 'JUNGLE RAMPAGE',   world: 'jungle',   diff:'hard' },
];

function currentTournament() {
  const w = currentWeek() % WEEKLY_THEMES.length;
  return WEEKLY_THEMES[w] || WEEKLY_THEMES[0];
}

// ═══════════════════════════════════════════════════════════════
// 6. AUTO-HIGHLIGHTS — best run progression
// ═══════════════════════════════════════════════════════════════
function recordRun(stats) {
  const runs = JSON.parse(localStorage.getItem('ba_run_history')||'[]');
  runs.push({
    ts: Date.now(),
    score: stats.score || 0,
    dist: stats.distance || 0,
    kcal: stats.kcal || 0,
    combo: stats.combo || 0,
    world: stats.world || 'mountain',
    diff: stats.diff || 'medium',
  });
  // Keep last 100
  if (runs.length > 100) runs.shift();
  localStorage.setItem('ba_run_history', JSON.stringify(runs));
}

function getRunHistory() { return JSON.parse(localStorage.getItem('ba_run_history')||'[]'); }

// ═══════════════════════════════════════════════════════════════
// 7. TOAST notifications
// ═══════════════════════════════════════════════════════════════
function toast(msg, dur=2800) {
  let t = $f('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(120px);z-index:9999;background:linear-gradient(180deg,#1a2540,#0a1018);border:3px solid #ffc424;border-radius:14px;padding:12px 22px;color:#fff;font-family:Bangers,cursive;font-size:18px;letter-spacing:.04em;text-shadow:0 2px 0 rgba(0,0,0,.4);box-shadow:0 6px 0 #5a3a00, 0 12px 30px rgba(0,0,0,.5);transition:transform .35s ease;max-width:90vw;text-align:center;';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => { t.style.transform = 'translateX(-50%) translateY(0)'; });
  clearTimeout(t._tm);
  t._tm = setTimeout(() => { t.style.transform = 'translateX(-50%) translateY(120px)'; }, dur);
}

// ═══════════════════════════════════════════════════════════════
// 8. PUBLIC: hook into game-core via global
// ═══════════════════════════════════════════════════════════════
window.BAfeatures = {
  showFriendBanner, hideFriendBanner, FRIEND,
  generateChallengeURL, shareChallenge, showChallengeResult,
  getDailyChallenge, isDailyCompletedToday, getDailyStreak,
  trackRun, recordRun,
  ACHIEVEMENTS, getUnlockedAchievements,
  SKINS, ownedSkins, currentSkin, setActiveSkin, showSkinShop, buySkin,
  currentTournament, currentWeek,
  getRunHistory, toast,
};

// Auto-show friend banner on load
addEventListener('DOMContentLoaded', () => {
  if (FRIEND.active) {
    showFriendBanner();
  }
  // Add achievement when first becoming Pro
  if (typeof isPro==='function' && isPro()) unlockAchievement('first-pro');
});
