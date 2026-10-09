// Static checks of the Pulse phone app shell. Gradle and Xcode run only on hosted runners; these run everywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(app, '../..');
const read = p => readFileSync(resolve(app, p), 'utf8');
const config = JSON.parse(read('capacitor.config.json'));
const pkg = JSON.parse(read('package.json'));
const manifest = read('android/app/src/main/AndroidManifest.xml');
const gradle = read('android/app/build.gradle');
const java = read('android/app/src/main/java/com/pulse/work/mobile/PulseShellPlugin.java');
const swift = read('ios/App/App/PulseShellPlugin.swift');
// The published Expo 1.0.0 APK (companion-v1.0.0-8aec149), read from its binary manifest on 9 October 2026.
const PUBLISHED_EXPO_VERSION_CODE = 1000000;
const PULSE_SIGNING_SHA256 = '7fb7e080fe49b5f285cbd436c500167575d5f1e6f862e7fbbebb3bec6d0989e6';

test('the shell loads production Pulse and nothing else inside the app', () => {
  assert.equal(config.appId, 'com.pulse.work.mobile');
  assert.equal(config.server.url, 'https://pulse.estateautopilots.com');
  assert.deepEqual(config.server.allowNavigation, [], 'other sites open outside the app');
  assert.notEqual(config.server.cleartext, true);
  assert.equal(config.android.allowMixedContent, false);
  assert.equal(config.android.webContentsDebuggingEnabled, false);
  assert.equal(config.plugins.CapacitorHttp.enabled, false, 'the page keeps its own fetch and cookies');
  assert.ok(existsSync(resolve(app, 'www', config.server.errorPath)), 'the offline screen is bundled');
  assert.match(config.appendUserAgent, new RegExp(`^PulseShell/${pkg.version.replaceAll('.', '\\.')}$`));
});

test('the offline screen only ever reopens Pulse', () => {
  const html = read('www/offline.html');
  assert.match(html, /var ORIGIN = 'https:\/\/pulse\.estateautopilots\.com';/);
  assert.match(html, /from\.indexOf\(ORIGIN \+ '\/'\) === 0 \? from : ORIGIN \+ '\/'/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|https?:\/\/(?!pulse\.estateautopilots\.com|www\.w3\.org)/, 'self-contained: works with no network');
  assert.match(html, />Retry</);
});

test('installs over the Expo app: same package, durable key, higher versionCode', () => {
  assert.match(gradle, /applicationId "com\.pulse\.work\.mobile"/);
  assert.match(gradle, new RegExp(`def pulseVersion = '${pkg.version.replaceAll('.', '\\.')}'`));
  const [a, b, c] = pkg.version.split('.').map(Number);
  assert.ok(a * 1000000 + b * 1000 + c > PUBLISHED_EXPO_VERSION_CODE);
  assert.equal(pkg.version, '1.1.0');
  assert.match(gradle, /storeType "PKCS12"[\s\S]*keyAlias "pulse"/, 'the Expo build used this key store and alias');
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  assert.equal((pbx.match(new RegExp(`MARKETING_VERSION = ${pkg.version.replaceAll('.', '\\.')};`, 'g')) ?? []).length, 2);
  assert.equal((pbx.match(/CURRENT_PROJECT_VERSION = 1001000;/g) ?? []).length, 2);
});

test('the Android manifest asks for no tracking and keeps credentials on the phone', () => {
  assert.doesNotMatch(manifest, /ACCESS_BACKGROUND_LOCATION|RECORD_AUDIO|READ_CONTACTS|FOREGROUND_SERVICE/);
  assert.doesNotMatch(manifest, /android\.permission\.CAMERA/, 'photos come from the camera app; no camera permission');
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
  assert.equal((manifest.match(/android:exported="true"/g) ?? []).length, 1, 'only the main activity is exported');
});

test('all production Pulse routes open in the app, including future web routes', () => {
  assert.match(manifest, /android:autoVerify="true"/);
  assert.match(manifest, /android:host="pulse\.estateautopilots\.com"/);
  assert.doesNotMatch(manifest, /android:path(?:Prefix|Pattern)?=/, 'App Links cover every production route');
  const hosts = [...manifest.matchAll(/android:host="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(hosts, ['pulse.estateautopilots.com'], 'external domains stay outside the app');
  const links = resolve(repo, 'apps/web/app/lib/assetlinks.json');
  if (existsSync(links)) {
    const target = JSON.parse(readFileSync(links, 'utf8'))[0].target;
    assert.equal(target.package_name, 'com.pulse.work.mobile');
    assert.deepEqual(target.sha256_cert_fingerprints, [PULSE_SIGNING_SHA256.match(/../g).join(':').toUpperCase()]);
  }
});

test('the bridge has the same methods on Android, iPhone and in the web app', () => {
  const androidMethods = [...java.matchAll(/@PluginMethod[^\n]*\n(?:\s*@[^\n]+\n)*\s*public void (\w+)\(PluginCall/g)].map(m => m[1]).sort();
  const iosMethods = [...swift.matchAll(/CAPPluginMethod\(name: "(\w+)"/g)].map(m => m[1]).sort();
  assert.deepEqual(iosMethods, androidMethods);
  const web = resolve(repo, 'apps/web/app/lib/native-shell.ts');
  if (existsSync(web)) {
    const body = readFileSync(web, 'utf8').split('export interface PulseShell {')[1].split('\n}')[0];
    const webMethods = [...body.matchAll(/^\s+(\w+)\(/gm)].map(m => m[1]).filter(m => !['checkPermissions', 'requestPermissions'].includes(m)).sort();
    assert.deepEqual(webMethods, androidMethods);
  }
});

test('updates only come from Pulse release downloads and are verified before the installer opens', () => {
  const updater = read('android/app/src/main/java/com/pulse/work/mobile/Updater.java');
  assert.match(updater, /\^\/Estate-Autopilots\/pulse-companion\/releases\/download\/companion-v/);
  assert.match(updater, /bytes != size \|\| !hex\(digest\.digest\(\)\)\.equals\(sha256\)/);
  assert.match(updater, /newCode <= oldCode \|\| oldSigners\.isEmpty\(\) \|\| !oldSigners\.equals\(signers\(candidate\)\)/);
  assert.match(updater, /api\/app-updates\/test\/latest\.json/);
});

test('the device credential never reaches the page', () => {
  for (const method of ['finishEnrollment', 'info']) {
    const body = java.split(`public void ${method}(PluginCall call)`)[1].split('@PluginMethod')[0];
    assert.doesNotMatch(body, /out\.put\("(accessToken|refreshToken|pollSecret)"|r\.put\("(accessToken|refreshToken|pollSecret)"/);
  }
  assert.match(read('android/app/src/main/java/com/pulse/work/mobile/ShellStore.java'), /AndroidKeyStore[\s\S]*AES\/GCM\/NoPadding/);
  assert.match(swift, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);
});

test('no Expo or React Native code remains', () => {
  assert.ok(!Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some(d => /^(expo|react-native|@expo\/|react$)/.test(d)));
  assert.equal(createHash('sha256').update(PULSE_SIGNING_SHA256).digest('hex').length, 64);
});
