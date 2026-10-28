// Reads a built bundle and says whether it is the one the Play listing package expects. Nothing is uploaded and no password is needed.
//   node android/verify-aab.ts [path-to.aab] [--bundletool <bundletool-all.jar>]
// Defaults: android/app-release-bundle.aab; the jar from BUNDLETOOL_JAR or C:/Users/doruk/apps/_tools/bundletool/bundletool-all-*.jar.
// Checks: bundle validates; package and versionCode match android/twa-manifest.json; permissions are exactly the expected set (no AD_ID);
// the signing certificate (keytool -printcert -jarfile) is the UPLOAD key listed in twa-manifest.json and in release/static/.well-known/assetlinks.json.
// The Play app-signing key is NOT in the bundle: Play Console shows it after the first upload (release/assetlinks.ts add <SHA-256>).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const jarFlag = args.indexOf('--bundletool');
const aab = resolve(args.find((a, i) => !a.startsWith('--') && (jarFlag < 0 || i !== jarFlag + 1)) ?? join(here, 'app-release-bundle.aab'));

const cfg = JSON.parse(readFileSync(join(homedir(), '.bubblewrap', 'config.json'), 'utf8')) as { jdkPath: string };
const javaBin = (name: string): string => join(cfg.jdkPath, 'bin', process.platform === 'win32' ? `${name}.exe` : name);

function findJar(): string {
  if (jarFlag >= 0) return resolve(args[jarFlag + 1] as string);
  if (process.env['BUNDLETOOL_JAR']) return resolve(process.env['BUNDLETOOL_JAR']);
  const dir = join(homedir(), 'apps', '_tools', 'bundletool');
  const jars = existsSync(dir) ? readdirSync(dir).filter((f) => /^bundletool-all-.*\.jar$/.test(f)).sort() : [];
  if (!jars.length) throw new Error('no bundletool jar: pass --bundletool <jar> or set BUNDLETOOL_JAR (https://github.com/google/bundletool/releases)');
  return join(dir, jars[jars.length - 1] as string);
}

const run = (cmd: string, a: string[]): string => execFileSync(cmd, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
const manifest = JSON.parse(readFileSync(join(here, 'twa-manifest.json'), 'utf8')) as { packageId: string; appVersionCode: number; appVersionName: string; fingerprints: { name: string; value: string }[] };
const assetlinks = readFileSync(join(here, '..', 'release', 'static', '.well-known', 'assetlinks.json'), 'utf8');

const results: { ok: boolean; what: string }[] = [];
const check = (ok: boolean, what: string): void => { results.push({ ok, what }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${what}`); };

if (!existsSync(aab)) { console.error(`no bundle at ${aab}`); process.exit(2); }
const jar = findJar();
console.log(`bundle   ${aab}\nbundletool ${jar}`);

const javaJar = (sub: string[]): string => run(javaBin('java'), ['-jar', jar, ...sub]);
try { javaJar(['validate', `--bundle=${aab}`]); check(true, 'bundletool validate: the bundle is well formed'); } catch (e) { check(false, `bundletool validate: ${(e as Error).message.split('\n')[0]}`); }

const xml = javaJar(['dump', 'manifest', `--bundle=${aab}`]);
const attr = (name: string, tag = 'manifest'): string | undefined => new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`, 's').exec(xml)?.[1];
const pkg = attr('package');
const versionCode = attr('android:versionCode');
const versionName = attr('android:versionName');
const minSdk = attr('android:minSdkVersion', 'uses-sdk');
const targetSdk = attr('android:targetSdkVersion', 'uses-sdk');
console.log(`package ${pkg}  versionCode ${versionCode}  versionName ${versionName}  minSdk ${minSdk}  targetSdk ${targetSdk}`);
check(pkg === manifest.packageId, `package name ${pkg} is the one in twa-manifest.json (${manifest.packageId})`);
check(versionCode === String(manifest.appVersionCode), `versionCode ${versionCode} is appVersionCode ${manifest.appVersionCode}`);
check(versionName === manifest.appVersionName, `versionName ${versionName} is appVersionName ${manifest.appVersionName}`);
check(Number(targetSdk) >= 35, `targetSdkVersion ${targetSdk} meets Play's current floor (35)`);

const perms = [...xml.matchAll(/<uses-permission\b[^>]*android:name="([^"]+)"/g)].map((m) => m[1] as string).filter((n) => !n.startsWith(`${pkg}.`)).sort();   // the app's own DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION comes from AndroidX
const expected = ['android.permission.ACCESS_NETWORK_STATE', 'android.permission.INTERNET', 'android.permission.POST_NOTIFICATIONS', 'com.android.vending.BILLING'].sort();
console.log(`permissions ${perms.join(', ')}`);
check(JSON.stringify(perms) === JSON.stringify(expected), `permissions are exactly INTERNET, ACCESS_NETWORK_STATE, BILLING, POST_NOTIFICATIONS${perms.some((p) => /AD_ID/.test(p)) ? ' (AD_ID is there: it must not be)' : ''}`);
// The manifest points at @string/launchUrl; the value is a resource of the bundle.
const launch = /\[STR\] "([^"]*)"/.exec(javaJar(['dump', 'resources', `--bundle=${aab}`, '--resource=string/launchUrl', '--values']))?.[1];
check(/<meta-data[^>]*DEFAULT_URL[^>]*@string\/launchUrl/.test(xml) && launch === 'https://bodyarcade.com/?src=twa', `the launch address is ${launch} (expected https://bodyarcade.com/?src=twa)`);
check(xml.includes('com.google.androidbrowserhelper.playbilling.provider.PaymentActivity'), 'the Play Billing payment activity (Digital Goods API) is in the manifest');
// Release 4. The web manifest address is read by Chrome OS (Chromebooks) to open the site's own page: the first generated project carried the address of a local test server.
const manifestUrl = /\[STR\] "([^"]*)"/.exec(javaJar(['dump', 'resources', `--bundle=${aab}`, '--resource=string/webManifestUrl', '--values']))?.[1];
check(manifestUrl === 'https://bodyarcade.com/manifest.json', `the web manifest address is ${manifestUrl} (expected https://bodyarcade.com/manifest.json, never a local test server)`);
// The first launch with no connection shows the app's own screen instead of Chrome's error page (LauncherActivity, offline-first pattern of Google's TWA guide).
let offlineScreen = false;
try { offlineScreen = javaJar(['dump', 'resources', `--bundle=${aab}`, '--resource=layout/activity_offline_first']).includes('layout/activity_offline_first'); } catch { offlineScreen = false; }
check(offlineScreen, 'the offline first-launch screen (layout/activity_offline_first) is in the bundle');

// The signature on the bundle is a jar signature (Bubblewrap signs it with jarsigner and the upload key).
let sha: string | undefined;
try {
  const cert = run(javaBin('keytool'), ['-printcert', '-jarfile', aab]);
  sha = /SHA256:\s*([0-9A-F:]{95})/i.exec(cert)?.[1]?.toUpperCase();
} catch { sha = undefined; }
console.log(`signing certificate SHA-256 ${sha ?? '(the bundle is not signed)'}`);
const upload = manifest.fingerprints.find((f) => f.name === 'upload')?.value;
check(sha !== undefined && sha === upload, 'the bundle is signed with the upload key listed in twa-manifest.json');
check(sha !== undefined && assetlinks.includes(sha), 'that upload key is in release/static/.well-known/assetlinks.json');
console.log('Play app-signing key: not in the bundle; Play Console > Test and release > App integrity > App signing shows it after the first upload (then: node release/assetlinks.ts add <SHA-256>).');

const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\n${bad.length} check(s) FAILED` : `\nall ${results.length} checks passed`);
process.exit(bad.length ? 1 : 0);

