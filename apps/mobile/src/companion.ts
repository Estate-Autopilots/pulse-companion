// The phone companion: the day (online or from the encrypted cache plus the offline queue), one-tap actions,
// reminders as local notifications with action buttons, and presence: office/site geofences through the OS (region
// monitoring, no polling, no location history) and office Wi-Fi. Pure decisions live in the shared core.
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import NetInfo from '@react-native-community/netinfo';
import { actionRequest, ANDROID_REGION_LIMIT, decidePresence, enqueue, IOS_REGION_LIMIT, outcomeOf, prefsWith, presenceBody, projected, prune, queuedRequest, regionsToMonitor, reminderPlan, settle, wifiMatch, type ActionId, type CompanionPayload, type Prefs, type PresenceDecision, type PresenceSignal, type QueueItem, type Region } from '../../../packages/companion/src/index.js';
import { cached, load, queueRead, queueWrite, request, sessionGeneration } from './client';

// Configure once before foreground listeners attach; reconfiguring on each lookup tears them down.
NetInfo.configure({ shouldFetchWiFiSSID: true });

export const GEOFENCE_TASK = 'pulse-presence';
const PREFS = 'pulse.companion-prefs';
const RECENT = 'pulse.presence-recent';
const CATEGORY: Record<string, { id: string; actions: { identifier: ActionId; buttonTitle: string }[] }> = {
  'check-in': { id: 'pulse-check-in', actions: [{ identifier: 'check-in', buttonTitle: 'Check in' }] },
  'break-back': { id: 'pulse-back', actions: [{ identifier: 'break-end', buttonTitle: 'I’m back' }] },
  'check-out': { id: 'pulse-check-out', actions: [{ identifier: 'check-out', buttonTitle: 'Check out' }] },
  leave: { id: 'pulse-leave', actions: [{ identifier: 'break-start', buttonTitle: 'Take a break' }, { identifier: 'check-out', buttonTitle: 'Check out' }] },
};

export async function readPrefs(): Promise<Prefs> {
  try { return prefsWith(JSON.parse((await SecureStore.getItemAsync(PREFS)) ?? '{}')); } catch { return prefsWith({}); }
}
export async function writePrefs(next: Partial<Prefs>) {
  const p = prefsWith({ ...(await readPrefs()), ...next });
  await SecureStore.setItemAsync(PREFS, JSON.stringify(p), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
  if ('presence' in next || 'autoCheckIn' in next) await request('companion/presence',{consent:p.presence,autoConsent:p.autoCheckIn,consentOnly:true}).catch(() => null);
  return p;
}

// ------------------------------------------------------------------------------------------------- the day
/** The day for the person: fresh when online, otherwise the encrypted cache; queued taps are applied on top. */
export async function loadDay(): Promise<{ payload: CompanionPayload; offline: boolean; queued: number; at: string } | null> {
  const queue = await queueRead<QueueItem>();
  try {
    // Reconcile preferences first, including an opt-out saved offline, before a GET can tick office dwell.
    const p=await readPrefs();
    await request('companion/presence',{consent:p.presence,autoConsent:p.autoCheckIn,consentOnly:true});
    const r = await load('companion');
    const payload = r.data as CompanionPayload;
    return { payload: queue.length ? projected(payload, queue) : payload, offline: r.offline, queued: queue.length, at: r.at };
  } catch (e) {
    const old = await cached('companion');
    const why = e as { offline?: boolean; gate?: boolean };
    if (!old || !(why.offline || why.gate)) throw e;
    return { payload: projected(old.data as CompanionPayload, queue), offline: true, queued: queue.length, at: old.at };
  }
}

/** One tap. Offline (or the outer gate) keeps it in the queue with its original time. */
let attendanceWork: Promise<unknown> = Promise.resolve();
let attendancePending = 0;
const attendanceObservers = new Set<() => void>();
export const attendanceInProgress = () => attendancePending > 0;
export function observeAttendance(listener: () => void) { attendanceObservers.add(listener); return () => { attendanceObservers.delete(listener); }; }
function attendanceChanged() { for (const listener of attendanceObservers) { try { listener(); } catch { /* update UI must not interrupt attendance */ } } }
function sameSession(expected: number) {
  if (sessionGeneration() !== expected) throw Error('Your sign-in changed. Try again in the current workspace.');
}
function inOrder<T>(work: (expected: number) => Promise<T>): Promise<T> {
  const expected = sessionGeneration();
  attendancePending++; attendanceChanged();
  const run = attendanceWork.catch(() => {}).then(() => { sameSession(expected); return work(expected); })
    .finally(() => { attendancePending--; attendanceChanged(); });
  attendanceWork = run;
  return run;
}
export function act(action: ActionId, extra: Record<string, unknown> = {}): Promise<{ queued: boolean }> {
  const tappedAt = Date.now();
  return inOrder(async (expected) => {
  const body = { via: 'mobile', trigger: 'manual', ...extra };
  const { path, body: payload } = actionRequest(action, body);
  try {
    await flushQueueOnce(expected);
    sameSession(expected);
    await request(path, payload);
    return { queued: false };
  } catch (e) {
    sameSession(expected);
    if (outcomeOf(e) !== 'retry' || (e as { status?: number }).status === 401) throw e;
    const queue = await queueRead<QueueItem>();
    sameSession(expected);
    await queueWrite(enqueue(queue, action, tappedAt, body), expected);
    return { queued: true };
  }
  });
}

/** Send queued taps in order. Returns how many were sent and which were too old (the person asks for a correction). */
export function flushQueue(): Promise<{ sent: number; expired: number; refused: string[] }> {
  return inOrder(flushQueueOnce);
}
async function flushQueueOnce(expected: number): Promise<{ sent: number; expired: number; refused: string[] }> {
  const saved = await queueRead<QueueItem>();
  const { keep, expired } = prune(saved, Date.now());
  sameSession(expected);
  let queue = keep, sent = 0;
  const refused: string[] = [];
  while (queue.length) {
    const item = queue[0], { action, extra } = queuedRequest(item), { path, body } = actionRequest(action, extra);
    try { sameSession(expected); await request(path, body); sameSession(expected); queue = settle(queue, item.id, 'ok'); sent++; }
    catch (e) {
      sameSession(expected);
      const outcome = outcomeOf(e);
      queue = settle(queue, item.id, outcome);
      if (outcome === 'retry') break;
      refused.push((e as Error).message);
    }
  }
  if (saved.length) await queueWrite(queue, expected);
  return { sent, expired: expired.length, refused };
}

// ----------------------------------------------------------------------------------------- notifications
export async function setupNotifications() {
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('attendance', { name: 'Check-in reminders', importance: Notifications.AndroidImportance.HIGH });
    await Notifications.setNotificationChannelAsync('presence', { name: 'At the office', importance: Notifications.AndroidImportance.HIGH });
  }
  for (const c of Object.values(CATEGORY)) await Notifications.setNotificationCategoryAsync(c.id, c.actions.map((a) => ({ ...a, options: { opensAppToForeground: true } })));
}

/** Rebuild the scheduled reminders from the day (shift start, back from break, shift end), as switched on. */
export async function scheduleReminders(payload: CompanionPayload | null, prefs: Prefs) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) if (n.identifier.startsWith('reminder:')) await Notifications.cancelScheduledNotificationAsync(n.identifier);
  if (!payload || payload.demo) return 0;
  const plan = reminderPlan(payload, prefs, Date.now()).slice(0, 20);
  for (const r of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: `reminder:${r.id}`,
      content: { title: r.title, body: r.body, categoryIdentifier: CATEGORY[r.kind].id, data: { action: r.action, reminder: r.id } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at, ...(Platform.OS === 'android' ? { channelId: 'attendance' } : {}) },
    });
  }
  return plan.length;
}

/** A tap on a notification or one of its buttons: the action to run, with where it came from. */
export function responseAction(response: Notifications.NotificationResponse): { action: ActionId; extra: Record<string, unknown> } | null {
  const data = response.notification.request.content.data as { action?: ActionId; body?: Record<string, unknown> } | undefined;
  const pressed = response.actionIdentifier;
  const action = (pressed && pressed !== Notifications.DEFAULT_ACTION_IDENTIFIER ? pressed : null) as ActionId | null;
  if (!action || !['check-in', 'break-start', 'break-end', 'check-out'].includes(action)) return null;
  const extra = { ...(data?.body ?? {}), trigger: data?.body?.trigger ?? 'notification' };
  return { action, extra };
}

// ---------------------------------------------------------------------------------------------- presence
async function recent(): Promise<{ key: string; at: number }[]> { try { return JSON.parse((await SecureStore.getItemAsync(RECENT)) ?? '[]'); } catch { return []; } }
async function remember(key: string) { const r = (await recent()).filter((x) => Date.now() - x.at < 6 * 3600000).slice(-20); r.push({ key, at: Date.now() }); await SecureStore.setItemAsync(RECENT, JSON.stringify(r), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }); }

/** Act on one presence signal: a suggestion notification, an automatic check-in (HR + person), or nothing. */
export async function onPresence(signal: PresenceSignal, notify = true): Promise<PresenceDecision> {
  const prefs = await readPrefs();
  let payload: CompanionPayload | null = null;
  try { payload = (await loadDay())?.payload ?? null; } catch { payload = null; }
  let server: {checkedIn?:boolean;score?:number;dwellMinutes?:number} | null = null;
  if (signal.place.kind === 'office' && prefs.presence) server = await syncOfficePresence(payload, signal).catch(() => null);
  let decision = decidePresence({ signal, payload, prefs, at: Date.now(), recent: await recent() });
  // An offline tap or a single region event can never announce an automatic check-in. Pulse confirms the dwell.
  if (decision.kind === 'auto-check-in') decision = { ...decision, kind: 'suggest-check-in', title: `You’re at ${signal.place.name} — check in?`, body: 'Pulse confirms automatic check-in after office dwell. You can check in now.', actions:['check-in'] };
  if (server?.checkedIn && payload?.state === 'out') {
    const confirmed = await loadDay().catch(() => null);
    if (confirmed?.payload.state === 'in' && !confirmed.payload.pending) decision = { kind:'auto-check-in', key:`arrive:${signal.place.placeId}`, placeId:signal.place.placeId, title:'You’re checked in', body:'Office presence was confirmed by Pulse after your arrival dwell.', actions:[] };
  }
  if (decision.kind === 'none' || !decision.key) return decision;
  await remember(decision.key);
  if (notify) {
    const category = decision.kind === 'suggest-leave' ? CATEGORY.leave.id : decision.kind === 'suggest-check-in' ? CATEGORY['check-in'].id : undefined;
    await Notifications.scheduleNotificationAsync({
      content: { title: decision.title ?? 'Pulse', body: decision.body ?? '', ...(category ? { categoryIdentifier: category } : {}), data: { action: decision.actions?.[0] ?? null, body: decision.kind === 'suggest-check-in' ? presenceBody(decision, signal) : { via: 'mobile', trigger: 'suggested' } } },
      trigger: Platform.OS === 'android' ? { channelId: 'presence' } as Notifications.NotificationTriggerInput : null,
    });
  }
  return decision;
}

/** OS region event (from the background task): enter/exit an office or confirmed site. */
export async function onRegion(kind: 'enter' | 'exit', identifier: string) {
  const day = await loadDay().catch(() => null);
  const place = regionsToMonitor(day?.payload.presence, Infinity).find((r) => r.id === identifier);
  if (!place) return null;
  return onPresence({ trigger: kind, place });
}

export type PresenceStatus = { on: boolean; background: boolean; regions: number; note: string };

/** Turn presence on: ask for location, then let the OS watch the office and site boundaries. */
export async function startPresence(payload: CompanionPayload): Promise<PresenceStatus> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return { on: false, background: false, regions: 0, note: 'Location permission is off, so office suggestions are unavailable. You can still check in manually.' };
  const regions = regionsToMonitor(payload.presence, Platform.OS === 'ios' ? IOS_REGION_LIMIT : ANDROID_REGION_LIMIT);
  let bg = await Location.getBackgroundPermissionsAsync();
  if (!bg.granted && bg.canAskAgain) bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.granted && regions.length) {
    await Location.startGeofencingAsync(GEOFENCE_TASK, regions.map((r) => ({ identifier: r.id, latitude: r.lat, longitude: r.lng, radius: r.radius, notifyOnEnter: true, notifyOnExit: true })));
    return { on: true, background: true, regions: regions.length, note: `Watching ${regions.length} place${regions.length === 1 ? '' : 's'} through your phone’s own region monitoring. No location history is kept.` };
  }
  await stopPresence();
  return { on: true, background: false, regions: regions.length, note: regions.length ? 'Office Wi-Fi can suggest check-in when you open Pulse. Allow location “all the time” for region arrival reminders.' : 'HR has not registered an office yet.' };
}
export async function stopPresence() {
  if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false)) await Location.stopGeofencingAsync(GEOFENCE_TASK);
}

/** A foreground network event or app resume may inspect office Wi-Fi. GPS stays with OS region monitoring. */
/** Report current Wi-Fi and OS boundary evidence; the server scores its own public-IP match. */
export async function syncOfficePresence(payload: CompanionPayload | null, signal?: PresenceSignal) {
  const prefs = await readPrefs();
  const net = prefs.presence ? await NetInfo.fetch('wifi').catch(() => null) : null;
  const details = (net?.type === 'wifi' ? net.details : null) as {ssid?:string|null;bssid?:string|null}|null;
  const wifi = {ssid:details?.ssid??null,bssid:details?.bssid??null};
  const place = signal?.place.kind === 'office' ? signal.place : wifiMatch(wifi,payload?.presence);
  return request('companion/presence',{consent:prefs.presence,autoConsent:prefs.autoCheckIn, ...(place?{officeId:place.placeId}:{}),wifi,
    ...(signal?.place.kind==='office' && ['enter','exit'].includes(signal.trigger)?{region:signal.trigger}:{})});
}
export async function checkHere(payload: CompanionPayload): Promise<{ signal: PresenceSignal; decision: PresenceDecision } | null> {
  const prefs = await readPrefs();
  if (!prefs.presence) return null;
  const net = await NetInfo.fetch('wifi').catch(() => null);
  const details = (net?.details ?? null) as { ssid?: string | null; bssid?: string | null } | null;
  const wifi = net?.type === 'wifi' ? wifiMatch({ ssid: details?.ssid ?? null, bssid: details?.bssid ?? null }, payload.presence) : null;
  if (wifi) { const signal = { trigger: 'wifi' as const, place: wifi as Region }; return { signal, decision: await onPresence(signal, false) }; }
  await syncOfficePresence(payload).catch(() => null);
  return null;
}
