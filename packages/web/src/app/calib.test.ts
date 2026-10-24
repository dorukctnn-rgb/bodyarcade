// The calibration screen's words and offers, state by state: every code the platform reports has a plain sentence in English
// and Turkish, a code nobody has heard of still gets one, and the desk is offered when (and only when) it should be.
import { describe, expect, it } from 'vitest';
import { createI18n, stringTables } from '../../../core/ui/i18n/index.ts';
import { copyProblems } from '../../catalogue/copy.ts';
import {
  bandsFor, bothSeen, calibMessage, CALIB_MESSAGE, checksFor, DESK_DELAY, DESK_HOLD_MS, deskCard, DeskOffer, extrasOf, gaugeFor, GUIDE_MESSAGE, guideMessage, keepsChecks,
  needsHeadroom, partsFor, screenFraming,
} from './calib.ts';

const FRAMINGS = ['full', 'upper', 'side', 'desk'] as const;
const CODES = Object.keys(CALIB_MESSAGE);

/** Body words and instructions that must not turn up in a Turkish sentence untranslated. */
const ENGLISH = /\b(hips?|knees?|feet|head|shoulders?|step|steps|back|closer|further|view|body|camera|move|hold|still|sit|screen|tilt|show|measuring)\b/i;

describe('a sentence for every state', () => {
  it('lists the states the platform reports', () => {
    expect(CODES.length).toBeGreaterThanOrEqual(14);
    for (const c of ['no_person', 'too_close', 'too_far', 'head_out', 'hips_out', 'knees_out', 'feet_out', 'hold', 'ok', 'too_slow', 'one_person', 'player_out']) expect(CODES).toContain(c);
  });

  it('has words in advance for the states of the profile-based calibration, and for the light guidance of two players', () => {
    for (const c of ['move_left', 'move_right', 'too_dark', 'backlit', 'many_people']) expect(CODES).toContain(c);
    for (const a of ['more_light', 'light_in_front']) expect(Object.keys(GUIDE_MESSAGE)).toContain(a);
  });

  for (const lang of ['en', 'tr'] as const) {
    const i18n = createI18n(lang);
    it(`${lang}: each code gives a plain sentence in every framing, never the code or a key`, () => {
      for (const code of CODES) {
        for (const framing of FRAMINGS) {
          const s = calibMessage(i18n, code, framing);
          expect(s.length, `${code} ${framing}`).toBeGreaterThan(5);
          expect(s, `${code} ${framing}`).not.toMatch(/calib\.|_out|_close|_far|no_person|one_person/);
          expect(copyProblems(s), `${code} ${framing}: ${s}`).toEqual([]);
          if (lang === 'tr') expect(s, `${code} ${framing}: ${s}`).not.toMatch(ENGLISH);
        }
      }
    });

    it(`${lang}: a code this build has never heard of still gets an instruction`, () => {
      const s = calibMessage(i18n, 'hips_missing_in_v9', 'full');
      expect(s).toBe(i18n.t('calib.msg.generic'));
      expect(s).not.toContain('hips_missing');
    });

    it(`${lang}: a sentence that names a player has a twin that names nobody`, () => {
      for (const [action, key] of Object.entries(GUIDE_MESSAGE)) {
        if (!key) continue;
        const names = i18n.tx(key, { player: 'P' }).includes('P') && /\{player\}/.test(stringTables.en[key] ?? '');
        if (names) expect(i18n.has(`${key}.any`), `${action} has no ${key}.any`).toBe(true);
      }
    });

    it(`${lang}: the guidance for two players is plain too`, () => {
      for (const [action, key] of Object.entries(GUIDE_MESSAGE)) {
        if (!key) { expect(action).toBe('none'); continue; }
        const s = i18n.t(key, { player: 'P' });
        expect(s.length, action).toBeGreaterThan(5);
        expect(copyProblems(s), `${action}: ${s}`).toEqual([]);
        if (lang === 'tr') expect(s, `${action}: ${s}`).not.toMatch(ENGLISH);
      }
    });

    it(`${lang}: the guidance reads whole whether or not the platform names a player, and never starts with a comma`, () => {
      for (const action of Object.keys(GUIDE_MESSAGE)) {
        if (action === 'none') { expect(guideMessage(i18n, { action: 'none' })).toBe(''); continue; }
        const guide = { action } as Parameters<typeof guideMessage>[1];
        const anyone = guideMessage(i18n, guide);
        expect(anyone.length, action).toBeGreaterThan(5);
        expect(anyone, `${action}: ${anyone}`).not.toMatch(/^[\s,.:;]|\{|\}|undefined|calib\./);
        expect(copyProblems(anyone), `${action}: ${anyone}`).toEqual([]);
        for (const player of [1, 2] as const) {
          const named = guideMessage(i18n, { ...guide, player });
          expect(named.length, action).toBeGreaterThan(5);
          expect(named, `${action}: ${named}`).not.toMatch(/^[\s,.:;]|\{|\}|undefined/);
          if (named !== anyone) expect(named, `${action}: ${named}`).toContain(i18n.t(player === 1 ? 'hud.player1' : 'hud.player2'));
        }
        if (lang === 'tr') expect(anyone, `${action}: ${anyone}`).not.toMatch(ENGLISH);
      }
    });

    it(`${lang}: every part of the body the screen lists has a name`, () => {
      for (const framing of FRAMINGS) for (const part of partsFor(framing)) {
        const s = i18n.tx(`calib.check.${part}`);
        expect(s, `${framing} ${part}`).not.toContain('calib.');
        if (lang === 'tr') expect(s, s).not.toMatch(ENGLISH);
      }
    });
  }

  it('the Turkish table has every calibration line the English one has, with the same variables', () => {
    for (const key of Object.keys(stringTables.en).filter((k) => k.startsWith('calib.'))) {
      const tr = stringTables.tr[key];
      expect(tr, key).toBeTruthy();
      const vars = (s: string): string[] => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1] as string).sort();
      expect(vars(tr as string), key).toEqual(vars(stringTables.en[key] as string));
    }
  });

  it('says what to do about the hips in the words of the player: how far to step, which way', () => {
    expect(calibMessage(createI18n('tr'), 'hips_out', 'full')).toBe('Kalçan görünmüyor: 1-2 adım geri git.');
    expect(calibMessage(createI18n('en'), 'hips_out', 'full')).toBe('We cannot see your hips. Take one or two steps back.');
  });

  it('at a desk "step back" is not what the person is told', () => {
    for (const lang of ['en', 'tr'] as const) {
      const i18n = createI18n(lang);
      expect(calibMessage(i18n, 'hips_out', 'desk')).toBe(i18n.t('calib.msg.desk_back'));
      expect(calibMessage(i18n, 'feet_out', 'desk')).toBe(i18n.t('calib.msg.desk_back'));
      expect(calibMessage(i18n, 'hips_out', 'full')).not.toBe(i18n.t('calib.msg.desk_back'));
    }
  });
});

describe('the checks and the picture guide', () => {
  const oks = (framing: Parameters<typeof checksFor>[0], code: string): string => checksFor(framing, code).map((c) => `${c.part}:${c.ok ? 1 : 0}`).join(' ');

  it('a standing game checks head, hips, knees and feet from the top, and the first part out of view ends the run of ticks', () => {
    expect(oks('full', 'no_person')).toBe('head:0 hips:0 knees:0 feet:0');
    expect(oks('full', 'head_out')).toBe('head:0 hips:0 knees:0 feet:0');
    expect(oks('full', 'hips_out')).toBe('head:1 hips:0 knees:0 feet:0');
    expect(oks('full', 'knees_out')).toBe('head:1 hips:1 knees:0 feet:0');
    expect(oks('full', 'feet_out')).toBe('head:1 hips:1 knees:1 feet:0');
    expect(oks('full', 'hold')).toBe('head:1 hips:1 knees:1 feet:1');
    expect(oks('full', 'ok')).toBe('head:1 hips:1 knees:1 feet:1');
    expect(oks('full', 'too_close')).toBe('head:0 hips:0 knees:0 feet:0');
  });

  it('the upper body game has two checks and the desk has head and shoulders', () => {
    expect(partsFor('upper')).toEqual(['head', 'hips']);
    expect(partsFor('desk')).toEqual(['head', 'shoulders']);
    expect(oks('upper', 'hips_out')).toBe('head:1 hips:0');
    expect(oks('desk', 'hold')).toBe('head:1 shoulders:1');
    expect(oks('desk', 'no_person')).toBe('head:0 shoulders:0');
  });

  it('at the desk the codes about the lower body say nothing against the head and shoulders', () => {
    for (const code of ['hips_out', 'knees_out', 'feet_out']) expect(oks('desk', code), code).toBe('head:1 shoulders:1');
    expect(oks('desk', 'head_out')).toBe('head:0 shoulders:0');
  });

  it('the picture marks the part that is out of view, and where the feet go while nobody is in view', () => {
    expect(bandsFor('full', 'hips_out')).toEqual(['hips']);
    expect(bandsFor('full', 'feet_out')).toEqual(['feet']);
    expect(bandsFor('full', 'head_out')).toEqual(['head']);
    expect(bandsFor('full', 'no_person')).toEqual(['feet']);
    expect(bandsFor('full', 'hold')).toEqual([]);
    expect(bandsFor('upper', 'no_person')).toEqual([]);
    expect(bandsFor('desk', 'hips_out')).toEqual([]);
    expect(bandsFor('upper', 'feet_out')).toEqual([]);
  });

  it('the gauge: too close, good, too far, unknown', () => {
    expect(gaugeFor('hips_out')).toBe('close');
    expect(gaugeFor('too_far')).toBe('far');
    expect(gaugeFor('hold')).toBe('good');
    expect(gaugeFor('no_person')).toBe('none');
    expect(gaugeFor('something_new')).toBe('none');
  });

  it('a seated round is framed at the desk, any other round by the game', () => {
    expect(screenFraming({ framing: 'full' }, true)).toBe('desk');
    expect(screenFraming({ framing: 'full' }, false)).toBe('full');
    expect(screenFraming({ framing: 'side' }, false)).toBe('side');
  });
});

describe('what a newer platform measures itself', () => {
  it('the parts it says are in view are the ticks, whatever the code names', () => {
    const oks = (framing: Parameters<typeof checksFor>[0], code: string, seen: Parameters<typeof checksFor>[2]): boolean[] => checksFor(framing, code, seen).map((c) => c.ok);
    expect(oks('full', 'knees_out', { head: true, hips: true, knees: false, feet: false })).toEqual([true, true, false, false]);
    expect(oks('full', 'hold', { head: true, hips: true, knees: true, feet: true })).toEqual([true, true, true, true]);
    expect(oks('desk', 'hips_out', { head: true, shoulders: true, hips: false })).toEqual([true, true]);
    expect(oks('full', 'no_person', {})).toEqual([false, false, false, false]);
  });

  it('every missing part is named on the picture when some of the body is in view, and none when nobody is', () => {
    expect(bandsFor('full', 'knees_out', { head: true, hips: true, knees: false, feet: false })).toEqual(['knees', 'feet']);
    expect(bandsFor('full', 'hold', { head: true, hips: true, knees: true, feet: true })).toEqual([]);
    expect(bandsFor('full', 'no_person', {})).toEqual(['feet']);
    expect(bandsFor('desk', 'hips_out', { head: true, shoulders: true })).toEqual([]);
  });

  it('two players: a part counts when both of them show it', () => {
    expect(bothSeen({ head: true, hips: true }, { head: true, hips: false })).toEqual({ head: true, shoulders: false, hips: false, knees: false, feet: false });
    expect(bothSeen(undefined, { head: true })).toBeUndefined();
  });

  it('codes about the room or the crowd leave the ticks as they were, the others set them', () => {
    for (const c of ['too_slow', 'move_left', 'move_right', 'many_people']) expect(keepsChecks(c), c).toBe(true);
    for (const c of ['no_person', 'hips_out', 'too_dark', 'backlit', 'hold']) expect(keepsChecks(c), c).toBe(false);
    expect(checksFor('full', 'too_dark').some((c) => c.ok)).toBe(false);
    expect(checksFor('full', 'backlit').some((c) => c.ok)).toBe(false);
  });

  it('reads the extras from a status without needing them', () => {
    expect(extrasOf({ code: 'ok', progress: 1 }).seen).toBeUndefined();
    expect(extrasOf({ escape: true }).escape).toBe(true);
    expect(extrasOf({ outcome: 'fallback' }).outcome).toBe('fallback');
  });
});

describe('the headroom state', () => {
  it('Summit Climb lifts the hands above the head, so it asks for room there; the others do not', () => {
    expect(needsHeadroom({ id: 'summit-climb' })).toBe(true);
    for (const id of ['squat-flap', 'road-run', 'knee-sprint', 'star-catch', 'pad-work']) expect(needsHeadroom({ id }), id).toBe(false);
  });

  it('a manifest that says so is believed, and one that says no does not remove a game the list knows', () => {
    expect(needsHeadroom({ id: 'new-game', headroom: 'arms-up' } as { id: string })).toBe(true);
    expect(needsHeadroom({ id: 'summit-climb', headroom: false } as { id: string })).toBe(true);
    expect(needsHeadroom({ id: 'new-game', headroom: false } as { id: string })).toBe(false);
  });

  it('says it in plain English and Turkish, in the words the brief gave', () => {
    expect(createI18n('tr').t('calib.headroom')).toBe('Kollarını kaldırınca ellerin görünsün.');
    expect(createI18n('en').t('calib.headroom')).toMatch(/raise your arms/i);
    for (const lang of ['en', 'tr'] as const) expect(copyProblems(createI18n(lang).t('calib.headroom')), lang).toEqual([]);
  });
});

describe('the desk offer', () => {
  it('comes after the hips have been out of view for a moment, not at the first frame', () => {
    const d = new DeskOffer();
    expect(d.push('hips_out', 0)).toBe(false);
    expect(d.push('hips_out', (DESK_DELAY['hips_out'] as number) - 1)).toBe(false);
    expect(d.push('hips_out', DESK_DELAY['hips_out'] as number)).toBe(true);
  });

  it('a person walking into frame passes through the codes in a blink and sees no card', () => {
    const d = new DeskOffer();
    expect(d.push('no_person', 0)).toBe(false);
    expect(d.push('hips_out', 100)).toBe(false);
    expect(d.push('hips_out', 400)).toBe(false);
    expect(d.push('hold', 500)).toBe(false);
    expect(d.push('hips_out', 900)).toBe(false);   // the wait starts over
    expect(d.push('hips_out', 1500)).toBe(false);
    expect(d.push('hips_out', 1700)).toBe(true);
  });

  it('knees and feet out take longer: a person standing too close can step back', () => {
    const d = new DeskOffer();
    expect(d.push('knees_out', 0)).toBe(false);
    expect(d.push('knees_out', 2000)).toBe(false);
    expect(d.push('knees_out', DESK_DELAY['knees_out'] as number)).toBe(true);
    const e = new DeskOffer();
    e.push('feet_out', 0);
    expect(e.push('feet_out', DESK_DELAY['feet_out'] as number)).toBe(true);
  });

  it('stays through a short gap and goes when the person is clearly doing something else', () => {
    const d = new DeskOffer();
    d.push('hips_out', 0);
    expect(d.push('hips_out', 800)).toBe(true);
    expect(d.push('no_person', 900)).toBe(true);
    expect(d.push('hips_out', 1000)).toBe(true);
    expect(d.push('hold', 1100)).toBe(true);
    expect(d.push('hold', 1100 + DESK_HOLD_MS - 1)).toBe(true);
    expect(d.push('hold', 1100 + DESK_HOLD_MS)).toBe(false);
  });

  it('head_out and the other codes never start an offer, and reset clears it', () => {
    const d = new DeskOffer();
    for (let t = 0; t < 10_000; t += 100) expect(d.push(t % 200 === 0 ? 'head_out' : 'too_far', t)).toBe(false);
    d.push('hips_out', 20_000);
    d.push('hips_out', 21_000);
    expect(d.offered).toBe(true);
    d.reset();
    expect(d.offered).toBe(false);
  });
});

describe('the desk card', () => {
  it('offers the desk to a game that can be played seated, and says plainly when it cannot', () => {
    expect(deskCard(true, { seated: true }, false)).toBe('offer');
    expect(deskCard(true, { seated: false }, false)).toBe('standing-only');
    expect(deskCard(false, { seated: true }, false)).toBe('none');
  });

  it('is gone once the round is a seated one', () => {
    expect(deskCard(true, { seated: true }, true)).toBe('none');
    expect(deskCard(true, { seated: false }, true)).toBe('none');
  });
});
