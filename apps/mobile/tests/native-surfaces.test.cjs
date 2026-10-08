const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');const ts=require('typescript');
const core=require(path.resolve(__dirname,'../../../packages/companion/src/index.js'));
function fixture(os='android'){
 const displayed=[],cancelled=[],snapshots=[],started=[],ended=[],updated=[],actions=[];
 let payload=core.demoPayload('in',Date.now());payload.demo=false;let instances=[];
 const module={exports:{}};
 const instance={update:async p=>updated.push(p),end:async(...p)=>ended.push(p)};
 const stubs={'react-native':{Platform:{OS:os},AppState:{currentState:'active'}},'@notifee/react-native':{__esModule:true,EventType:{ACTION_PRESS:1},AndroidImportance:{LOW:2},default:{cancelNotification:async id=>cancelled.push(id),createChannel:async()=> 'working-day',displayNotification:async n=>displayed.push(n)}},'../../../packages/companion/src/index.js':core,'./client':{init:async()=>true,signedIn:()=>true},'./companion':{readPrefs:async()=>({mascot:true}),loadDay:async()=>({payload}),act:async a=>actions.push(a)},'./ios-surfaces':{TodayWidget:{updateSnapshot:p=>snapshots.push(p)},DayActivity:{getInstances:()=>instances,start:p=>started.push(p)}},'../assets/adaptive-icon.png':1};
 const source=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../src/native-surfaces.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(source,{module,exports:module.exports,require:n=>{if(!(n in stubs))throw Error(n);return stubs[n];},Date,Promise,Error,console});
 return {m:module.exports,displayed,cancelled,snapshots,started,ended,updated,actions,instance,setInstances:v=>instances=v,setPayload:v=>payload=v,payload:()=>payload};
}
test('Android ribbon changes actions on break and disappears after check-out',async()=>{
 const f=fixture();await f.m.refreshNativeSurfaces(f.payload());
 assert.equal(f.displayed[0].android.ongoing,true);assert.equal(f.displayed[0].android.showChronometer,true);
 assert.deepEqual(Array.from(f.displayed[0].android.actions,a=>a.pressAction.id),['break-start','check-out']);
 await f.m.refreshNativeSurfaces(core.demoPayload('break'));
 assert.deepEqual(Array.from(f.displayed[1].android.actions,a=>a.pressAction.id),['break-end','check-out']);
 await f.m.refreshNativeSurfaces(core.demoPayload('done'));assert.equal(f.cancelled.length,1);
});
test('serialized refresh followed by sign-out leaves no working-day ribbon',async()=>{
 const f=fixture();await Promise.all([f.m.refreshNativeSurfaces(f.payload()),f.m.refreshNativeSurfaces(null)]);
 assert.equal(f.displayed.length,1);assert.deepEqual(f.cancelled,['pulse-working-day']);
});
test('notification actions reject stale entries, stale states, and demo attendance',async()=>{
 const f=fixture();const event=(data)=>({type:1,detail:{notification:{id:'pulse-working-day',data},pressAction:{id:'break-start'}}});
 await f.m.handleRibbonEvent(event({entryId:'former-person-entry',state:'in'}));
 await f.m.handleRibbonEvent(event({entryId:f.payload().entry.id,state:'break'}));
 await f.m.handleRibbonEvent(event({entryId:f.payload().entry.id,state:'in',demo:'true'}));
 assert.deepEqual(f.actions,[]);
 await f.m.handleRibbonEvent(event({entryId:f.payload().entry.id,state:'in'}));assert.deepEqual(f.actions,['break-start']);
});
test('iOS recovers the current Live Activity and ends duplicates, then clears after sign-out',async()=>{
 const f=fixture('ios');f.setInstances([f.instance,f.instance]);await f.m.refreshNativeSurfaces(f.payload());
 assert.equal(f.started.length,0);assert.equal(f.updated.length,1);assert.equal(f.ended.length,1);
 assert.equal(f.snapshots[0].active,true);
 await f.m.refreshNativeSurfaces(null);assert.equal(f.ended.length,3);assert.equal(f.snapshots[1].title,'Open Pulse to sign in');
});
test('iOS starts a Live Activity only during the working day',async()=>{
 const f=fixture('ios');await f.m.refreshNativeSurfaces(core.demoPayload('out'));assert.equal(f.started.length,0);
 await f.m.refreshNativeSurfaces(f.payload());assert.equal(f.started.length,1);assert.equal(f.started[0].active,true);
});
test('Pip asset belongs to the widget extension when Expo supplies no Resources phase',()=>{
 const configPlugins=path.dirname(require.resolve('@expo/config-plugins',{paths:[path.dirname(require.resolve('expo'))]}));
 const xcode=require(require.resolve('xcode',{paths:[configPlugins]}));
 const project=xcode.project('fixture.pbxproj');
 project.hash={project:{objects:{PBXNativeTarget:{M:{name:'Pulse',buildPhases:[{value:'R',comment:'Resources'}]},W:{name:'ExpoWidgetsTarget',buildPhases:[]}},PBXResourcesBuildPhase:{R:{isa:'PBXResourcesBuildPhase',files:[]},R_comment:'Resources'},PBXGroup:{G:{name:'ExpoWidgetsTarget',path:'ExpoWidgetsTarget',children:[]},G_comment:'ExpoWidgetsTarget'},PBXBuildFile:{},PBXFileReference:{}}}};
 const plugin={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../plugins/with-pip-widget.cjs'),'utf8'),{module:plugin,require:n=>n==='expo/config-plugins'?{withXcodeProject:(c,f)=>f(c)}:require(n)});
 const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'pulse-widget-resources-'));
 try{
  const config={modResults:project,modRequest:{platformProjectRoot:dir,projectRoot:path.resolve(__dirname,'..')}};
  plugin.exports(config);
  assert.equal(project.pbxResourcesBuildPhaseObj('M').files.length,0,'Never put extension artwork in the main app');
  assert.equal(project.pbxResourcesBuildPhaseObj('W').files.length,1);
  for(const [name,points] of [['Pip',48],['PipIsland',26]]){
   const imageset=path.join(dir,`ExpoWidgetsTarget/Pip.xcassets/${name}.imageset`);
   const {images}=JSON.parse(fs.readFileSync(path.join(imageset,'Contents.json'),'utf8'));
   assert.equal(images.length,3);
   for(const image of images){
    const png=fs.readFileSync(path.join(imageset,image.filename));
    const expected=points*parseInt(image.scale,10);
    assert.equal(png.readUInt32BE(16),expected,'WidgetKit image must have its actual presentation pixel size');
    assert.equal(png.readUInt32BE(20),expected);
   }
  }
  plugin.exports(config);assert.equal(project.pbxResourcesBuildPhaseObj('W').files.length,1,'Prebuild remains idempotent');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
