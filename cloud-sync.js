/* Santa HQ Full Cloudflare Sync | loaded AFTER the original inline Santa HQ script.
   Private data never goes into the public family list. No Firebase required. */
(function(){
'use strict';
if(typeof appState==='undefined'||typeof navItems==='undefined'||typeof render!=='function'){
  console.error('Santa HQ sync: original inline application not found.');return;
}
const CONFIG_KEY='santahq_cf_full_config_v1';
const QUEUE_KEY='santahq_cf_private_queue_v1';
const TOKEN_KEY='santahq_cf_admin_session_v1';
const config=(()=>{try{return JSON.parse(localStorage.getItem(CONFIG_KEY)||'{}')}catch{return {}}})();
const cloud={
  url:config.url||'', token:sessionStorage.getItem(TOKEN_KEY)||'', connected:false,
  deviceStarted:!!config.deviceStarted, waitForChoice:false,
  queue:(()=>{try{return JSON.parse(localStorage.getItem(QUEUE_KEY)||'{}')}catch{return {}}})(),
  busy:false, reading:false, lastError:'', lastSync:'', status:'Not connected', nextTimer:null,
  remote:null, applying:false, lastStateSignature:''
};
const E=s=>escapeHTML(String(s??''));
const PROFILE_FIELDS=['familyName','child1','child2','budget1','budget2','grownupPin'];
function saveConfig(){localStorage.setItem(CONFIG_KEY,JSON.stringify({url:cloud.url,deviceStarted:cloud.deviceStarted}));}
function saveQueue(){localStorage.setItem(QUEUE_KEY,JSON.stringify(cloud.queue));}
function validUrl(v){try{let u=new URL(String(v||'').trim());return u.protocol==='https:' && u.hostname.endsWith('.workers.dev') && !u.username && !u.password && !u.port ? u.origin : ''}catch{return ''}}
function profile(){return Object.fromEntries(PROFILE_FIELDS.map(k=>[k,settings[k]]));}
function pending(kind,id){return cloud.queue[kind+':'+id];}
function enqueue(kind,id,data,deleted=false){
  if(!cloud.connected||cloud.applying)return;
  const key=kind+':'+id;
  cloud.queue[key]={kind,id,data:deleted?null:data,deleted,nonce:(crypto.randomUUID?.()||String(Date.now()+Math.random()))};
  saveQueue(); updateStatus();
  schedule(100);
}
function countQueue(){return Object.keys(cloud.queue).length;}
function updateStatus(){
  let dot=document.getElementById('topSyncDot');
  if(dot){dot.classList.toggle('online',cloud.connected&&!cloud.lastError&&!countQueue());dot.title=cloud.connected?(countQueue()?'Changes waiting to sync':'Cloudflare connected'):'Local-only mode';}
  let side=document.querySelector('#sideSync span');if(side)side.textContent=cloud.connected?(countQueue()?`${countQueue()} changes waiting`:'Cloudflare sync connected'):'Saved on this device';
}
async function api(route,body){
  if(!cloud.url||!cloud.token)throw Error('Enter the Cloudflare URL and password first.');
  const response=await fetch(cloud.url+route,{method:body?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+cloud.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  let data;try{data=await response.json()}catch{data={}};
  if(!response.ok)throw Error(data.error||`Cloudflare returned ${response.status}`);
  return data;
}
function chooseRecords(rows){
  const map={gift:new Map(),mail:new Map(),profile:new Map()};
  for(const row of rows||[]){if(map[row.kind])map[row.kind].set(row.id,row)}
  return map;
}
function serverHasData(rows){return (rows||[]).some(r=>!r.deleted)}
function adapter(){return {
  putGift:async g=>{enqueue('gift',g.id,g);return true;},
  deleteGift:async id=>{enqueue('gift',id,null,true);return true;},
  putMail:async m=>{enqueue('mail',m.id,m);return true;},
  putProfile:async p=>{enqueue('profile','main',{...profile(),...p});return true;},
  getAllGiftIds:async()=>{const state=await api('/api/private/state');return state.records.filter(r=>r.kind==='gift'&&!r.deleted).map(r=>r.id)}
};}
async function flush(){
  if(!cloud.connected||cloud.busy||cloud.waitForChoice)return;
  cloud.busy=true;
  try{
    const entries=Object.entries(cloud.queue);
    for(const [key,op] of entries){
      await api('/api/private/write',{kind:op.kind,id:op.id,data:op.data,deleted:op.deleted});
      if(cloud.queue[key]?.nonce===op.nonce)delete cloud.queue[key];
      saveQueue();
    }
    cloud.lastError='';cloud.lastSync=new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  }catch(err){cloud.lastError=err.message||'Could not reach Cloudflare';console.warn('Santa HQ sync:',err);}
  finally{cloud.busy=false;updateStatus();}
}
function schedule(delay=300){if(cloud.nextTimer)clearTimeout(cloud.nextTimer);cloud.nextTimer=setTimeout(async()=>{cloud.nextTimer=null;await flush();},delay)}
async function applyServer(rows){
  if(!cloud.connected||cloud.waitForChoice)return;
  const docs=chooseRecords(rows);
  // Local changes queued while offline always win until successfully uploaded.
  const gifts=[];for(const [id,r] of docs.gift){if(!r.deleted&&r.data)gifts.push(r.data)}
  for(const op of Object.values(cloud.queue))if(op.kind==='gift'){
    const i=gifts.findIndex(g=>g.id===op.id);if(i>=0)gifts.splice(i,1);
    if(!op.deleted)gifts.push(op.data);
  }
  const mail=[];for(const [id,r] of docs.mail){if(!r.deleted&&r.data)mail.push(r.data)}
  for(const op of Object.values(cloud.queue))if(op.kind==='mail'){
    const i=mail.findIndex(m=>m.id===op.id);if(i>=0)mail.splice(i,1);
    if(!op.deleted)mail.push(op.data);
  }
  const freshProfile=docs.profile.get('main');
  const effectiveProfile=pending('profile','main')?.data || (!freshProfile?.deleted&&freshProfile?.data);
  // Compare before writes so refreshing an unchanged server does not disrupt typing.
  const signature=JSON.stringify({gifts,mail,profile:effectiveProfile||{}});
  if(signature===cloud.lastStateSignature)return;
  cloud.applying=true;
  try{
    await rawReplaceGifts(gifts);
    await rawReplaceMail(mail);
    appState.gifts=gifts;
    appState.messages=mail;
    if(effectiveProfile){for(const k of PROFILE_FIELDS)if(effectiveProfile[k]!==undefined)settings[k]=effectiveProfile[k];rawSaveSettings();}
    cloud.lastStateSignature=signature;
    // Don't redraw a form while somebody is entering text.
    const active=document.activeElement;
    const editing=active&&active.matches('input,textarea,select,[contenteditable]')&&active.closest('#content,#overlay,#kidPortal');
    if(!editing&&appState.page!=='cloud'){render();if(appState.kidActive&&!document.getElementById('kidMessageForm'))renderKidPortal();}
  }finally{cloud.applying=false;updateStatus();}
}
async function refresh(){
  if(!cloud.connected||cloud.waitForChoice||cloud.reading||document.hidden)return;
  cloud.reading=true;
  try{
    await flush();
    if(countQueue())return; // Don't replace local changes if the upload failed.
    const state=await api('/api/private/state');
    await applyServer(state.records);
    cloud.lastError='';cloud.lastSync=new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  }catch(err){cloud.lastError=err.message||'Sync failed';console.warn(err)}
  finally{cloud.reading=false;updateStatus();}
}
async function uploadLocal(){
  if(!cloud.connected)return;
  cloud.waitForChoice=false;
  // Merge by stable IDs; server wins on OTHER unique IDs. Same ID: this phone wins.
  for(const g of appState.gifts)enqueue('gift',g.id,g);
  for(const m of appState.messages)enqueue('mail',m.id,m);
  enqueue('profile','main',profile());
  await flush();
  if(countQueue())throw Error(cloud.lastError||'Could not upload all changes.');
  cloud.deviceStarted=true;saveConfig();await refresh();
}
async function startWithCloud(){
  if(!cloud.remote)return;
  cloud.waitForChoice=false;cloud.queue={};saveQueue();
  cloud.deviceStarted=true;saveConfig();await applyServer(cloud.remote);
  cloud.remote=null;cloud.lastError='';
}
async function begin(){
  cloud.lastError='';cloud.status='Checking Cloudflare…';
  try{
    const state=await api('/api/private/state');
    cloud.connected=true;
    appState.cloud=adapter();appState.online=true;
    // Handle the very first connection cautiously to preserve existing local gifts.
    if(!cloud.deviceStarted || !serverHasData(state.records)){
      cloud.remote=state.records;
      const localHasData=appState.gifts.length>0||appState.messages.length>0;
      if(!serverHasData(state.records)){
        if(localHasData){cloud.waitForChoice=true;cloud.status='Cloud is empty; choose how to start';}
        else {await uploadLocal();cloud.status='Connected';}
      } else if(localHasData){cloud.waitForChoice=true;cloud.status='Cloud has gifts; choose how to combine';}
      else {await startWithCloud();cloud.status='Connected';}
    }else{
      await flush();
      if(countQueue())throw Error(cloud.lastError||'Could not upload pending changes.');
      const fresh=await api('/api/private/state');
      await applyServer(fresh.records);cloud.status='Connected';
    }
    if(!window.__santahqSyncInterval){window.__santahqSyncInterval=setInterval(()=>refresh(),15000);}
  }catch(err){cloud.lastError=err.message||'Unable to connect';cloud.connected=false;appState.online=false;appState.cloud=null;cloud.status='Not connected';}
  finally{updateStatus();if(appState.page==='cloud')render();}
}
// Prevent the original optional Firebase initializer from being used.
if(typeof initCloud==='function')initCloud=async function(){};
const rawPutGift=putGift,rawRemoveGift=removeGift,rawReplaceGifts=replaceGifts,rawReplaceMail=replaceMail,rawPutMail=putMail,rawSaveSettings=saveSettingsLocal;
putGift=async function(g){const v=await rawPutGift(g);enqueue('gift',g.id,g);return v;};
removeGift=async function(id){const v=await rawRemoveGift(id);enqueue('gift',id,null,true);return v;};
putMail=async function(m){const v=await rawPutMail(m);enqueue('mail',m.id,m);return v;};
saveSettingsLocal=function(){rawSaveSettings();enqueue('profile','main',profile());};
// This cloud tab is available on both desktop and phones.
if(!navItems.some(x=>x[0]==='cloud'))navItems.splice(navItems.length-1,0,['cloud','shield','Cloud sync']);
const baseRender=render;
render=function(){
  if(appState.page==='cloud'){
    renderNav();document.getElementById('content').innerHTML=cloudPage();document.title='Santa HQ • Cloud sync';updateStatus();return;
  }
  baseRender();
  if(appState.page==='dashboard'){
    const root=document.getElementById('content');
    const message=cloud.connected?(countQueue()?'Some edits are waiting to sync':'Your private planner is connected across phones'):'Your gift data is currently saved on this device';
    root?.insertAdjacentHTML('afterbegin',`<div class="ch-banner"><div><strong>${E(message)}</strong><span>${cloud.connected?'Use the same Cloudflare account on your other phone.':'Connect Cloudflare once so gifts, budgets and Santa mail can sync between phones.'}</span></div><button type="button" class="secondary" data-ch="show">${cloud.connected?'Sync settings':'Set up phone sync'}</button></div>`);
  }
  updateStatus();
};
const style=document.createElement('style');style.textContent=`
  .settings-card:has(#firebaseForm){display:none!important}
  .ch-banner{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:13px 17px;border:1px solid #e9d8dc;background:#fff9f7;border-radius:15px;margin:0 0 18px}.ch-banner>div{display:grid;gap:3px}.ch-banner strong{font-size:12px}.ch-banner span{font-size:11px;color:#786e73}.ch-banner button{white-space:nowrap} @media(max-width:550px){.ch-banner{align-items:flex-start;flex-wrap:wrap}}
  .ch-wrap{max-width:850px;margin:auto}.ch-hero{background:linear-gradient(110deg,#fae8e9,#fff8f5);padding:30px;border:1px solid #f0e1e2;border-radius:22px}.ch-hero h1{font:700 clamp(26px,5vw,39px) Fraunces,Georgia,serif;line-height:1.12;margin:6px 0 12px}.ch-hero p{max-width:650px;color:#7b6d75}.ch-card{background:#fff; border:1px solid #f0e1e2;border-radius:20px;padding:22px;margin:16px 0;box-shadow:0 9px 25px #8b576008}.ch-card h2{font:700 22px Fraunces,Georgia,serif;margin:0 0 9px}.ch-card p,.ch-meta{color:#786e73;font-size:13px;line-height:1.6}.ch-field{display:grid;gap:7px;margin:15px 0}.ch-field input{width:100%;padding:13px;background:#fffbfb;border:1px solid #e3cdd2;border-radius:12px;font-size:15px;color:#352f38}.ch-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:17px}.ch-note{background:#fff6ef;border:1px solid #f3e2d8;border-radius:12px;padding:14px;line-height:1.6;font-size:13px}.ch-good{color:#247450}.ch-warn{color:#b14350}.ch-error{background:#fff0f0;border-radius:12px;padding:13px;color:#8d293a;word-break:break-word}
  @media(max-width:760px){.mobile-nav{justify-content:flex-start!important;overflow-x:auto;scrollbar-width:none}.mobile-nav .nav-btn{flex:0 0 54px!important}}
`;document.head.append(style);
function cloudPage(){
  const connected=cloud.connected;
  const status=cloud.waitForChoice?'Choose which gift data to start with':connected?(cloud.lastError?'Saved locally — sync needs attention':'Cloudflare connected'):'Not connected';
  return `<div class="ch-wrap"><div class="ch-hero"><span class="eyebrow">PRIVATE SANTA HQ</span><h1>One Christmas plan.<br>Both phones.</h1><p>Keep gifts, budgets, stocking ideas, Christmas morning order, pictures, and Santa mail together in Cloudflare. Your relatives only see what you publish separately.</p></div>
  <section class="ch-card"><h2>Cloudflare connection</h2><p>Use your own Cloudflare Worker URL and the private ADMIN_TOKEN from your Worker Settings. Enter the same details on both parents’ phones.</p>
    <label class="ch-field">Worker address<input id="ch-url" type="url" autocomplete="url" placeholder="https://santa-hq-family.your-subdomain.workers.dev" value="${E(cloud.url)}"></label>
    <label class="ch-field">Private admin password<input id="ch-token" type="password" autocomplete="off" placeholder="Secret ADMIN_TOKEN" value="${E(cloud.token)}"></label>
    <div class="ch-actions"><button class="primary" data-ch="connect" type="button">${connected?'Reconnect':'Connect Cloudflare'}</button>${connected?'<button class="secondary" type="button" data-ch="refresh">Sync now</button><button class="secondary" type="button" data-ch="disconnect">Sign out on this device</button>':''}</div>
    <p class="ch-meta"><strong>${E(status)}</strong>${cloud.lastSync?' · Last checked '+E(cloud.lastSync):''} · ${countQueue()} local changes waiting</p>${cloud.lastError?`<div class="ch-error">${E(cloud.lastError)}</div>`:''}
  </section>
  ${cloud.waitForChoice?`<section class="ch-card"><h2>First-time setup: protect your existing data</h2><div class="ch-note">Cloudflare ${serverHasData(cloud.remote)?'already has saved gifts':'does not have any gifts yet'}. This phone has ${appState.gifts.length} gifts and ${appState.messages.length} messages. Before continuing, use “Backup gifts” to save a copy of this phone’s records.</div><div class="ch-actions"><button class="secondary" data-ch="backup">Backup gifts first</button><button class="primary" data-ch="merge">${serverHasData(cloud.remote)?'Merge this phone with cloud':'Upload this phone’s gifts to cloud'}</button>${serverHasData(cloud.remote)?'<button class="secondary" data-ch="usecloud">Use cloud records on this phone</button>':''}</div><p class="ch-meta">“Merge” adds both phones’ unique gifts. If both contain the same gift ID, this phone’s version wins. “Use cloud” does not delete your downloaded backup.</p></section>`:''}
  <section class="ch-card"><h2>Sync details</h2><p>Updates usually appear on your other phone within about 15 seconds. New changes are saved to this phone first, then uploaded when online. If the same gift is edited on both phones simultaneously, the last server update wins.</p><p>Use the separate <b>Family list</b> tab to publish selected Maybes, “What’s in Santa’s Bag,” and general favorites for relatives.</p><div class="ch-actions"><button class="secondary" data-ch="backup">Download backup</button><button class="secondary" data-ch="family">Open Family list</button></div></section></div>`;
}
document.addEventListener('click',async e=>{
 const btn=e.target.closest('[data-ch]');if(!btn)return;
 const act=btn.dataset.ch;
 if(act==='show'){navigate('cloud');}
 else if(act==='connect'){
   const url=validUrl(document.getElementById('ch-url')?.value);
   const tok=document.getElementById('ch-token')?.value||'';
   if(!url){cloud.lastError='Use the complete https://…workers.dev Worker URL.';render();return}
   if(tok.length<20){cloud.lastError='Enter the ADMIN_TOKEN secret (at least 20 characters).';render();return}
   if(cloud.url!==url){cloud.deviceStarted=false;cloud.queue={};saveQueue();}
   cloud.url=url;cloud.token=tok;sessionStorage.setItem(TOKEN_KEY,tok);saveConfig();await begin();
 }else if(act==='merge'){
   if(!confirm('Merge data from this phone into the shared Cloudflare planner? Download a backup first.'))return;
   try{await uploadLocal();cloud.remote=null;cloud.status='Connected';showToast('Gifts and messages uploaded');}catch(err){cloud.lastError=err.message;}render();
 }else if(act==='usecloud'){
   if(!confirm('Use the cloud planner on this phone? Existing local records will be replaced. Save a backup first.'))return;
   try{await startWithCloud();cloud.status='Connected';showToast('Shared planner loaded');}catch(err){cloud.lastError=err.message;}render();
 }else if(act==='refresh'){await refresh();render();}
 else if(act==='disconnect'){
   cloud.connected=false;appState.online=false;appState.cloud=null;cloud.token='';sessionStorage.removeItem(TOKEN_KEY);sessionStorage.removeItem('santa_hq_family_cloudflare_admin_session');cloud.lastError='';cloud.status='Signed out';window.dispatchEvent(new Event('santa-cloud-logout'));render();
 }else if(act==='backup'){exportJSON();}
 else if(act==='family'){navigate('family');}
});
// Refresh whenever an installed phone app returns to the foreground.
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&cloud.connected)refresh();});
window.addEventListener('online',()=>{if(cloud.connected)refresh();});
window.SantaCloudSync={credentials:()=>({workerUrl:cloud.url,token:cloud.token}),isConnected:()=>cloud.connected,refresh};
// The inline app starts asynchronously. Allow IndexedDB + initial render to finish.
(async()=>{
  for(let i=0;i<80;i++){
    if(typeof db!=='undefined'&&db&&document.querySelector('#desktopNav .nav-btn'))break;
    await new Promise(r=>setTimeout(r,100));
  }
  render();
  if(cloud.url&&cloud.token)await begin();
})();
})();
