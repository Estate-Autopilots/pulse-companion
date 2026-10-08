import { HStack, VStack, Text, Image, Link } from '@expo/ui/swift-ui';
import { font, foregroundStyle, padding, frame, resizable, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, createLiveActivity, type WidgetEnvironment, type LiveActivityEnvironment } from 'expo-widgets';
import type { SurfaceState } from '../../../packages/companion/src/index.js';
export type DaySurface = SurfaceState & {entryId:string;showPip:boolean};

const Today = (p:DaySurface, env:WidgetEnvironment) => {
  'widget';
  const color=env.colorScheme==='dark'?'#eeeef6':'#191a2e';
  const accent=env.colorScheme==='dark'?'#a99cff':'#5b45d6';
  return <VStack spacing={8} modifiers={[padding({all:10}),widgetURL('pulse://today')]}>
    <HStack spacing={8}>
      {p.showPip?<Image assetName="Pip" modifiers={[resizable(),frame({width:42,height:42})]}/>:null}
      <VStack alignment="leading"><Text modifiers={[font({size:15,weight:'bold'}),foregroundStyle(color)]}>{p.title}</Text>
        {p.timerSince!==null?<Text date={new Date(p.timerSince)} dateStyle="timer" modifiers={[font({size:20,design:'monospaced'}),foregroundStyle(accent)]}/>:null}
        {p.pending?<Text>Saved on phone · syncing</Text>:null}
      </VStack>
    </HStack>
    <HStack spacing={10}>{p.actions.map(a=><Link key={a.id} label={a.label} destination={`pulse://attendance?action=${a.id}&entry=${p.entryId}&state=${p.state}`} modifiers={[foregroundStyle(accent)]}/>)}</HStack>
  </VStack>;
};
const WorkingDay = (p:DaySurface, env:LiveActivityEnvironment) => {
  'widget';
  const color=env.colorScheme==='dark'?'#eeeef6':'#191a2e';
  const accent=env.isLuminanceReduced?'#999999':env.colorScheme==='dark'?'#a99cff':'#5b45d6';
  return {
    banner:<HStack spacing={12} modifiers={[padding({all:14})]}>
      {p.showPip?<Image assetName="Pip" modifiers={[resizable(),frame({width:48,height:48})]}/>:null}
      <VStack alignment="leading"><Text modifiers={[font({size:17,weight:'bold'}),foregroundStyle(color)]}>{p.title}</Text>
        {p.timerSince!==null?<Text date={new Date(p.timerSince)} dateStyle="timer" modifiers={[font({size:22,design:'monospaced'}),foregroundStyle(accent)]}/>:null}
        {p.pending?<Text>Saved on phone · syncing</Text>:null}
        <HStack spacing={12}>{p.actions.map(a=><Link key={a.id} label={a.label} destination={`pulse://attendance?action=${a.id}&entry=${p.entryId}&state=${p.state}`} modifiers={[foregroundStyle(accent)]}/>)}</HStack>
      </VStack>
    </HStack>,
    compactLeading:p.showPip?<Image assetName="Pip" modifiers={[resizable(),frame({width:26,height:26})]}/>:<Text>Pulse</Text>,
    compactTrailing:p.timerSince!==null?<Text date={new Date(p.timerSince)} dateStyle="timer"/>:<Text>Pulse</Text>,
    minimal:<Text>{p.state==='break'?'Ⅱ':'●'}</Text>,
    expandedLeading:<Text>{p.title}</Text>,
    expandedTrailing:p.timerSince!==null?<Text date={new Date(p.timerSince)} dateStyle="timer"/>:<Text>Pulse</Text>,
    expandedBottom:<HStack spacing={16}>{p.actions.map(a=><Link key={a.id} label={a.label} destination={`pulse://attendance?action=${a.id}&entry=${p.entryId}&state=${p.state}`}/>)}</HStack>,
  };
};
export const TodayWidget=createWidget('PulseTodayIOS',Today);
export const DayActivity=createLiveActivity('PulseWorkingDay',WorkingDay);
