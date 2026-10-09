import test from 'node:test';import assert from 'node:assert/strict';
import {createFeed,conversationTarget} from '../src/communications.js';
test('overlapping polls notify each immutable event once and resume after restart',async()=>{
 let saved=null,pings=0;const state={cursor:'2026-10-08T20:00:00Z',counts:{total:1},rows:[{id:'one',pingAllowed:true}]};
 const options={call:async()=>state,load:()=>saved,save:(_id,s)=>{saved=s;},onPing:()=>{pings++;}};
 const feed=createFeed(options);feed.reset('laptop');await feed.poll();await feed.poll();
 const restarted=createFeed(options);restarted.reset('laptop');await restarted.poll();assert.equal(pings,1);
});
test('account switch during a poll cannot show the previous persons ping',async()=>{
 let answer,pings=0,snapshots=0;
 const feed=createFeed({call:()=>new Promise(resolve=>{answer=resolve;}),onPing:()=>pings++,onSnapshot:()=>snapshots++});
 feed.reset('old-person');const pending=feed.poll();feed.reset('new-person');answer({rows:[{id:'old',pingAllowed:true}],cursor:'new'});await pending;
 assert.equal(pings,0);assert.equal(snapshots,0);
});
test('account switch while the OS adapter is awaiting permission cannot save an old badge',async()=>{
 let release,snapshots=0,saves=0;
 const feed=createFeed({call:async()=>({rows:[{id:'one',pingAllowed:true}],cursor:'old'}),onPing:()=>new Promise(resolve=>{release=resolve;}),onSnapshot:()=>snapshots++,save:()=>saves++});
 feed.reset('old');const pending=feed.poll();await new Promise(r=>setTimeout(r,0));feed.reset('new');release();await pending;
 assert.equal(snapshots,0);assert.equal(saves,0);
});
test('quiet hours suppression still updates badge and a cursor page is resumed',async()=>{
 const paths=[],counts=[];let n=0;
 const feed=createFeed({call:async path=>{paths.push(path);return {rows:[{id:String(++n),pingAllowed:false}],cursor:'2026-10-08T20:00:00Z',page:n===1?'page-two':null,counts:{total:7}};},onPing:()=>assert.fail('suppressed event'),onSnapshot:s=>counts.push(s.counts.total)});
 feed.reset('laptop');await feed.poll();await feed.poll();assert.match(paths[1],/page=page-two/);assert.deepEqual(counts,[7,7]);
});
test('click target accepts only conversation deep links',()=>{
 const id='11111111-1111-4111-8111-111111111111';assert.equal(conversationTarget(`/chats?channel=${id}`),id);
 assert.equal(conversationTarget('/me'),null);assert.equal(conversationTarget('/chats?channel=bad'),null);
});
