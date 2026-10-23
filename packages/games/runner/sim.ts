// Run simulation: speed, spawning, collisions and scoring. Pure logic, no rendering.
// Ported from site/game/sim.js WITHOUT behaviour changes (types added only). The parity test
// (sim.parity.test.ts) keeps it identical to the live game; the fixed-step, pre-generated-course version for the
// platform (WP10) builds on this file.
export const LANE_W = 1.6;

export type DiffId = 'easy' | 'medium' | 'hard' | 'insane';
export interface DiffSpec { label: string; speed: number; ramp: number; react: number; jumpDur: number; pro: boolean; hint: string }

export const DIFFS: Record<DiffId, DiffSpec> = {
  easy:   { label: 'Easy',   speed: 7.5,  ramp: 0.30, react: 3.0, jumpDur: 1.05, pro: false, hint: 'Slow road, long gaps' },
  medium: { label: 'Medium', speed: 9.5,  ramp: 0.40, react: 2.4, jumpDur: 0.92, pro: false, hint: 'The standard run' },
  hard:   { label: 'Hard',   speed: 12,   ramp: 0.45, react: 1.9, jumpDur: 0.86, pro: true,  hint: 'Fast, tight gaps' },
  insane: { label: 'Insane', speed: 14.5, ramp: 0.50, react: 1.5, jumpDur: 0.8,  pro: true,  hint: 'For people who never miss' },
};

export type MoveId = 'hurdle' | 'duck' | 'squat' | 'wallL' | 'wallR';
export const MOVES: Record<MoveId, { label: string; verb: string }> = {
  hurdle: { label: 'Jump',       verb: 'JUMP' },
  duck:   { label: 'Duck',       verb: 'DUCK' },
  squat:  { label: 'Squat',      verb: 'SQUAT' },
  wallL:  { label: 'Lean left',  verb: 'LEAN LEFT' },   // wall covers centre+right, so go left
  wallR:  { label: 'Lean right', verb: 'LEAN RIGHT' },
};

export type ObstacleType = 'hurdle' | 'duck' | 'squat' | 'wall';
export interface Obstacle { id: number; type: ObstacleType; side: number; z: number; resolved: boolean; safe: boolean; inWindow: boolean; move: MoveId }
export interface Coin { id: number; lane: number; z: number; taken: boolean }

export type SimEvent =
  | { type: 'spawn'; ob: Obstacle }
  | { type: 'jump' }
  | { type: 'land' }
  | { type: 'skip'; ob: Obstacle }
  | { type: 'coin'; coin: Coin }
  | { type: 'remove'; ob: Obstacle }
  | { type: 'over' }
  | { type: 'complete' }
  | { type: 'pass'; ob: Obstacle; pts: number; combo: number }
  | { type: 'hit'; ob: Obstacle; hearts: number };

/** What the run reads each frame: target lane (-1, 0, 1), crouch level (0..1) and a one-shot jump. */
export interface RunInput { lane?: number; crouch?: number; consumeJump(): boolean }

export interface RunOptions { diff?: string; duration?: number; weight?: number; seed?: number }

export interface RunSummaryV1 {
  score: number; dist: number; cleared: number; hits: number; bestCombo: number; coins: number; kcal: number;
  seconds: number; complete: boolean; diff: string;
}

const SPAWN_Z = -78;
const JUMP_H = 1.15;
const WINDOW = 0.45;
const NEED = { duck: 0.4, squat: 0.7 };

function seedRand(seed: number): () => number { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export class Run {
  diff: DiffSpec; diffId: string;
  duration: number; weight: number;
  rand: () => number;
  t: number; dist: number; speed: number; score: number; combo: number; bestCombo: number;
  hearts: number; cleared: number; hits: number; coinsTaken: number; kcal: number; moves: number;
  phase: 'running' | 'over' | 'complete';
  x: number; lane: number; y: number; jumpT: number; jumpU: number; crouch: number; lean: number; hitT: number; invuln: number; slow: number;
  obstacles: Obstacle[]; coins: Coin[]; events: SimEvent[]; _id: number;
  _nextSpawn: number;
  _nextCoin: number;
  _lastType: ObstacleType | null;
  _grace: number;
  _moveZ?: number;
  paused: boolean;

  constructor({ diff = 'medium', duration = 90, weight = 70, seed = Date.now() & 0xffffffff }: RunOptions = {}) {
    this.diff = (DIFFS as Record<string, DiffSpec | undefined>)[diff] || DIFFS.medium; this.diffId = diff;
    this.duration = duration; this.weight = weight;
    this.rand = seedRand(seed);
    this.t = 0; this.dist = 0; this.speed = 0; this.score = 0; this.combo = 0; this.bestCombo = 0;
    this.hearts = 3; this.cleared = 0; this.hits = 0; this.coinsTaken = 0; this.kcal = 0; this.moves = 0;
    this.phase = 'running';
    this.x = 0; this.lane = 0; this.y = 0; this.jumpT = -1; this.jumpU = 0; this.crouch = 0; this.lean = 0; this.hitT = 0; this.invuln = 0; this.slow = 1;
    this.obstacles = []; this.coins = []; this.events = []; this._id = 1;
    this._nextSpawn = 0;               // distance at which the next obstacle spawns
    this._nextCoin = 18;
    this._lastType = null;
    this._grace = 2.5;                 // seconds before the first obstacle
    this.paused = false;
  }

  get runnerState() { return { x: this.x, y: this.y, crouch: this.crouch, lean: this.lean, speed: this.speed, jumpU: this.jumpU, hitT: this.hitT, invuln: this.invuln }; }

  // The next obstacle the player has to deal with (for the HUD prompt).
  next(): (Obstacle & { eta: number }) | null {
    for (const o of this.obstacles) if (!o.resolved && o.z < WINDOW) return { ...o, eta: Math.max(0, -o.z / Math.max(1, this.speed)) };
    return null;
  }

  _pick(): { type: ObstacleType; side: number } {
    const r = this.rand();
    let type: ObstacleType = r < 0.3 ? 'hurdle' : r < 0.52 ? 'duck' : r < 0.7 ? 'squat' : 'wall';
    if (type === this._lastType && this.rand() < 0.6) type = type === 'wall' ? 'hurdle' : 'wall';
    this._lastType = type;
    const side = this.rand() < 0.5 ? -1 : 1;
    return { type, side };
  }

  _spawn(): void {
    const { type, side } = this._pick();
    const ob: Obstacle = { id: this._id++, type, side, z: SPAWN_Z, resolved: false, safe: true, inWindow: false, move: 'hurdle' };
    ob.move = type === 'wall' ? (side > 0 ? 'wallL' : 'wallR') : type;
    this.obstacles.push(ob);
    this.events.push({ type: 'spawn', ob });
  }

  _spawnCoins(): void {
    const lane = [-1, 0, 1][Math.floor(this.rand() * 3)] as number;
    for (let i = 0; i < 5; i++) {
      const z = SPAWN_Z - 6 - i * 1.4;
      if (this.obstacles.some(o => Math.abs(o.z - z) < 3.5)) continue;
      this.coins.push({ id: this._id++, lane, z, taken: false });
    }
  }

  update(dt: number, input: RunInput): SimEvent[] {
    const ev = this.events; ev.length = 0;
    if (this.phase !== 'running' || this.paused) return ev;
    dt = Math.min(dt, 0.05);
    this.t += dt;

    // speed with ramp and post-hit slowdown
    this.slow += (1 - this.slow) * Math.min(1, dt * 2.2);
    const target = this.diff.speed * (1 + this.diff.ramp * Math.min(1, this.t / this.duration));
    this.speed += (target * this.slow - this.speed) * Math.min(1, dt * 3);
    const moveZ = this.speed * dt;
    this.dist += moveZ;
    this.score += moveZ * 1.0;
    this.kcal += this.weight * 0.00175 * dt;      // about 6 MET, an estimate

    // runner control
    const laneX = (input.lane || 0) * LANE_W;
    this.x += (laneX - this.x) * Math.min(1, dt * 9);
    this.lean = Math.max(-1, Math.min(1, (laneX - this.x) * 1.4));
    const targetCrouch = Math.max(0, Math.min(1, input.crouch || 0));
    this.crouch += (targetCrouch - this.crouch) * Math.min(1, dt * 14);
    if (input.consumeJump() && this.jumpT < 0 && this.crouch < 0.5) { this.jumpT = 0; this.moves++; this.kcal += 0.12; ev.push({ type: 'jump' }); }
    if (this.jumpT >= 0) {
      this.jumpT += dt;
      const u = Math.min(1, this.jumpT / this.diff.jumpDur);
      this.jumpU = u; this.y = JUMP_H * 4 * u * (1 - u);
      if (u >= 1) { this.jumpT = -1; this.y = 0; this.jumpU = 0; ev.push({ type: 'land' }); }
    }
    if (this.hitT > 0) this.hitT -= dt;
    if (this.invuln > 0) this.invuln -= dt;

    // spawning (distance based so difficulty scales with speed)
    if (this._grace > 0) this._grace -= dt;
    else if (this.dist >= this._nextSpawn) {
      this._spawn();
      const gap = this.speed * this.diff.react * (0.9 + this.rand() * 0.35);
      this._nextSpawn = this.dist + gap;
    }
    if (this.dist >= this._nextCoin) { this._spawnCoins(); this._nextCoin = this.dist + 14 + this.rand() * 10; }

    // move + resolve obstacles
    for (const o of this.obstacles) {
      o.z += moveZ;
      if (o.resolved) continue;
      if (o.z > -WINDOW && o.z < WINDOW) {
        o.inWindow = true;
        if (!this._safe(o)) o.safe = false;
      } else if (o.z >= WINDOW) {
        o.resolved = true;
        if (this.invuln > 0 && !o.safe) { ev.push({ type: 'skip', ob: o }); continue; }
        if (o.safe) this._pass(o); else this._hit(o);
      }
    }
    for (const c of this.coins) {
      c.z += moveZ;
      if (!c.taken && c.z > -0.7 && c.z < 0.5 && Math.abs(this.x - c.lane * LANE_W) < 0.85) {
        c.taken = true; this.coinsTaken++; this.score += 25; ev.push({ type: 'coin', coin: c });
      }
    }
    // cull
    for (let i = this.obstacles.length - 1; i >= 0; i--) if ((this.obstacles[i] as Obstacle).z > 8) { ev.push({ type: 'remove', ob: this.obstacles[i] as Obstacle }); this.obstacles.splice(i, 1); }
    for (let i = this.coins.length - 1; i >= 0; i--) if ((this.coins[i] as Coin).z > 8 || (this.coins[i] as Coin).taken) this.coins.splice(i, 1);

    if (this.hearts <= 0) { this.phase = 'over'; ev.push({ type: 'over' }); }
    else if (this.t >= this.duration) { this.phase = 'complete'; this.score += 500 + this.hearts * 150; ev.push({ type: 'complete' }); }
    this._moveZ = moveZ;
    return ev;
  }

  get moveZ(): number { return this._moveZ || 0; }

  _safe(o: Obstacle): boolean {
    if (o.type === 'hurdle') return this.y > 0.42;
    if (o.type === 'duck') return this.crouch >= NEED.duck;
    if (o.type === 'squat') return this.crouch >= NEED.squat;
    if (o.type === 'wall') { const freeX = -o.side * LANE_W; return Math.abs(this.x - freeX) < 0.9; }
    return true;
  }
  _pass(o: Obstacle): void {
    this.combo++; this.bestCombo = Math.max(this.bestCombo, this.combo); this.cleared++;
    const pts = Math.round(100 * (1 + Math.min(10, this.combo - 1) * 0.1));
    this.score += pts; this.kcal += 0.1;
    this.events.push({ type: 'pass', ob: o, pts, combo: this.combo });
  }
  _hit(o: Obstacle): void {
    this.hearts--; this.hits++; this.combo = 0; this.hitT = 0.6; this.invuln = 1.2; this.slow = 0.55;
    this.events.push({ type: 'hit', ob: o, hearts: this.hearts });
  }

  summary(): RunSummaryV1 {
    return {
      score: Math.round(this.score), dist: Math.round(this.dist), cleared: this.cleared, hits: this.hits, bestCombo: this.bestCombo,
      coins: this.coinsTaken, kcal: +this.kcal.toFixed(1), seconds: Math.round(this.t), complete: this.phase === 'complete', diff: this.diffId,
    };
  }
}
