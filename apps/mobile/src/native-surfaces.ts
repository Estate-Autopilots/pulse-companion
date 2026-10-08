import {Platform,AppState} from 'react-native';
import notifee,{AndroidImportance,EventType,type Event} from '@notifee/react-native';
import {surfaceState,type CompanionPayload,type Prefs,type ActionId} from '../../../packages/companion/src/index.js';
import {init,signedIn} from './client';
import {act,loadDay,readPrefs} from './companion';
const RIBBON='pulse-working-day';
let work:Promise<unknown>=Promise.resolve();
/** Serialized updates prevent an older refresh resurrecting a ribbon/activity after sign-out. */
export function refreshNativeSurfaces(payload:CompanionPayload|null,prefs?:Prefs){
 const task=work.catch(()=>{}).then(()=>update(payload,prefs));work=task;return task;
}
async function update(payload:CompanionPayload|null,prefs?:Prefs){
 const p=prefs??await readPrefs();const state=surfaceState(payload);
 if(Platform.OS==='ios'){
  const {TodayWidget,DayActivity}=await import('./ios-surfaces');
  const props={...state,entryId:payload?.entry?.id??'',showPip:p.mascot};
  TodayWidget.updateSnapshot(props);
  const instances=DayActivity.getInstances();
  if(!state.active){for(const instance of instances)await instance.end('immediate',props);return;}
  if(instances.length){await instances[0].update(props);for(const duplicate of instances.slice(1))await duplicate.end('immediate');}
  else if(AppState.currentState==='active')DayActivity.start(props,'pulse://today',new Date(Date.now()+12*3600000));
  return;
 }
 if(Platform.OS!=='android')return;
 if(!state.active){await notifee.cancelNotification(RIBBON);return;}
 const channelId=await notifee.createChannel({id:'working-day',name:'Working day',importance:AndroidImportance.LOW});
 await notifee.displayNotification({id:RIBBON,title:state.title,body:state.pending?'Saved on phone · syncing':state.state==='break'?'Break timer':'Working time',
   data:{entryId:payload?.entry?.id??'',state:state.state,demo:payload?.demo?'true':'false'},
   android:{channelId,smallIcon:'ic_launcher',...(p.mascot?{largeIcon:require('../assets/adaptive-icon.png')}:{}),ongoing:true,autoCancel:false,onlyAlertOnce:true,
     showChronometer:true,chronometerDirection:'up',timestamp:state.timerSince??Date.now(),pressAction:{id:'default',launchActivity:'default'},
     actions:state.actions.map(a=>({title:a.id==='break-start'?'Break':a.id==='break-end'?'Back':a.label,pressAction:{id:a.id,launchActivity:'default'}}))}});
}
/** One notification event is handled in foreground or headless mode, with stale-state and identity checks. */
export async function handleRibbonEvent({type,detail}:Event){
 if(type!==EventType.ACTION_PRESS||detail.notification?.id!==RIBBON||detail.notification.data?.demo==='true')return;
 const action=detail.pressAction?.id as ActionId;
 if(!['break-start','break-end','check-out'].includes(action))return;
 if(!signedIn()&&!(await init()))return;
 const current=(await loadDay())?.payload;
 if(!current||current.entry?.id!==detail.notification.data?.entryId||current.state!==detail.notification.data?.state)return;
 await act(action,{trigger:'notification'});
 await refreshNativeSurfaces((await loadDay())?.payload??null);
}
