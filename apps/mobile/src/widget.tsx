// Android home-screen widget: Pip, today's status and one-tap Check in / Break / Check out. Taps run in the
// background through the same device credential and offline queue as the app. (iPhone widgets need the company's
// Apple signing for an app group; see the release notes.)
import React from 'react';
import { FlexWidget, SvgWidget, TextWidget, requestWidgetUpdate, type WidgetInfo, type WidgetTaskHandlerProps } from 'react-native-android-widget';
import { deriveView, surfaceState, friendlyClock, pipStaticSvg, wallMinutes, type ActionId, type CompanionPayload } from '../../../packages/companion/src/index.js';
import { init, signedIn } from './client';
import { act, loadDay } from './companion';

export const WIDGET = 'PulseToday';
const ACTIONS = ['check-in', 'break-start', 'break-end', 'check-out'];
type Theme = { bg: `#${string}`; text: `#${string}`; muted: `#${string}`; button: `#${string}`; buttonText: `#${string}`; primary: `#${string}`; primaryText: `#${string}` };
const LIGHT: Theme = { bg: '#ffffff', text: '#191a2e', muted: '#66687e', button: '#efeff6', buttonText: '#191a2e', primary: '#5b45d6', primaryText: '#ffffff' };
const DARK: Theme = { bg: '#1a1a24', text: '#eeeef6', muted: '#a7a8bb', button: '#23232f', buttonText: '#eeeef6', primary: '#a99cff', primaryText: '#17123a' };

/** Small (2×2), medium (4×2) or large (4×3 and up), from the widget's size on the home screen. */
export type Size = 'small' | 'medium' | 'large';
export const sizeOf = (info?: Pick<WidgetInfo, 'width' | 'height'> | null): Size => !info ? 'medium' : info.width < 200 ? 'small' : info.height >= 220 ? 'large' : 'medium';
const clockOf = (iso: string, offset: number) => { const m = wallMinutes(Date.parse(iso), offset); return friendlyClock(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`); };

function PulseWidget({ payload, theme, note, size = 'medium' }: { payload: CompanionPayload | null; theme: Theme; note?: string; size?: Size }) {
  const dark = theme === DARK;
  if (!payload) return (
    <FlexWidget clickAction="OPEN_APP" style={{ height: 'match_parent', width: 'match_parent', backgroundColor: theme.bg, borderRadius: 22, padding: 14, flexDirection: 'row', alignItems: 'center', flexGap: 12 }}>
      <SvgWidget svg={pipStaticSvg({ mood: 'idle', theme: dark ? 'dark' : 'light', size: 64 })} style={{ height: 64, width: 64 }} />
      <FlexWidget style={{ flexDirection: 'column', flex: 1 }}>
        <TextWidget text="Pulse" style={{ fontSize: 17, fontWeight: '700', color: theme.text }} />
        <TextWidget text={note ?? 'Open Pulse to sign in'} style={{ fontSize: 13, color: theme.muted }} maxLines={2} />
      </FlexWidget>
    </FlexWidget>
  );
  const view = deriveView(payload, Date.now());
  const since = payload.entry && !payload.entry.out ? (payload.state === 'break' && payload.entry.breakStartedAt ? `on a break since ${clockOf(payload.entry.breakStartedAt, payload.utcOffsetMinutes)}` : `in since ${clockOf(payload.entry.in, payload.utcOffsetMinutes)}`) : view.subtitle;
  const actions = surfaceState(payload).actions;
  if (size === 'small') {
    const primary = actions[0];
    return (
      <FlexWidget style={{ height: 'match_parent', width: 'match_parent', backgroundColor: theme.bg, borderRadius: 22, padding: 12, flexDirection: 'column', justifyContent: 'space-between' }}>
        <FlexWidget clickAction="OPEN_APP" style={{ flexDirection: 'column', width: 'match_parent' }}>
          <SvgWidget svg={pipStaticSvg({ mood: view.mood, theme: dark ? 'dark' : 'light', size: 40 })} style={{ height: 40, width: 40 }} />
          <TextWidget text={view.title} style={{ fontSize: 14, fontWeight: '700', color: theme.text }} maxLines={1} truncate="END" />
          <TextWidget text={note ?? since ?? ''} style={{ fontSize: 11.5, color: theme.muted }} maxLines={1} truncate="END" />
        </FlexWidget>
        {primary ? <FlexWidget clickAction={primary.id} style={{ width: 'match_parent', height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.primary }}>
          <TextWidget text={primary.label} style={{ fontSize: 13, fontWeight: '600', color: theme.primaryText }} />
        </FlexWidget> : null}
      </FlexWidget>
    );
  }
  const shift = payload.shift ? `Shift ${friendlyClock(payload.shift.start)} – ${friendlyClock(payload.shift.end)}` : '';
  return (
    <FlexWidget style={{ height: 'match_parent', width: 'match_parent', backgroundColor: theme.bg, borderRadius: 22, padding: 14, flexDirection: 'column', justifyContent: 'space-between' }}>
      <FlexWidget clickAction="OPEN_APP" style={{ flexDirection: 'row', alignItems: 'center', flexGap: 10, width: 'match_parent' }}>
        <SvgWidget svg={pipStaticSvg({ mood: view.mood, theme: dark ? 'dark' : 'light', size: 52 })} style={{ height: 52, width: 52 }} />
        <FlexWidget style={{ flexDirection: 'column', flex: 1 }}>
          <TextWidget text={view.title} style={{ fontSize: 16, fontWeight: '700', color: theme.text }} maxLines={1} truncate="END" />
          <TextWidget text={note ?? since} style={{ fontSize: 12.5, color: theme.muted }} maxLines={1} truncate="END" />
        </FlexWidget>
      </FlexWidget>
      {size === 'large' ? <FlexWidget clickAction="OPEN_APP" style={{ flexDirection: 'column', width: 'match_parent', flexGap: 4 }}>
        <TextWidget text={view.chip?.text ?? ''} style={{ fontSize: 13, fontWeight: '600', color: theme.primary }} maxLines={1} truncate="END" />
        {shift ? <TextWidget text={shift} style={{ fontSize: 12.5, color: theme.muted }} maxLines={1} truncate="END" /> : null}
        {view.footer ? <TextWidget text={view.footer} style={{ fontSize: 12.5, color: theme.muted }} maxLines={2} truncate="END" /> : null}
      </FlexWidget> : null}
      <FlexWidget style={{ flexDirection: 'row', flexGap: 8, width: 'match_parent' }}>
        {actions.map((a) => (
          <FlexWidget key={a.id} clickAction={a.id} style={{ flex: 1, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: view.actions.length === 1 ? theme.primary : theme.button }}>
            <TextWidget text={a.label} style={{ fontSize: 14, fontWeight: '600', color: view.actions.length === 1 ? theme.primaryText : theme.buttonText }} />
          </FlexWidget>
        ))}
      </FlexWidget>
    </FlexWidget>
  );
}

async function day(): Promise<CompanionPayload | null> {
  if (!signedIn() && !(await init().catch(() => false))) return null;
  return (await loadDay().catch(() => null))?.payload ?? null;
}
const render = (payload: CompanionPayload | null, note?: string, size: Size = 'medium') => ({ light: <PulseWidget payload={payload} theme={LIGHT} note={note} size={size} />, dark: <PulseWidget payload={payload} theme={DARK} note={note} size={size} /> });

export async function widgetTaskHandler({ widgetInfo, widgetAction, clickAction, renderWidget }: WidgetTaskHandlerProps) {
  const size = sizeOf(widgetInfo);
  if (widgetAction === 'WIDGET_DELETED') return;
  if (widgetAction === 'WIDGET_CLICK' && clickAction && ACTIONS.includes(clickAction)) {
    let note: string | undefined;
    try {
      if (!signedIn() && !(await init())) { renderWidget(render(null, undefined, size)); return; }
      const r = await act(clickAction as ActionId, { trigger: 'widget' }); note = r.queued ? 'Saved on this phone · will sync' : undefined;
    }
    catch (e) { note = (e as Error).message; }
    renderWidget(render(await day(), note, size));
    return;
  }
  renderWidget(render(await day(), undefined, size));
}

/** After a tap in the app, keep any widget on the home screen in step. */
export function refreshWidget(payload: CompanionPayload | null) {
  void requestWidgetUpdate({ widgetName: WIDGET, renderWidget: (info) => render(payload, undefined, sizeOf(info)) }).catch(() => {});
}
