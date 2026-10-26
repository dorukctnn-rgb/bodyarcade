// The moderator's desk for the social reports: reads the queue of the moderation API, and answers a report or erases a profile. A person reads
// every report (the privacy policy says so); this is how, from a terminal, without opening the Worker's dashboard. It prints reports with
// the saved chat lines, so run it where nobody looks over your shoulder, and never paste its output into a public place.
//
//   node tools/moderation/queue.ts                         the open reports, serious ones first, then the oldest
//   node tools/moderation/queue.ts stats                   counts for the day (profiles, open and urgent reports, banned)
//   node tools/moderation/queue.ts done [--limit 50]       reports that were handled (dismissed and actioned)
//   node tools/moderation/queue.ts act <id> <dismiss|warn|mute|suspend|ban|clear> [--days 7] [--note "why"]
//   node tools/moderation/queue.ts delete <BA-XXXXXX> [--note "asked by e-mail on 25 Oct"]     erase the profile with this friend code
//   options: --target production|preview (default production)   --origin https://bodyarcade.com (default: the target's address)
//
// The token is ADMIN_TOKEN: the environment variable BA_ADMIN_TOKEN, else the target's secrets file (release/secrets.ts), never printed.
// Exit codes: 0 done, 1 the server said no (the status and the error code are printed), 2 usage, 3 no token.
import { readSecrets } from '../../release/secrets.ts';
import { TARGETS, type TargetId } from '../../release/site.ts';

interface Args { cmd: string; rest: string[]; flags: Map<string, string> }

function parse(argv: string[]): Args {
  const flags = new Map<string, string>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a.startsWith('--')) { flags.set(a.slice(2), argv[i + 1] ?? ''); i++; } else rest.push(a);
  }
  const cmd = rest.shift() ?? 'open';
  return { cmd, rest, flags };
}

const when = (ms: number): string => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

async function call(origin: string, token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${origin}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const code = typeof data === 'object' && data !== null && 'error' in data ? String((data as { error: unknown }).error) : '';
    console.error(`${method} ${path}: ${res.status} ${code}`.trim());
    if (res.status === 404 && path.startsWith('/api/admin/')) console.error('The moderation API answers 404 when the Worker has no ADMIN_TOKEN (npx wrangler secret put ADMIN_TOKEN, or release/secrets.ts).');
    process.exit(1);
  }
  return data;
}

interface Report {
  id: number; at: number; reporterFid: string | null; targetFid: string; targetName: string; targetBand: string; reason: string; source: string;
  room: string | null; matchId: string | null; note: string | null; evidence: unknown; urgent: boolean; status: string; handledAt: number | null;
  handledAction: string | null; reportsAgainstTarget: number; sanctions: { mutedUntil: number; publicBlockedUntil: number; bannedUntil: number };
}

function show(r: Report, now: number): string {
  const lines = [
    `#${r.id}  ${when(r.at)}  ${r.urgent ? 'URGENT  ' : ''}${r.reason}  (${r.source}${r.room ? `, room ${r.room}` : ''})`,
    `    about ${r.targetName || '(name erased)'} [${r.targetBand}] id ${r.targetFid}, ${r.reportsAgainstTarget} report(s) against this profile; from ${r.reporterFid ?? 'a profile that was deleted'}`,
  ];
  const s = r.sanctions;
  const on = [['muted', s.mutedUntil], ['public play blocked', s.publicBlockedUntil], ['banned', s.bannedUntil]].filter(([, until]) => Number(until) > now);
  if (on.length > 0) lines.push(`    now: ${on.map(([n, u]) => `${String(n)} until ${when(Number(u))}`).join(', ')}`);
  if (r.note) lines.push(`    note: ${r.note}`);
  // evidence is the room's last chat lines: {seat, name, text, at}
  if (Array.isArray(r.evidence)) {
    for (const e of r.evidence.slice(-12) as { name?: string; text?: string; at?: number }[]) {
      lines.push(`    chat${typeof e.at === 'number' ? ` ${when(e.at).slice(11, 16)}` : ''}: ${e.name ?? '?'}: ${e.text ?? ''}`);
    }
  }
  if (r.handledAt) lines.push(`    handled ${when(r.handledAt)}: ${r.handledAction ?? ''}`);
  return lines.join('\n');
}

async function main(): Promise<void> {
  const { cmd, rest, flags } = parse(process.argv.slice(2));
  const target = (flags.get('target') ?? 'production') as TargetId;
  if (!(target in TARGETS)) { console.error('--target is production or preview'); process.exit(2); }
  const origin = (flags.get('origin') ?? TARGETS[target].origin).replace(/\/$/, '');
  const token = process.env['BA_ADMIN_TOKEN'] ?? readSecrets(target)['ADMIN_TOKEN'];
  if (!token) { console.error(`No ADMIN_TOKEN: set BA_ADMIN_TOKEN, or run node release/secrets.ts init ${target}`); process.exit(3); }
  const note = flags.get('note');
  const now = Date.now();

  if (cmd === 'open' || cmd === 'done') {
    const limit = Number(flags.get('limit') ?? 50) || 50;
    const lists = cmd === 'open' ? ['open'] : ['actioned', 'dismissed'];
    let n = 0;
    for (const status of lists) {
      const out = (await call(origin, token, 'GET', `/api/admin/social/reports?status=${status}&limit=${limit}`)) as { reports: Report[] };
      for (const r of out.reports) { console.log(show(r, now)); console.log(''); n++; }
    }
    console.log(n === 0 ? `No ${cmd === 'open' ? 'open' : 'handled'} reports.` : `${n} report(s).`);
    return;
  }
  if (cmd === 'stats') {
    console.log(JSON.stringify(await call(origin, token, 'GET', '/api/admin/social/stats'), null, 2));
    return;
  }
  if (cmd === 'act') {
    const [id, action] = rest;
    if (!id || !action) { console.error('usage: act <id> <dismiss|warn|mute|suspend|ban|clear> [--days N] [--note "why"]'); process.exit(2); }
    const body: Record<string, unknown> = { action };
    if (flags.has('days')) body['days'] = Number(flags.get('days'));
    if (note) body['note'] = note;
    const out = (await call(origin, token, 'POST', `/api/admin/social/reports/${Number(id)}`, body)) as { report: Report | null };
    console.log(out.report ? show(out.report, now) : 'Done.');
    return;
  }
  if (cmd === 'delete') {
    const [code] = rest;
    if (!code) { console.error('usage: delete <BA-XXXXXX> [--note "why"]'); process.exit(2); }
    await call(origin, token, 'POST', '/api/admin/social/profiles/delete', { code, ...(note ? { note } : {}) });
    console.log('The profile was erased (its friends were told, its connections closed). The safety log keeps the note, not the name or the code.');
    return;
  }
  console.error(`unknown command "${cmd}": open | done | stats | act | delete`);
  process.exit(2);
}

await main();
