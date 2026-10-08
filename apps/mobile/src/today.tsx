// The phone's Today screen: Pip and the day, one big button for the next step, office suggestions and reminders.
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { deriveView, MODES, type ActionId, type CompanionPayload, type Mode, type Prefs, type PresenceDecision } from '../../../packages/companion/src/index.js';
import { nativeTokens } from '../../../packages/design-system/src/native';
import { Pip } from './pip';
import type { PresenceStatus } from './companion';

type Tokens = (typeof nativeTokens)['light'] | (typeof nativeTokens)['dark'];
const TONE: Record<string, { light: string; dark: string }> = {
  success: { light: '#328267', dark: '#79c3a5' }, warning: { light: '#9a6209', dark: '#e2b667' }, info: { light: '#4167cf', dark: '#8da5ff' }, neutral: { light: '#66687e', dark: '#a7a8bb' },
};

export function TodayCard({ payload, offset, theme, dark, busy, status, mode, onMode, onAct, onOpen, celebrate, showPip }: {
  payload: CompanionPayload | null; offset: number; theme: Tokens; dark: boolean; busy: boolean; status?: { text: string; tone?: 'success' | 'warning' } | null;
  mode: Mode; onMode: (m: Mode) => void; onAct: (id: ActionId) => void; onOpen: (href: string) => void; celebrate: boolean; showPip: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const view = deriveView(payload, now + offset, { celebrate });
  const tone = TONE[view.chip.tone] ?? TONE.neutral;
  return (
    <View style={[s.card, { backgroundColor: theme.surface }]}>
      <View style={s.head}>
        {showPip ? <Pip mood={view.mood} size={84} dark={dark} /> : null}
        <View style={{ flex: 1, gap: 2 }}>
          {view.greeting ? <Text style={[s.greet, { color: theme.muted }]}>{view.greeting}</Text> : null}
          <Text accessibilityRole="header" style={[s.title, { color: theme.text }]}>{view.title}</Text>
          <View style={[s.chip, { backgroundColor: dark ? '#23232f' : '#efeff6' }]}>
            <View style={[s.dot, { backgroundColor: tone[dark ? 'dark' : 'light'] }]} />
            <Text style={{ color: tone[dark ? 'dark' : 'light'], fontSize: 12.5, fontWeight: '600' }}>{view.chip.text}</Text>
          </View>
        </View>
      </View>
      {view.timer ? (
        <View style={s.timer} accessible accessibilityLabel={`${view.timer.display} ${view.timer.label}`}>
          <Text style={[s.clock, { color: theme.text }]}>{view.timer.display}</Text>
          <Text style={{ color: theme.muted, fontSize: 14 }}>{view.timer.label}</Text>
        </View>
      ) : null}
      {view.subtitle ? <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20 }}>{view.subtitle}</Text> : null}
      {view.showModes ? (
        <View accessibilityRole="radiogroup" style={[s.modes, { backgroundColor: dark ? '#23232f' : '#efeff6' }]}>
          {(Object.keys(MODES) as Mode[]).map((m) => (
            <Pressable key={m} accessibilityRole="radio" accessibilityState={{ checked: mode === m }} onPress={() => onMode(m)} style={[s.mode, mode === m && { backgroundColor: theme.surface }]}>
              <Text style={{ color: mode === m ? theme.text : theme.muted, fontWeight: '600', fontSize: 14 }}>{MODES[m]}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={s.actions}>
        {view.actions.map((a) => {
          const primary = a.primary || view.actions.length === 1;
          return (
            <Pressable key={a.id} accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => onAct(a.id)}
              style={({ pressed }) => [s.button, primary ? { backgroundColor: theme.action } : { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1 }, { opacity: busy ? 0.6 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
              <Text style={{ color: primary ? theme.actionText : theme.text, fontSize: 16, fontWeight: '700' }}>{a.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {status?.text || view.pending ? <Text accessibilityRole="alert" style={{ color: status?.tone === 'warning' ? TONE.warning[dark ? 'dark' : 'light'] : status?.tone === 'success' ? TONE.success[dark ? 'dark' : 'light'] : theme.muted, fontSize: 13.5 }}>{status?.text ?? 'Saved on this phone · syncing when online'}</Text> : null}
      <View style={[s.foot, { borderColor: theme.border }]}>
        {view.footer ? <Text style={{ color: theme.muted, fontSize: 13 }}>{view.footer}</Text> : null}
        {view.next && ['done', 'leave', 'holiday', 'off'].includes(view.state) ? <Text style={{ color: theme.muted, fontSize: 13 }}>{view.next}</Text> : null}
        {view.waiting ? <Pressable accessibilityRole="link" onPress={() => onOpen(view.waiting!.href)}><Text style={{ color: TONE.warning[dark ? 'dark' : 'light'], fontWeight: '600', fontSize: 13.5 }}>{view.waiting.label} →</Text></Pressable> : null}
      </View>
    </View>
  );
}

export function Suggestion({ decision, theme, onAct, onDismiss }: { decision: PresenceDecision; theme: Tokens; onAct: (id: ActionId) => void; onDismiss: () => void }) {
  return (
    <View accessibilityLiveRegion="polite" style={[s.banner, { backgroundColor: theme.surface, borderColor: theme.action }]}>
      <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>{decision.title}</Text>
      {decision.body ? <Text style={{ color: theme.muted, fontSize: 13.5 }}>{decision.body}</Text> : null}
      <View style={s.actions}>
        {(decision.actions ?? []).map((a, i) => (
          <Pressable key={a} accessibilityRole="button" onPress={() => onAct(a)} style={[s.button, i === 0 ? { backgroundColor: theme.action } : { borderColor: theme.border, borderWidth: 1 }]}>
            <Text style={{ color: i === 0 ? theme.actionText : theme.text, fontWeight: '700' }}>{a === 'check-in' ? 'Check in' : a === 'check-out' ? 'Check out' : a === 'break-start' ? 'Take a break' : 'I’m back'}</Text>
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" onPress={onDismiss} style={[s.button, { borderColor: theme.border, borderWidth: 1 }]}><Text style={{ color: theme.text, fontWeight: '600' }}>Not now</Text></Pressable>
      </View>
    </View>
  );
}

function Row({ label, hint, value, onChange, disabled, theme }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; theme: Tokens }) {
  return (
    <View style={s.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: disabled ? theme.muted : theme.text, fontSize: 15 }}>{label}</Text>
        {hint ? <Text style={{ color: theme.muted, fontSize: 12.5, lineHeight: 17 }}>{hint}</Text> : null}
      </View>
      <Switch accessibilityLabel={label} value={value} disabled={disabled} onValueChange={onChange} trackColor={{ true: theme.action, false: theme.border }} />
    </View>
  );
}

export function CompanionSettings({ prefs, payload, presence, theme, onPrefs }: { prefs: Prefs; payload: CompanionPayload | null; presence: PresenceStatus | null; theme: Tokens; onPrefs: (p: Partial<Prefs>) => void }) {
  const offices = payload?.presence.offices.length ?? 0, sites = payload?.presence.sites.length ?? 0;
  const hrAuto = !!payload?.presence.autoCheckIn;
  return (
    <View style={[s.card, { backgroundColor: theme.surface }]}>
      <Text accessibilityRole="header" style={[s.section, { color: theme.text }]}>At the office</Text>
      <Row theme={theme} label="Suggest check-in when I arrive" hint={`Your phone notices when you reach ${offices ? `${offices} office${offices === 1 ? '' : 's'}` : 'an office'}${sites ? ` or ${sites} confirmed shoot site${sites === 1 ? '' : 's'}` : ''} or join office Wi-Fi. Location is read only at that moment; Pulse keeps no location history.`} value={prefs.presence} onChange={(v) => onPrefs({ presence: v })} />
      {presence?.note && prefs.presence ? <Text style={{ color: theme.muted, fontSize: 12.5, lineHeight: 17 }}>{presence.note}</Text> : null}
      <Row theme={theme} label="Check me in automatically" hint={hrAuto ? 'Only at a registered office on a working day. You’ll get a notification each time; check-out is never automatic.' : 'Off for everyone until HR turns it on.'} value={prefs.autoCheckIn && hrAuto} disabled={!hrAuto || !prefs.presence} onChange={(v) => onPrefs({ autoCheckIn: v })} />
      <Text accessibilityRole="header" style={[s.section, { color: theme.text }]}>Reminders</Text>
      <Row theme={theme} label="When my shift starts" value={prefs.checkIn} onChange={(v) => onPrefs({ checkIn: v })} />
      <Row theme={theme} label={`Back from a break (after ${prefs.breakMinutes} min)`} value={prefs.breakBack} onChange={(v) => onPrefs({ breakBack: v })} />
      <Row theme={theme} label="When my shift ends" value={prefs.checkOut} onChange={(v) => onPrefs({ checkOut: v })} />
      <Row theme={theme} label="Show Pip" hint="Pip stays still when your phone asks for less motion." value={prefs.mascot} onChange={(v) => onPrefs({ mascot: v })} />
      {Platform.OS === 'android' ? <Text style={{ color: theme.muted, fontSize: 12.5, lineHeight: 17 }}>Tip: long-press your home screen → Widgets → Pulse for one-tap check-in.</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 22, padding: 18, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  greet: { fontSize: 13.5 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, marginTop: 4 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  timer: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  clock: { fontSize: 48, fontWeight: '700', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  modes: { flexDirection: 'row', padding: 3, borderRadius: 13, gap: 3 },
  mode: { flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  button: { flexGrow: 1, flexBasis: 120, minHeight: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  foot: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 6 },
  banner: { borderRadius: 18, padding: 16, gap: 10, borderWidth: 1.5 },
  section: { fontSize: 15, fontWeight: '700', marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
