// The Digital Asset Links file of the Android app and the one change that is waiting for the Play Console: the Play app-signing key.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ANDROID_PACKAGE as DEVICE_PACKAGE } from '../packages/core/device/capabilities.ts';
import { ANDROID_APP_LIVE } from '../packages/web/content/facts.ts';
import { ANDROID_PACKAGE, ASSETLINKS_FILE, RELATION, fingerprintsOf, normalizeFingerprint, ours, parse, problems, withFingerprint } from './assetlinks.ts';

const UPLOAD = '2A:31:24:0C:A2:EC:AC:B6:A3:FE:68:CA:82:71:AF:DA:92:9C:6C:E8:02:09:D7:DD:10:B9:77:B3:F2:D9:93:52';
const PLAY = '0F:1E:2D:3C:4B:5A:69:78:87:96:A5:B4:C3:D2:E1:F0:01:12:23:34:45:56:67:78:89:9A:AB:BC:CD:DE:EF:F1';
const file = readFileSync(ASSETLINKS_FILE, 'utf8');

describe('the assetlinks.json that the release serves', () => {
  it('is a valid statement for the package of the app and the one the web app expects', () => {
    expect(ANDROID_PACKAGE).toBe(DEVICE_PACKAGE);
    expect(problems(file)).toEqual([]);
    const mine = ours(parse(file));
    expect(mine?.relation).toEqual([RELATION]);
    expect(mine?.target.namespace).toBe('android_app');
  });

  it('holds the upload key (the build of android/ is signed with it)', () => {
    expect(fingerprintsOf(file)).toContain(UPLOAD);
  });

  it('the twa-manifest of the Android project lists the same upload key', () => {
    const manifest = JSON.parse(readFileSync(new URL('../android/twa-manifest.json', import.meta.url), 'utf8')) as { packageId: string; fingerprints: { name: string; value: string }[] };
    expect(manifest.packageId).toBe(ANDROID_PACKAGE);
    expect(manifest.fingerprints.map((f) => f.value)).toContain(UPLOAD);
  });

  it('once the pages say the app is on Google Play it also holds the Play app-signing key (a second fingerprint): the app that Play hands out is signed with that key, and without it the app opens bodyarcade.com with an address bar', () => {
    if (!ANDROID_APP_LIVE) {
      // Not live yet: one key is fine now; the day facts.ts ANDROID_APP_LIVE turns true this test asks for the second.
      expect(problems(file, { minFingerprints: 1 })).toEqual([]);
      return;
    }
    expect(problems(file, { minFingerprints: 2 })).toEqual([]);
  });
});

describe('adding the Play app-signing key', () => {
  it('writes a SHA-256 as upper-case hex pairs with colons, from any spelling', () => {
    const plain = PLAY.replace(/:/g, '');
    expect(normalizeFingerprint(plain)).toBe(PLAY);
    expect(normalizeFingerprint(plain.toLowerCase())).toBe(PLAY);
    expect(normalizeFingerprint(` ${PLAY.toLowerCase()}\n`)).toBe(PLAY);
    expect(normalizeFingerprint(PLAY.replace(/:/g, ' '))).toBe(PLAY);
  });

  it.each([[''], ['abc'], ['ZZ'.repeat(32)], [PLAY.slice(0, -3)], [`${PLAY}:00`], ['SHA256: ' + PLAY], ['3C:7B:4D:10:80:E0:96:03:42:22:5C:60:B7:E6:CC:DD:18:91:F8:5E']])('refuses %j: not a SHA-256', (bad) => {
    expect(() => normalizeFingerprint(bad)).toThrow(/SHA-256/);
  });

  it('puts the key after the upload key, keeps the file as it is otherwise, and the result passes the live check', () => {
    const next = withFingerprint(file, PLAY);
    expect(fingerprintsOf(next)).toEqual([UPLOAD, PLAY]);
    expect(problems(next, { minFingerprints: 2 })).toEqual([]);
    const before = parse(file);
    const after = parse(next);
    expect(after).toHaveLength(before.length);
    expect(after[0]?.relation).toEqual(before[0]?.relation);
    expect(after[0]?.target.package_name).toBe(ANDROID_PACKAGE);
    expect(next.endsWith('\n')).toBe(true);
  });

  it('is idempotent: the same key twice (or in another spelling) changes nothing', () => {
    const once = withFingerprint(file, PLAY);
    expect(withFingerprint(once, PLAY.replace(/:/g, '').toLowerCase())).toBe(once);
    expect(withFingerprint(file, UPLOAD)).toBe(withFingerprint(file, UPLOAD.toLowerCase()));
    expect(fingerprintsOf(withFingerprint(file, UPLOAD))).toEqual([UPLOAD]);
  });

  it('the file, as the repository holds it, is already in the layout the script writes (the patch is a one-line change)', () => {
    expect(withFingerprint(file, UPLOAD)).toBe(file.replace(/\r\n/g, '\n'));
  });
});

describe('what is wrong with a file', () => {
  const base = (over: object = {}): string => JSON.stringify([{ relation: [RELATION], target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: [UPLOAD], ...over } }]);

  it.each([
    ['not JSON', 'x', /JSON/],
    ['not an array', '{}', /array/],
    ['another package', JSON.stringify([{ relation: [RELATION], target: { namespace: 'android_app', package_name: 'com.example.other', sha256_cert_fingerprints: [UPLOAD] } }]), /no statement for the package/],
    ['no relation', JSON.stringify([{ relation: [], target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: [UPLOAD] } }]), /relation/],
    ['no fingerprint', base({ sha256_cert_fingerprints: [] }), /no certificate fingerprint/],
    ['a fingerprint in lower case', base({ sha256_cert_fingerprints: [UPLOAD.toLowerCase()] }), /upper-case/],
    ['a fingerprint that is no SHA-256', base({ sha256_cert_fingerprints: ['12:34'] }), /not a SHA-256/],
    ['the same fingerprint twice', base({ sha256_cert_fingerprints: [UPLOAD, UPLOAD] }), /twice/],
  ])('%s', (_name, text, expected) => {
    const found = problems(text);
    expect(found.length).toBeGreaterThan(0);
    expect(found.join(' ')).toMatch(expected);
  });

  it('one key is not enough for a live app: the Play app-signing key is the second', () => {
    expect(problems(base(), { minFingerprints: 2 }).join(' ')).toMatch(/at least 2 needed/);
    expect(problems(base({ sha256_cert_fingerprints: [UPLOAD, PLAY] }), { minFingerprints: 2 })).toEqual([]);
  });
});
