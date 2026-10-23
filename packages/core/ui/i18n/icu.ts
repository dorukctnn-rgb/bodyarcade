// A small message formatter: "{name}", "{n, plural, one {# game} other {# games}}" and "{x, select, a {..} other {..}}".
// Enough for the interface strings, no dependency. "#" inside a plural branch is the number, formatted for the language.
// Braces are reserved: a string that needs a literal brace is a bug (the string tests reject it).

export type Vars = Readonly<Record<string, string | number>>;

type Node =
  | { t: 'text'; v: string }
  | { t: 'arg'; name: string }
  | { t: 'plural'; name: string; branches: Map<string, Node[]> }
  | { t: 'select'; name: string; branches: Map<string, Node[]> }
  | { t: 'hash' };

const cache = new Map<string, Node[]>();

export function parseMessage(src: string): Node[] {
  const hit = cache.get(src);
  if (hit) return hit;
  let i = 0;

  const fail = (msg: string): never => { throw new Error(`Bad message "${src}": ${msg} at ${i}`); };

  function parseNodes(inBranch: boolean): Node[] {
    const out: Node[] = [];
    let text = '';
    const flush = (): void => { if (text) { out.push({ t: 'text', v: text }); text = ''; } };
    while (i < src.length) {
      const c = src[i] as string;
      if (c === '{') {
        flush();
        i++;
        out.push(parseArg());
      } else if (c === '}') {
        if (!inBranch) fail('unexpected }');
        break;
      } else if (c === '#' && inBranch) {
        flush();
        out.push({ t: 'hash' });
        i++;
      } else {
        text += c;
        i++;
      }
    }
    flush();
    return out;
  }

  function readUntil(chars: string): string {
    const start = i;
    while (i < src.length && !chars.includes(src[i] as string)) i++;
    return src.slice(start, i).trim();
  }

  function parseArg(): Node {
    const name = readUntil(',}');
    if (!name) fail('empty argument name');
    if (src[i] === '}') { i++; return { t: 'arg', name }; }
    i++; // ,
    const kind = readUntil(',}');
    if (kind !== 'plural' && kind !== 'select') fail(`unknown type ${kind}`);
    if (src[i] !== ',') fail('expected a comma');
    i++;
    const branches = new Map<string, Node[]>();
    for (;;) {
      while (i < src.length && /\s/.test(src[i] as string)) i++;
      if (src[i] === '}') { i++; break; }
      const key = readUntil('{ \t\n');
      if (!key) fail('missing branch name');
      while (i < src.length && /\s/.test(src[i] as string)) i++;
      if (src[i] !== '{') fail('expected {');
      i++;
      branches.set(key, parseNodes(true));
      if (src[i] !== '}') fail('unterminated branch');
      i++;
    }
    if (!branches.has('other')) fail('every plural and select needs an "other" branch');
    return { t: kind, name, branches } as Node;
  }

  const nodes = parseNodes(false);
  if (i < src.length) fail('trailing text');
  cache.set(src, nodes);
  return nodes;
}

export interface FormatEnv {
  lang: string;
  number(n: number): string;
}

function run(nodes: readonly Node[], vars: Vars, env: FormatEnv, hash: number | null): string {
  let out = '';
  for (const n of nodes) {
    switch (n.t) {
      case 'text': out += n.v; break;
      case 'hash': out += hash === null ? '#' : env.number(hash); break;
      case 'arg': {
        const v = vars[n.name];
        out += v === undefined ? '' : typeof v === 'number' ? env.number(v) : v;
        break;
      }
      case 'plural': {
        const raw = vars[n.name];
        const num = typeof raw === 'number' ? raw : Number(raw);
        const exact = n.branches.get(`=${num}`);
        const cat = new Intl.PluralRules(env.lang).select(num);
        const branch = exact ?? n.branches.get(cat) ?? n.branches.get('other') ?? [];
        out += run(branch, vars, env, num);
        break;
      }
      case 'select': {
        const v = String(vars[n.name] ?? 'other');
        out += run(n.branches.get(v) ?? n.branches.get('other') ?? [], vars, env, hash);
        break;
      }
    }
  }
  return out;
}

export function formatMessage(src: string, vars: Vars, env: FormatEnv): string {
  if (!src.includes('{')) return src;
  return run(parseMessage(src), vars, env, null);
}

/** Names of the variables a message uses, for the translation tests ("every language uses the same variables"). */
export function variablesOf(src: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: readonly Node[]): void => {
    for (const n of nodes) {
      if (n.t === 'arg') names.add(n.name);
      else if (n.t === 'plural' || n.t === 'select') {
        names.add(n.name);
        for (const b of n.branches.values()) walk(b);
      }
    }
  };
  walk(parseMessage(src));
  return [...names].sort();
}
