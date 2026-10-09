// Gentle reminders: check in when the shift starts, come back from a long break, check out when the shift ends.
// Each one fires at most once (keyed by day or by break) and every kind can be switched off by the person.
import { duration, friendlyClock } from './time.js';
import { liveSeconds } from './view.js';

export const DEFAULT_PREFS = Object.freeze({
  checkIn: true,          // at shift start when not checked in
  breakBack: true,        // after a long break
  checkOut: true,         // at shift end while still checked in
  breakMinutes: 30,
  popAtStart: true,       // desktop: slide the panel up when the workday starts
  mascot: true,           // show Pip
  autoStart: false,       // desktop: open at sign-in to the computer (opt-in)
  autoCheckIn: false,     // phone: automatic check-in at the office (also needs HR policy)
  presence: false,        // phone: office / site suggestions (needs location consent)
});

export function prefsWith(saved) {
  const out = { ...DEFAULT_PREFS };
  for (const [k, v] of Object.entries(saved ?? {})) if (k in DEFAULT_PREFS && typeof v === typeof DEFAULT_PREFS[k]) out[k] = v;
  out.breakMinutes = Math.min(180, Math.max(5, Math.round(out.breakMinutes)));
  return out;
}

/** Reminders due at `at` that have not been shown yet (`shown` is a Set or array of reminder ids). */
export function dueReminders(payload, prefs, at, shown = []) {
  if (!payload || payload.attendanceEnabled !== true) return [];
  const seen = new Set(shown), out = [];
  const p = prefsWith(prefs), state = payload.state;
  const start = Date.parse(payload.shiftStartsAt ?? ''), end = Date.parse(payload.shiftEndsAt ?? '');
  const add = (r) => { if (!seen.has(r.id)) out.push(r); };
  if (p.checkIn && state === 'out' && payload.shift?.workingDay && Number.isFinite(start) && at >= start - 5 * 60000 && (!Number.isFinite(end) || at < end)) {
    add({ id: `check-in:${payload.today}`, kind: 'check-in', action: 'check-in', title: 'Time to check in', body: `Your shift starts at ${friendlyClock(payload.shift.start)}. One click and you’re in.` });
  }
  if (p.breakBack && state === 'break' && payload.entry?.breakStartedAt) {
    const away = liveSeconds(payload.entry, at).onBreak;
    if (away >= p.breakMinutes * 60) add({ id: `break:${payload.entry.breakStartedAt}`, kind: 'break-back', action: 'break-end', title: 'Back from your break?', body: `You’ve been away ${duration(away)}. Tap when you’re back.` });
  }
  if (p.checkOut && (state === 'in' || state === 'break') && Number.isFinite(end) && at >= end) {
    add({ id: `check-out:${payload.today}`, kind: 'check-out', action: 'check-out', title: 'Shift is over', body: `It’s past ${friendlyClock(payload.shift.end)}. Check out when you’re done for the day.` });
  }
  return out;
}

/**
 * Reminders to hand to the operating system ahead of time (phone local notifications), so they arrive even when
 * the app is closed. Rebuilt after every refresh: today's entry decides today's reminder; later days get a
 * check-in reminder at their shift start.
 */
export function reminderPlan(payload, prefs, at, days = 7) {
  if (!payload || payload.attendanceEnabled !== true) return [];
  const p = prefsWith(prefs), plan = [];
  const start = Date.parse(payload.shiftStartsAt ?? ''), end = Date.parse(payload.shiftEndsAt ?? '');
  if (p.checkIn && payload.state === 'out' && payload.shift?.workingDay && Number.isFinite(start) && start > at) {
    plan.push({ id: `check-in:${payload.today}`, at: start, kind: 'check-in', action: 'check-in', title: 'Time to check in', body: `Your shift starts at ${friendlyClock(payload.shift.start)}.` });
  }
  if (p.checkOut && (payload.state === 'in' || payload.state === 'break') && Number.isFinite(end) && end > at) {
    plan.push({ id: `check-out:${payload.today}`, at: end, kind: 'check-out', action: 'check-out', title: 'Shift is over', body: `Check out when you’re done. Shift ended at ${friendlyClock(payload.shift.end)}.` });
  }
  if (p.breakBack && payload.state === 'break' && payload.entry?.breakStartedAt) {
    const due = Date.parse(payload.entry.breakStartedAt) + p.breakMinutes * 60000;
    if (due > at) plan.push({ id: `break:${payload.entry.breakStartedAt}`, at: due, kind: 'break-back', action: 'break-end', title: 'Back from your break?', body: 'Tap when you’re back at work.' });
  }
  if (p.checkIn) for (const day of payload.upcoming ?? []) {
    const when = Date.parse(day.startsAt);
    if (day.date !== payload.today && Number.isFinite(when) && when > at && when <= at + days * 86400000) {
      plan.push({ id: `check-in:${day.date}`, at: when, kind: 'check-in', action: 'check-in', title: 'Time to check in', body: `Your shift starts at ${friendlyClock(day.start)}.` });
    }
  }
  return plan.sort((a, b) => a.at - b.at);
}

/** Desktop: should the panel slide up by itself now (workday start), and under which key so it happens once? */
export function shouldPopUp(payload, prefs, at, shown = []) {
  const p = prefsWith(prefs);
  if (!p.popAtStart || !payload || payload.attendanceEnabled !== true || payload.state !== 'out' || !payload.shift?.workingDay) return null;
  const start = Date.parse(payload.shiftStartsAt ?? '');
  const key = `pop:${payload.today}`;
  if (!Number.isFinite(start) || new Set(shown).has(key)) return null;
  return at >= start - 10 * 60000 && at <= start + 2 * 3600000 ? key : null;
}
