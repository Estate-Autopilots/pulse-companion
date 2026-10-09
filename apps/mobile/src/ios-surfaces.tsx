import { HStack, VStack, Text, Image, Link } from '@expo/ui/swift-ui';
import { font, foregroundStyle, padding, frame, resizable, widgetURL, activityBackgroundTint } from '@expo/ui/swift-ui/modifiers';
import { createWidget, createLiveActivity, type WidgetEnvironment, type LiveActivityEnvironment } from 'expo-widgets';
import type { SurfaceState } from '../../../packages/companion/src/index.js';
export type DaySurface = SurfaceState & {entryId:string;showPip:boolean};

const Today = (p:DaySurface, env:WidgetEnvironment) => {
  'widget';
  const color=env.colorScheme==='dark'?'#eeeef6':'#191a2e';
  const muted=env.colorScheme==='dark'?'#a4a5b8':'#66687e';
  const accent=env.colorScheme==='dark'?'#a99cff':'#5b45d6';
  // Small: Pip, the state and the running timer; the whole widget opens Pulse (one tap target is all iOS allows).
  if(env.widgetFamily==='systemSmall')return <VStack alignment="leading" spacing={6} modifiers={[padding({all:4}),widgetURL('pulse://today')]}>
    {p.showPip?<Image assetName="Pip" modifiers={[resizable(),frame({width:40,height:40})]}/>:null}
    <Text modifiers={[font({size:14,weight:'bold'}),foregroundStyle(color)]}>{p.title}</Text>
    {p.timerSince!==null?<Text date={new Date(p.timerSince)} dateStyle="timer" modifiers={[font({size:22,weight:'semibold',design:'rounded'}),foregroundStyle(accent)]}/>:<Text modifiers={[font({size:12}),foregroundStyle(muted)]}>Tap to open Pulse</Text>}
  </VStack>;
  const large=env.widgetFamily==='systemLarge';
  return <VStack alignment="leading" spacing={large?14:8} modifiers={[padding({all:large?14:10}),widgetURL('pulse://today')]}>
    <HStack spacing={10}>
      {p.showPip?<Image assetName="Pip" modifiers={[resizable(),frame({width:large?56:42,height:large?56:42})]}/>:null}
      <VStack alignment="leading"><Text modifiers={[font({size:large?18:15,weight:'bold'}),foregroundStyle(color)]}>{p.title}</Text>
        {p.timerSince!==null?<Text date={new Date(p.timerSince)} dateStyle="timer" modifiers={[font({size:large?34:20,weight:'semibold',design:'rounded'}),foregroundStyle(accent)]}/>:null}
        {p.pending?<Text modifiers={[font({size:12}),foregroundStyle(muted)]}>Saved on phone · syncing</Text>:null}
      </VStack>
    </HStack>
    {large?<Text modifiers={[font({size:13}),foregroundStyle(muted)]}>{p.state==='break'?'On a break. Tap Back when you return.':p.state==='in'?'Working. Breaks and check-out are one tap away.':p.state==='done'?'Done for today. See you tomorrow.':'Check in with one tap when you start.'}</Text>:null}
    <HStack spacing={large?16:10}>{p.actions.map(a=><Link key={a.id} label={a.label} destination={`pulse://attendance?action=${a.id}&entry=${p.entryId}&state=${p.state}`} modifiers={[font({size:large?16:14,weight:'semibold'}),foregroundStyle(accent)]}/>)}</HStack>
  </VStack>;
};
const WorkingDay = (p:DaySurface, env:LiveActivityEnvironment) => {
  'widget';
  // The Island is always dark; give the banner the same explicit brand canvas.
  const color='#eeeef6';
  const accent=env.isLuminanceReduced?'#b8b8c8':'#a99cff';
  return {
    banner:<HStack spacing={14} modifiers={[padding({all:16}),activityBackgroundTint('#191a2e')]}>
      {p.showPip?<Image assetName="Pip" modifiers={[resizable(),frame({width:48,height:48})]}/>:null}
      <VStack alignment="leading" spacing={4}>
        <Text modifiers={[font({size:13,weight:'semibold'}),foregroundStyle('#a4a5b8')]}>{p.state==='break'?'On a break':'Working'}</Text>
        {p.timerSince!==null?<Text date={new Date(p.timerSince)} dateStyle="timer" modifiers={[font({size:30,weight:'semibold',design:'rounded'}),foregroundStyle(color)]}/>:<Text modifiers={[font({size:17,weight:'bold'}),foregroundStyle(color)]}>{p.title}</Text>}
        {p.pending?<Text modifiers={[font({size:12}),foregroundStyle('#a4a5b8')]}>Saved on phone · syncing</Text>:null}
        <HStack spacing={16}>{p.actions.map(a=><Link key={a.id} label={a.label} destination={`pulse://attendance?action=${a.id}&entry=${p.entryId}&state=${p.state}`} modifiers={[font({size:15,weight:'semibold'}),foregroundStyle(accent)]}/>)}</HStack>
      </VStack>
    </HStack>,
    compactLeading:p.showPip?<Image assetName="PipIsland" modifiers={[resizable(),frame({width:26,height:26})]}/>:<Text>Pulse</Text>,
    compactTrailing:p.timerSince!==null?<Text date={new Date(p.timerSince)} dateStyle="timer"/>:<Text>Pulse</Text>,
    minimal:<Text>{p.state==='break'?'Ⅱ':'●'}</Text>,
    expandedLeading:<Text modifiers={[foregroundStyle(color)]}>{p.title}</Text>,
    expandedTrailing:p.timerSince!==null?<Text date={new Date(p.timerSince)} dateStyle="timer"/>:<Text>Pulse</Text>,
    expandedBottom:<HStack spacing={16}>{p.actions.map(a=><Link key={a.id} label={a.label} destination={`pulse://attendance?action=${a.id}&entry=${p.entryId}&state=${p.state}`}/>)}</HStack>,
  };
};
export const TodayWidget=createWidget('PulseTodayIOS',Today);
export const DayActivity=createLiveActivity('PulseWorkingDay',WorkingDay);
