// House rules for interface and catalogue copy (premium-web-style): sentence case, no em or en dashes, no arrows, no
// emoji, no exclamation marks, no hype words. Checked on every catalogue string and on the string tables; the full
// lint-copy tool still runs on the generated pages.

const DASHES = /[–—―]/;
const ARROWS = /[←-⇿⟵-⟿⬀-⯿]|->|=>/;
const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿️]/u;
const HYPE = /\b(amazing|incredible|revolutionary|ultimate|game-changing|supercharge|unleash|seamless|cutting-edge|world-class|best-in-class|next-level|effortless|stunning|awesome|epic)\b/i;

/** Human readable problems in one piece of text; an empty list means it follows the rules. */
export function copyProblems(text: string): string[] {
  const out: string[] = [];
  if (DASHES.test(text)) out.push('uses an en or em dash');
  if (ARROWS.test(text)) out.push('uses an arrow');
  if (EMOJI.test(text)) out.push('uses an emoji or pictograph');
  if (/!/.test(text)) out.push('uses an exclamation mark');
  const hype = HYPE.exec(text);
  if (hype) out.push(`uses the hype word "${hype[0]}"`);
  if (/  +/.test(text)) out.push('has a double space');
  if (text !== text.trim()) out.push('has leading or trailing space');
  return out;
}
