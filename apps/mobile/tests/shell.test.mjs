// Static checks of the Pulse phone app shell. Gradle and Xcode run only on hosted runners; these run everywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureOrigin, validateOrigin, DEFAULT_ORIGIN } from '../scripts/configure-origin.mjs';
import { releaseURL } from '../../../packages/companion/src/updates.js';

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
  assert.equal(pkg.version, '1.1.3');
  assert.match(gradle, /storeType "PKCS12"[\s\S]*keyAlias "pulse"/, 'the Expo build used this key store and alias');
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  assert.equal((pbx.match(new RegExp(`MARKETING_VERSION = ${pkg.version.replaceAll('.', '\\.')};`, 'g')) ?? []).length, 2);
  assert.equal((pbx.match(/CURRENT_PROJECT_VERSION = 1001003;/g) ?? []).length, 2);
});

test('the Android manifest asks for no tracking and keeps credentials on the phone', () => {
  assert.doesNotMatch(manifest, /RECORD_AUDIO|READ_CONTACTS|FOREGROUND_SERVICE/);
  // PRESENCE-ONBOARD (owner, 10 Oct 2026): office arrival by geofence. Background location exists only for Android's
  // own geofences around the person's offices, after their consent and a separate "Allow all the time"; there is no
  // foreground service and no continuous location request anywhere in the shell (a position is read once, on a tap).
  assert.match(manifest, /ACCESS_BACKGROUND_LOCATION/);
  assert.match(manifest, /OfficeArrival\$Receiver" android:exported="false"/);
  for (const f of readdirSync(resolve(app, 'android/app/src/main/java/com/pulse/work/mobile')).filter((f) => f.endsWith('.java'))) {
    const src = read(`android/app/src/main/java/com/pulse/work/mobile/${f}`);
    assert.doesNotMatch(src, /requestLocationUpdates|LocationRequest\.Builder|FusedLocationProviderClient/, `${f} never asks for continuous location`);
    if (f !== 'PulseShellPlugin.java') assert.doesNotMatch(src, /getCurrentLocation|requestSingleUpdate/, `${f} reads no position (only the tap in PulseShellPlugin does)`);
  }
  assert.doesNotMatch(read('android/app/src/main/java/com/pulse/work/mobile/OfficeArrival.java'), /getLatitude|getLongitude|"lat"\s*,|put\("lng"/, 'arrival sends an office and a signal kind, never a position');
  assert.doesNotMatch(manifest, /android\.permission\.CAMERA/, 'photos come from the camera app; no camera permission');
  // PEOPLE-CONTACTS: "Take a photo" (an image field with capture) opens the camera in WKWebView, which iOS allows only
  // with a camera usage description; Photo Library needs none (the system picker runs outside the app).
  assert.match(read('ios/App/App/Info.plist'), /<key>NSCameraUsageDescription<\/key>\s*<string>[^<]{20,}<\/string>/, 'the iPhone app says why it may use the camera');
  assert.doesNotMatch(read('ios/App/App/Info.plist'), /NSPhotoLibraryUsageDescription/, 'no photo-library access: the system picker hands over one picture');
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
  // Capacitor's own checkPermissions/requestPermissions are inherited on Android; iOS must list them (POLISH-1).
  const builtIn = ['checkPermissions', 'requestPermissions'];
  const iosMethods = [...swift.matchAll(/CAPPluginMethod\(name: "(\w+)"/g)].map(m => m[1]).filter(m => !builtIn.includes(m)).sort();
  for (const m of builtIn) assert.match(swift, new RegExp(`CAPPluginMethod\\(name: "${m}"[\\s\\S]*override public func ${m}\\(_ call: CAPPluginCall\\)`), `iOS dispatches and answers ${m}`);
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

const scratch = () => mkdtempSync(join(process.env.PAPERCLIP_RUN_SCRATCH_DIR || tmpdir(), 'pulse-origin-'));
const originFiles = ['capacitor.config.json', 'www/index.html', 'www/offline.html',
  'android/app/src/main/java/com/pulse/work/mobile/MainActivity.java', 'android/app/src/main/AndroidManifest.xml'];

test('one origin configures the complete Android shell; omitted input restores the exact default', () => {
  const dir = scratch();
  try {
    for (const path of ['capacitor.config.json', 'www', 'android/app/src/main']) {
      cpSync(resolve(app, path), resolve(dir, path), { recursive: true });
    }
    const contents = path => readFileSync(resolve(dir, path), 'utf8');
    configureOrigin(dir);
    for (const path of originFiles) assert.equal(contents(path), read(path), `default ${path} unchanged`);
    const origin = 'https://pulse.example.com', host = new URL(origin).hostname;
    configureOrigin(dir, origin);
    configureOrigin(dir, origin); // Repeated syncs are safe.
    configureOrigin(dir, 'https://com');
    configureOrigin(dir, 'https://company.example');
    assert.equal(JSON.parse(contents('capacitor.config.json')).server.url, 'https://company.example');
    configureOrigin(dir, origin); // A short previous host must not rewrite Java packages or identifiers.
    assert.match(contents(originFiles[3]), /^package com\.pulse\.work\.mobile;/);
    for (const path of originFiles) assert.doesNotMatch(contents(path), /estateautopilots/i, path);
    for (const file of readdirSync(resolve(dir, 'android/app/src/main/java/com/pulse/work/mobile'))) {
      assert.doesNotMatch(contents(`android/app/src/main/java/com/pulse/work/mobile/${file}`), /estateautopilots/i, file);
    }
    const built = JSON.parse(contents('capacitor.config.json'));
    assert.equal(built.server.url, origin);
    assert.deepEqual(built.server.allowNavigation, []);
    assert.equal(built.appId, config.appId);
    assert.ok(contents(originFiles[3]).includes(`static final String HOST = "${host}";`));
    assert.deepEqual([...contents(originFiles[4]).matchAll(/android:host="([^"]+)"/g)].map(m => m[1]), [host]);
    assert.ok(contents('www/index.html').includes(`location.replace('${origin}/dashboard')`));
    // Retry never follows an attacker-controlled external URL (including lookalike hosts and userinfo).
    const code = contents('www/offline.html').match(/<script>([\s\S]*?)<\/script>/)[1];
    for (const from of [origin + '/notes', 'https://external.example/', origin + '.evil/notes', origin + '@evil/']) {
      const context = { URLSearchParams, location: { search: '?from=' + encodeURIComponent(from) },
        document: { getElementById: () => ({ addEventListener() {} }) }, window: { addEventListener() {} }, setInterval() {} };
      runInNewContext(code, context);
      assert.equal(context.target, from === origin + '/notes' ? from : origin + '/');
    }
    for (const file of ['ShellWebViewClient', 'ShellDownloads', 'PulseShellPlugin']) {
      assert.match(contents(`android/app/src/main/java/com/pulse/work/mobile/${file}.java`), /MainActivity\.HOST\.equals\(/);
    }
    assert.match(contents('android/app/src/main/java/com/pulse/work/mobile/Gateway.java'), /BASE = MainActivity\.ORIGIN/);
    assert.match(contents('android/app/src/main/java/com/pulse/work/mobile/Updater.java'), /MANIFEST = MainActivity\.ORIGIN/);
    configureOrigin(dir);
    for (const path of originFiles) assert.equal(contents(path), read(path), `restored ${path}`);
    assert.equal(validateOrigin(), DEFAULT_ORIGIN);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('origin rejects ambiguous URLs before changing files', () => {
  for (const value of ['http://pulse.example.com', 'https://pulse.example.com/', 'https://pulse.example.com/path',
    'https://pulse.example.com?x=1', 'https://pulse.example.com#x', 'https://user@pulse.example.com',
    'https://pulse.example.com:443', 'https://pulse.example.com\\evil', 'https://pulse.example.com\n',
    'https://-invalid.example', 'https://pulse..example', 'https://', ' https://pulse.example.com']) {
    assert.throws(() => configureOrigin('/does-not-exist', value), /origin must be/, value);
  }
});

test('host releases keep trusted URLs and publish only their own download entry; default publication is unchanged', () => {
  const tags = [];
  for (const origin of ['', 'https://pulse.example.com', 'https://another.example.com']) {
    const dir = scratch();
    try {
      mkdirSync(join(dir, 'artifacts'));
      mkdirSync(join(dir, 'bin'));
      writeFileSync(join(dir, 'artifacts', `Pulse-${pkg.version}-android.apk`), 'synthetic-apk');
      if (!origin) writeFileSync(join(dir, 'artifacts', `Pulse-${pkg.version}-ios-simulator.zip`), 'synthetic-ios');
      writeFileSync(join(dir, 'bin/gh'), `#!/usr/bin/env node\nrequire('node:fs').appendFileSync('calls.jsonl', JSON.stringify(process.argv.slice(2))+'\\n');\n`, { mode: 0o755 });
      const sha = 'a'.repeat(40);
      const result = JSON.parse(execFileSync(process.execPath, [resolve(app, 'scripts/publish-prerelease.mjs')], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH,
          RELEASE_VERSION: pkg.version, GITHUB_SHA: sha, GITHUB_RUN_ID: '123', GITHUB_REF: 'refs/heads/main',
          GITHUB_REPOSITORY: 'Estate-Autopilots/pulse-companion', PULSE_ORIGIN: origin },
      }));
      const suffix = origin ? createHash('sha256').update(origin).digest('hex').slice(0, 8) : '';
      assert.equal(result.tag, `companion-v${pkg.version}-${sha.slice(0, 7)}${suffix}`);
      tags.push(result.tag);
      const entryName = origin ? `android-${new URL(origin).hostname}-entry.json` : 'android-channel-entry.json';
      const entry = JSON.parse(readFileSync(join(dir, 'release', entryName)));
      assert.equal(entry.origin, origin || undefined);
      assert.equal(entry.versionCode, 1001003);
      assert.equal(entry.size, Buffer.byteLength('synthetic-apk'));
      assert.equal(entry.sha256, createHash('sha256').update('synthetic-apk').digest('hex'));
      assert.equal(entry.url, `https://github.com/Estate-Autopilots/pulse-companion/releases/download/${result.tag}/${entry.name}`);
      assert.ok(releaseURL(entry.url)); // Installed app release trust rule accepts the host-suffixed tag.
      const calls = readFileSync(join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      const upload = calls.find(args => args[1] === 'upload');
      assert.equal(upload[2], 'companion-phone');
      assert.deepEqual(upload.slice(3, -3), [`release/${entryName}`, ...(!origin ? ['release/ios-simulator-entry.json'] : [])]);
      assert.ok(!calls.flat().includes('companion-test'));
      if (origin) {
        assert.doesNotMatch(calls.flat().join(' '), /android-channel-entry|ios-simulator-entry/);
        assert.ok(calls.find(args => args[1] === 'create').includes(`Pulse for Android ${pkg.version} (${new URL(origin).hostname}, pre-release)`));
        assert.ok(!existsSync(join(dir, 'release/ios-simulator-entry.json')));
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  assert.equal(new Set(tags).size, tags.length);
});
