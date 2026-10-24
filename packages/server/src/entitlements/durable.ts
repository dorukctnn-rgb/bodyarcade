// EntitlementsDO: the one Durable Object ("main") that holds the purchases and seats. One object on purpose: requests
// are served one at a time, so "is there a free seat? take it" cannot be raced, and the volume (a few calls per customer
// per day) is far below what one object handles. Its storage is SQLite; the class is the classic `fetch` kind so that
// it needs no import from `cloudflare:workers` and the tests can build it from a fake state.
//
//   fetch  POST /activate | /refresh | /play | /deactivate | /reset | /reminder  (JSON; the Worker adds the caller's address as `ip`)
//          GET  /key
//   alarm  housekeeping and the reminder e-mails that are due (set after every call that can change what is due)
import type { DurableObjectStateLike, DurableObjectStorageLike } from '../cf.ts';
import { HttpError, json, isRecord } from '../http.ts';
import { loadConfig } from './config.ts';
import { migrate, sqlDbOfDurableObject, type DoSqlStorage, type SqlDb } from './db.ts';
import { createEngine, type Engine, type EngineResult, type LogFn } from './engine.ts';
import { createForwardEmailSender } from './mail.ts';
import {
  parseDeactivateBody, parseKeyBody, parsePlayBody, parseReminderBody, parseResetBody,
} from './parse.ts';
import { createGumroadUpstream, type FetchFn } from './upstream/gumroad.ts';
import { createPlayUpstream } from './upstream/play.ts';

type DoStorage = DoSqlStorage & DurableObjectStorageLike;

export interface DurableOptions {
  /** Tests: a clock, a fetch for the sellers and the mail service, and a place for log lines. */
  now?: () => number;
  fetch?: FetchFn;
  log?: LogFn;
}

/** The alarm fires at least this often, so old seats and addresses are cleaned up even when nobody calls. */
const SWEEP_EVERY_MS = 24 * 3_600_000;

export class EntitlementsDO {
  private readonly env: Record<string, unknown>;
  private readonly storage: DoStorage;
  private readonly db: SqlDb;
  private readonly options: DurableOptions;
  private engine: Promise<Engine> | null = null;

  constructor(state: DurableObjectStateLike, env: Record<string, unknown>, options: DurableOptions = {}) {
    this.env = env;
    this.options = options;
    this.storage = state.storage as unknown as DoStorage;
    this.db = sqlDbOfDurableObject(this.storage);
    void state.blockConcurrencyWhile(async () => { migrate(this.db); });
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private log(evt: string, data: Record<string, unknown>): void {
    (this.options.log ?? ((e, d) => console.log(JSON.stringify({ evt: `ent_${e}`, ...d }))))(evt, data);
  }

  private getEngine(): Promise<Engine> {
    this.engine ??= (async () => {
      const cfg = await loadConfig(this.env);
      if (cfg.problems.length > 0) this.log('config', { problems: cfg.problems });
      const f = this.options.fetch;
      return createEngine({
        db: this.db,
        now: () => this.now(),
        signer: cfg.signer,
        publicKeys: cfg.publicKeys,
        products: cfg.products,
        gumroad: createGumroadUpstream(f ? { fetch: f } : {}),
        play: cfg.playAccount ? createPlayUpstream({ account: cfg.playAccount, now: () => this.now(), ...(f ? { fetch: f } : {}) }) : null,
        mail: cfg.mail ? createForwardEmailSender({ ...cfg.mail, ...(f ? { fetch: f } : {}) }) : null,
        noLimits: cfg.noLimits,
        log: (e, d) => this.log(e, d),
      });
    })();
    return this.engine;
  }

  /** Sets the alarm to the next due reminder, or a day from now. `fired`: the alarm that just ran no longer exists. */
  private async arm(engine: Engine, fired = false): Promise<void> {
    const now = this.now();
    const due = engine.nextDue();
    const wake = Math.min(due !== null ? Math.max(due, now + 1000) : Number.POSITIVE_INFINITY, now + SWEEP_EVERY_MS);
    const current = fired ? null : await this.storage.getAlarm();
    if (current === null || current > wake) await this.storage.setAlarm(wake);
  }

  async fetch(req: Request): Promise<Response> {
    try {
      const engine = await this.getEngine();
      const op = new URL(req.url).pathname.replace(/^\/+/, '');
      if (req.method === 'GET' && op === 'key') return answer(engine.keys());
      if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      let body: unknown;
      try { body = await req.json(); } catch { throw new HttpError(400, 'bad_json'); }
      const ip = isRecord(body) && typeof body['ip'] === 'string' ? body['ip'].slice(0, 64) : '';
      let result: EngineResult;
      switch (op) {
        case 'activate':
        case 'refresh': {
          const p = parseKeyBody(body);
          if (!p.ok) throw new HttpError(400, 'bad_request');
          result = await engine.grantKey(p.value, ip, op);
          break;
        }
        case 'play': {
          const p = parsePlayBody(body);
          if (!p.ok) throw new HttpError(400, 'bad_request');
          result = await engine.grantPlay(p.value, ip);
          break;
        }
        case 'deactivate': {
          const p = parseDeactivateBody(body);
          if (!p.ok) throw new HttpError(400, 'bad_request');
          result = await engine.deactivate(p.value);
          break;
        }
        case 'reset': {
          const p = parseResetBody(body);
          if (!p.ok) throw new HttpError(400, 'bad_request');
          result = await engine.reset(p.value, ip);
          break;
        }
        case 'reminder': {
          const p = parseReminderBody(body);
          if (!p.ok) throw new HttpError(400, 'bad_request');
          result = await engine.reminder(p.value, ip);
          if (result.status === 200) await this.arm(engine);
          break;
        }
        default:
          throw new HttpError(404, 'not_found');
      }
      return answer(result);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, ...e.extra }, e.status);
      this.log('error', { where: 'fetch', error: String((e as { message?: unknown })?.message ?? e).slice(0, 200) });
      return json({ error: 'internal' }, 500);
    }
  }

  async alarm(): Promise<void> {
    let engine: Engine;
    try { engine = await this.getEngine(); } catch (e) {
      this.log('error', { where: 'alarm', error: String((e as { message?: unknown })?.message ?? e).slice(0, 200) });
      return;
    }
    try {
      const report = await engine.sweep();
      if (report.seatsFreed + report.purchasesForgotten + report.remindersSent + report.remindersDropped + report.remindersRetried > 0) this.log('sweep', { ...report });
    } catch (e) {
      // An alarm that throws is retried at once by the platform; a broken sweep must not turn into a storm.
      this.log('error', { where: 'sweep', error: String((e as { message?: unknown })?.message ?? e).slice(0, 200) });
    }
    await this.arm(engine, true);
  }
}

function answer(r: EngineResult): Response {
  return json(r.body, r.status, r.headers);
}
