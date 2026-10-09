// After the owner's go-ahead only: offer an approved phone-app pre-release on the test channel (latest.json, the
// Android channel since desktops moved to latest-desktop.json). The installed Expo 1.0.0 app then updates to it: same
// package and key, higher versionCode. latest-desktop.json is never touched, so no desktop sees an update.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newer, parseManifest } from '../../../packages/companion/src/updates.js';

const repo = 'Estate-Autopilots/pulse-companion', channel = 'test';
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const tag = process.env.PROMOTE_TAG ?? '';
if (!/^companion-v\d+\.\d+\.\d+-[a-f0-9]{7}$/.test(tag)) throw Error('Name a published phone pre-release tag');
if (process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_REPOSITORY !== repo) throw Error('Only public main promotes');
const dir = await mkdtemp(join(tmpdir(), 'pulse-promote-'));
gh('release', 'download', tag, '-R', repo, '-p', 'android-channel-entry.json', '-p', '*-android.apk', '-D', dir);
const entry = JSON.parse(await readFile(join(dir, 'android-channel-entry.json'), 'utf8'));
const bytes = await readFile(join(dir, entry.name));
if (bytes.length !== entry.size || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error('The pre-release APK does not match its channel entry');
if (!entry.url.endsWith(`/releases/download/${tag}/${entry.name}`)) throw Error('Entry points outside its own release');
const manifest = JSON.parse(gh('release', 'download', `companion-${channel}`, '-R', repo, '-p', 'latest.json', '-O', '-'));
parseManifest(manifest, channel);
// Desktop apps read latest-desktop.json (R20b), so latest.json is the phone channel and may take the phone's version.
// Without that split, raising the version would offer desktops their own build again: refuse instead.
let desktopSplit = true;
try { gh('release', 'download', `companion-${channel}`, '-R', repo, '-p', 'latest-desktop.json', '-O', '-'); } catch { desktopSplit = false; }
const phoneVersion = entry.name.match(/^Pulse-(\d+\.\d+\.\d+)-android\.apk$/)[1];
if (desktopSplit) {
  // Installed Expo 1.0.0 apps compare this version with their own before they read the Android entry.
  if (newer(phoneVersion, manifest.version)) manifest.version = phoneVersion;
} else if (!newer(manifest.version, '1.0.0')) {
  throw Error(`The test channel is at ${manifest.version} and desktops still read it; publish a desktop-only release (latest-desktop.json) first.`);
}
manifest.notes = 'The new Pulse phone app: the full Pulse, with notifications, Pulse links that open in the app, and check-in on Today. Sign in once with your Pulse username and password.';
manifest.files = [...manifest.files.filter(f => f.platform !== 'android'), entry];
parseManifest(manifest, channel);
await writeFile(join(dir, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
gh('release', 'upload', `companion-${channel}`, join(dir, 'latest.json'), '-R', repo, '--clobber');
console.log(JSON.stringify({ promoted: tag, channel, channelVersion: manifest.version, apk: entry.name, sha256: entry.sha256, versionCode: entry.versionCode }));
