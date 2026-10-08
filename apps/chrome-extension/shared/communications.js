// Inbox and conversations reuse Pulse's member-scoped routes. No second chat storage.
export function createFeed({call,load=()=>null,save=()=>{},acknowledge=async()=>{},onSnapshot=()=>{},onPing=()=>{},onError=()=>{}}){
 let session=null,cursor=null,page=null,busy=false,epoch=0,seen=new Set();
 return {
  reset(identity){if(session===identity)return;session=identity;epoch++;const old=load(identity);cursor=old?.cursor??null;page=old?.page??null;seen=new Set(old?.seen??[]);},
  async poll(){
   if(!session||busy)return;busy=true;const generation=epoch;
   try{
    const state=await call(`companion/updates${cursor?`?since=${encodeURIComponent(cursor)}`:''}${page?`&page=${encodeURIComponent(page)}`:''}`);
    if(generation!==epoch)return;
    for(const row of state.rows){if(generation!==epoch)return;if(seen.has(row.id))continue;seen.add(row.id);if(row.pingAllowed)await onPing(row);}
    if(generation!==epoch)return;
    await acknowledge(state.rows);if(generation!==epoch)return;
    cursor=state.cursor;page=state.page;seen=new Set([...seen].slice(-2000));save(session,{cursor,page,seen:[...seen]});onSnapshot(state);
   }catch(e){if(generation===epoch)onError(e);}finally{busy=false;}
  },
 };
}
const element=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const button=(text,action,cls='pc-link')=>{const node=element('button',text,cls);node.type='button';node.addEventListener('click',action);return node;};
const uuid=/^[0-9a-f-]{36}$/;
export function conversationTarget(href){
 try{const u=new URL(href,'https://pulse.invalid');const id=u.searchParams.get('channel');return u.pathname==='/chats'&&uuid.test(id??'')?id:null;}catch{return null;}
}
export function mountCommunications(root,{call,onOpen,onSwitch,onResize=()=>{},onEnablePings,isVisible=()=>true,platform='desktop'}){
 const shell=element('section',undefined,'pc-communications');
 const identity=element('div',undefined,'pc-identity'),name=element('strong','Pulse');
 identity.append(name,button('Not you? Switch account',onSwitch));
 const tabs=element('nav',undefined,'pc-tabs');tabs.setAttribute('aria-label','Companion sections');
 const today=element('div'),content=element('div',undefined,'pc-comms-content'),notice=element('p',undefined,'pc-ping-status');notice.setAttribute('role','status');
 const prefs=element('div',undefined,'pc-ping-prefs');prefs.hidden=true;
 const controls=element('div',undefined,'pc-ping-controls');
 controls.append(button('Notification preferences',()=>{prefs.hidden=!prefs.hidden;void loadPrefs();onResize();}));
 if(onEnablePings)controls.append(button(platform==='web'?'Enable browser pings':'Enable laptop pings',onEnablePings));
 shell.append(identity,tabs,today,content,controls,prefs,notice);
 let tab='today',selected=null,selectedHref=null,channels=[],inbox=[],settings=null,person=null,counts={},loading=false,disposed=false,error=null;
 let conversation=null,messagesHost=null,reply=null,replyStatus=null,replyBusy=false,replyKey=null,replyText=null;
 const tabButtons={};
 for(const [key,title] of [['today','Today'],['inbox','Inbox'],['chats','Chats']]){
  const b=button(title,()=>{tab=key;selected=null;selectedHref=null;attach();draw();void refresh();},'pc-tab');tabButtons[key]=b;tabs.append(b);
 }
 function attach(){if(root.firstElementChild!==shell)root.replaceChildren(shell);today.hidden=tab!=='today';content.hidden=tab==='today';for(const [key,b] of Object.entries(tabButtons)){b.setAttribute('aria-current',String(key===tab));}onResize();}
 function status(text){error=text;notice.textContent=text||'Only groups you belong to can ping you. Keep Pulse running; check your OS notification settings if a ping is missing.';onResize();}
 function showCounts(){tabButtons.inbox.textContent=`Inbox${counts.inbox?` (${counts.inbox})`:''}`;tabButtons.chats.textContent=`Chats${counts.chats?` (${counts.chats})`:''}`;}
 function draw(){
  attach();showCounts();if(tab==='today')return;
  if(tab==='chats'&&selected){if(conversation?.dataset.channel!==selected)drawConversation();return;}
  conversation=null;content.replaceChildren();
  if(tab==='inbox'){
   if(!inbox.length)content.append(element('p','Your inbox is clear.','pc-muted'));
   for(const row of inbox){
    const item=element('div',undefined,'pc-inbox-item');
    const open=button(`${row.readAt?'':'● '}${row.title}`,()=>void openItem(row),'pc-conversation');
    item.append(open,element('time',new Date(row.at).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}),'pc-muted'));
    if(!row.readAt)item.append(button('Mark read',()=>void read(row)));
    content.append(item);
   }
  }else{
   if(!channels.length)content.append(element('p','No conversations yet. Only groups you belong to appear here.','pc-muted'));
   for(const ch of channels){const b=button(`${ch.name}${ch.unread?` · ${ch.unread} unread`:''}`,()=>{selected=ch.id;selectedHref=null;drawConversation();void loadMessages();},'pc-conversation');content.append(b);}
  }
  onResize();
 }
 async function read(row){try{await call('companion/read',{id:row.id});row.readAt=new Date().toISOString();draw();}catch(e){status(e.message);}}
 async function openItem(row){await read(row);const id=conversationTarget(row.href);if(id&&!row.href.includes('thread=')){tab='chats';selected=id;selectedHref=row.href;draw();await loadMessages();}else onOpen(row.href);}
 function drawConversation(){
  conversation=element('section');conversation.dataset.channel=selected;
  const ch=channels.find(c=>c.id===selected);
  conversation.append(button('‹ Conversations',()=>{selected=null;draw();}),element('h3',ch?.name??'Conversation'));
  messagesHost=element('div',undefined,'pc-messages');messagesHost.setAttribute('role','log');messagesHost.setAttribute('aria-label','Recent messages');
  conversation.append(messagesHost);
  const form=element('form',undefined,'pc-quick-reply');reply=element('textarea');reply.maxLength=12000;reply.rows=2;reply.placeholder='Quick reply';reply.setAttribute('aria-label','Quick reply');
  const send=element('button','Send','pc-btn');send.type='submit';replyStatus=element('p',undefined,'pc-muted');replyStatus.setAttribute('role','status');
  form.append(reply,send,replyStatus);
  form.addEventListener('submit',event=>{event.preventDefault();void sendReply(send);});
  conversation.append(form,button('Open in Pulse for files and threads ↗',()=>onOpen(selectedHref??`/chats?channel=${selected}`)));
  content.replaceChildren(conversation);attach();onResize();
 }
 async function loadMessages(){
  const id=selected;if(!id||replyBusy)return;
  try{
   const result=await call(`chats/${id}/messages`);if(disposed||id!==selected||!messagesHost||!isVisible())return;
   messagesHost.replaceChildren();for(const m of result.messages.slice(-20)){
    const item=element('article',undefined,'pc-message');item.append(element('strong',m.name),element('p',m.removed?'Message removed':m.body));
    if(m.attachments?.length||m.replies)item.append(element('small',`${m.attachments?.length??0} files · ${m.replies??0} replies · open in Pulse`));messagesHost.append(item);
   }
   if(!result.messages.length)messagesHost.append(element('p','Start the conversation.','pc-muted'));
   const last=result.messages.at(-1);if(last)await call(`chats/${id}/read`,{through:last.createdAt});
   messagesHost.scrollTop=messagesHost.scrollHeight;onResize();
  }catch(e){status(e.status===403||e.status===404?'You are not a member of this conversation with this account.':e.message);}
 }
 async function sendReply(send){
  if(replyBusy||!reply.value.trim()||!selected)return;
  const id=selected,text=reply.value.trim();replyBusy=true;send.disabled=true;reply.disabled=true;if(replyText!==text){replyKey=null;replyText=text;}replyKey??=crypto.randomUUID();
  try{await call(`chats/${id}/messages`,{body:text,clientId:replyKey});reply.value='';replyKey=null;replyStatus.textContent='Sent';}
  catch(e){replyStatus.textContent=e.message||'Reply could not be sent. Your draft is kept.';}
  finally{replyBusy=false;send.disabled=false;reply.disabled=false;await loadMessages();}
 }
 async function loadPrefs(){
  try{const result=await call('companion/notification-settings');settings=result.settings;drawPrefs();}catch(e){status(e.message);}
 }
 function drawPrefs(){
  prefs.replaceChildren();if(!settings)return;
  const save=async()=>{try{settings=(await call('companion/notification-settings',settings)).settings;status(settings.dnd?'Do not disturb is on. Unread counts still update.':'Notification preferences saved.');}catch(e){status(e.message);}};
  for(const [key,label] of [['dnd','Do not disturb'],['quiet','Quiet hours']]){const row=element('label',label);const input=element('input');input.type='checkbox';input.checked=settings[key];input.addEventListener('change',()=>{settings[key]=input.checked;void save();});row.prepend(input);prefs.append(row);}
  for(const [key,label] of [['start','From'],['end','Until'],['timezone','Time zone']]){const row=element('label',label);const input=element('input');input.type=key==='timezone'?'text':'time';input.value=settings[key];input.addEventListener('change',()=>{settings[key]=input.value;void save();});row.append(input);prefs.append(row);}
  for(const [key,label] of Object.entries({chat:'Group and direct messages',mention:'Mentions',reply:'Thread replies',approval:'Approvals waiting',decision:'Request decisions',policy:'Policy updates',holiday:'Holidays',payroll:'Payroll processed',task:'Task assignments',update:'Other updates'})){
   const row=element('label',label);const input=element('input');input.type='checkbox';input.checked=settings.types[key]!==false;input.addEventListener('change',()=>{settings.types[key]=input.checked;void save();});row.prepend(input);prefs.append(row);
  }
  prefs.append(element('p','Lock screen previews contain no message text.','pc-muted'));onResize();
 }
 async function refresh(){
  if(loading||disposed||!isVisible())return;loading=true;const before=JSON.stringify(tab==='inbox'?inbox:channels);
  try{
   if(tab==='inbox')inbox=(await call('companion/inbox')).rows;
   if(tab==='chats'){channels=(await call('chats')).channels.filter(c=>!c.moderationOnly).sort((a,b)=>Date.parse(b.lastAt??0)-Date.parse(a.lastAt??0));if(selected)await loadMessages();}
   if(!disposed&&before!==JSON.stringify(tab==='inbox'?inbox:channels))draw();
  }catch(e){status(e.message);}finally{loading=false;}
 }
 status(null);
 return {todayHost:today,attach,refresh,status,
  snapshot(state){if(person&&state.person?.id!==person.id){inbox=[];channels=[];selected=null;selectedHref=null;conversation=null;tab='today';}person=state.person;name.textContent=person?.name??'Pulse';counts=state.counts??{};settings=state.settings??settings;showCounts();if(state.suppression)status(state.suppression);else status(null);void refresh();},
  showInbox(){tab='inbox';selected=null;selectedHref=null;draw();void refresh();},
  open(id,href){selectedHref=href??null;tab='chats';selected=id;draw();void loadMessages();},
  destroy(){disposed=true;},
 };
}
