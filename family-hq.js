/* Santa HQ — Cloudflare Family List. Put after the original app <script>. */
(function () {
  'use strict';
  if (typeof navItems === 'undefined' || typeof appState === 'undefined' || typeof render !== 'function') {
    console.error('Santa HQ Family add-on: original app script was not found.'); return;
  }
  const STORE = 'santa_hq_family_cloudflare_v1';
  const SECRET_STORE = 'santa_hq_family_cloudflare_admin_session';
  const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; } })();
  const sharedLogin = window.SantaCloudSync?.credentials?.() || {};
  const st = {
    workerUrl: sharedLogin.workerUrl || saved.workerUrl || '', token: sharedLogin.token || sessionStorage.getItem(SECRET_STORE) || '',
    shareId: saved.shareId || '', validated:false, ready:false, loading:false, attempted:false,
    publishing:false, active:true, ideas:new Set(saved.ideas || []), bag:new Set(saved.bag || []),
    interests1:saved.interests1 || '', interests2:saved.interests2 || '', claims:[],
    published:[], dirty:!!saved.dirty, error:'', pollTimer:null
  };
  window.addEventListener('santa-cloud-logout',()=>{st.token='';st.validated=false;st.attempted=false;});
  const esc = (s) => escapeHTML(String(s ?? ''));
  const short = (s,n) => String(s ?? '').trim().slice(0,n);
  const isBought = g => ['Ordered','Arrived','Wrapped'].includes(g.status);
  const isIdea = g => g.status === 'Idea' || getPlanLane(g) === 'ideas';
  const img = g => /^https:\/\//i.test(g.image || '') ? safeLink(g.image) : '';
  const liveGift = id => appState.gifts.find(g => String(g.id)===String(id));
  const normalizeWorker = raw => {
    try {
      const u = new URL(raw.trim());
      if (u.protocol !== 'https:' || !u.hostname.endsWith('.workers.dev') || u.username || u.password || u.port) return '';
      return u.origin;
    } catch { return ''; }
  };
  const saveDraft = () => {
    st.dirty = true; localStorage.setItem(STORE, JSON.stringify({
      workerUrl:st.workerUrl, shareId:st.shareId, ideas:[...st.ideas], bag:[...st.bag],
      interests1:st.interests1, interests2:st.interests2, dirty:st.dirty
    }));
  };
  const savePublished = () => {
    st.dirty=false; saveDraft(); st.dirty=false;
    const obj=JSON.parse(localStorage.getItem(STORE) || '{}'); obj.dirty=false;
    localStorage.setItem(STORE,JSON.stringify(obj));
  };
  const familyLink = () => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}family.html#list=${encodeURIComponent(st.shareId)}&api=${encodeURIComponent(st.workerUrl)}`;
  const fetchApi = async (route, options={}) => {
    if (!st.workerUrl || !st.token) throw Error('Enter your Cloudflare Worker URL and private admin token first.');
    const r = await fetch(st.workerUrl+route, {
      method:options.body?'POST':'GET', cache:'no-store',
      headers:{'Authorization':'Bearer '+st.token, ...(options.body?{'Content-Type':'application/json'}:{})},
      ...(options.body?{body:JSON.stringify(options.body)}:{})
    });
    let data={}; try {data=await r.json();} catch (_) {}
    if (!r.ok) throw Error(data.error || `Cloudflare returned HTTP ${r.status}.`);
    return data;
  };
  if (!navItems.some(n=>n[0]==='family')) navItems.splice(navItems.length-1,0,['family','gift','Family list']);
  const originalRender=render;
  render=function () {
    if (appState.page!=='family') return originalRender();
    const sharedNow = window.SantaCloudSync?.credentials?.() || {};
    if (sharedNow.workerUrl && sharedNow.token && (sharedNow.workerUrl!==st.workerUrl || sharedNow.token!==st.token)) {
      st.workerUrl=sharedNow.workerUrl; st.token=sharedNow.token; st.validated=false; st.attempted=false; st.error='';
    }
    renderNav(); document.getElementById('content').innerHTML=familyAdmin();
    document.title='Santa HQ • Family list';
    if (st.workerUrl && st.token && !st.attempted && !st.loading) setTimeout(beginSharing,0);
  };
  function giftPick(g,kind) {
    const chosen=(kind==='bag'?st.bag:st.ideas).has(g.id);
    const claim=st.claims.find(c=>c.id===g.id);
    const pic=img(g);
    return `<button type="button" class="fh-pick ${chosen?'chosen':''}" data-fh="pick" data-kind="${kind}" data-id="${esc(g.id)}" aria-pressed="${chosen}">
      <span class="fh-thumb">${pic?`<img alt="" src="${esc(pic)}" loading="lazy">`:'<span class="fh-ribbon" aria-hidden="true"></span>'}</span>
      <span class="fh-pick-text"><strong>${esc(g.name)}</strong><small>${esc(kidName(g.kid))}${kind==='bag'?' · Already covered':claim?' · Claimed by '+esc(claim.name):' · Available to share'}</small></span>
      <span class="fh-checkbox" aria-hidden="true">${chosen?'&#10003;':''}</span></button>`;
  }
  function listFor(kind) {
    const gifts=appState.gifts.filter(kind==='bag'?isBought:g=>isIdea(g)&&!isBought(g));
    return gifts.length?`<div class="fh-pick-grid">${gifts.map(g=>giftPick(g,kind)).join('')}</div>`:
      `<div class="fh-nothing">${kind==='bag'?'Mark a gift ordered, arrived, or wrapped to find it here.':'Add a gift to your Maybe / Ideas board first.'}</div>`;
  }
  function parentClaims() {
    return st.claims.length?`<div class="fh-claims">${st.claims.map(c=>{
      const name=liveGift(c.id)?.name||st.published.find(i=>i.id===c.id)?.name||'Gift idea';
      return `<div class="fh-claim"><span><strong>${esc(name)}</strong><small>Claimed by ${esc(c.name)}</small></span><button data-fh="release" data-id="${esc(c.id)}" type="button" class="fh-mini">Release</button></div>`;
    }).join('')}</div>`:'<span class="fh-muted">No gifts claimed yet.</span>';
  }
  function blockTitle(title,desc,count) {
    return `<div class="fh-section-head"><div><h2>${title}</h2><p>${desc}</p></div>${count===undefined?'':`<span class="fh-count">${count} selected</span>`}</div>`;
  }
  function familyAdmin() {
    return `<div class="fh-admin">
      <div class="fh-hero"><span class="fh-kicker">THE FAMILY EDITION</span><h1>A little holiday help, <em>all in one place.</em></h1><p>Choose what relatives can see: gift ideas to claim, what's already in Santa's bag, and the girls' favorite things.</p><div class="fh-hero-mark" aria-hidden="true"><span></span></div></div>
      <section class="fh-control">
        ${blockTitle('Cloudflare family sharing','Uses the same secure Cloudflare login as your private Santa HQ planner.')}
        <p class="fh-muted">${st.validated?'Connected and ready to publish.':st.workerUrl&&st.token?'Connecting to Cloudflare…':'Connect on the Cloud sync tab first.'}</p>
        ${st.error?`<p class="fh-alert">${esc(st.error)}</p>`:''}
        <button type="button" class="secondary" data-fh="sync">Open Cloud sync</button>
      </section>
      <section class="fh-control">${blockTitle('Share with family','A separate link shows only the items you select.')}
        <span class="fh-ready">${st.ready?(st.active?'Published':'Paused'):'Not published'}</span>
        ${st.ready?`<div class="fh-share-link"><input type="text" aria-label="Share link for relatives" value="${esc(familyLink())}" readonly><button type="button" class="fh-small-btn" data-fh="copy">Copy link</button><button type="button" class="fh-small-btn alt" data-fh="open">Open</button></div>`:
        '<p class="fh-muted">Choose below, then publish to create your relatives’ link.</p>'}
        <div class="fh-toolbar"><button type="button" class="primary" data-fh="publish" ${!st.validated||st.publishing?'disabled':''}>${st.publishing?'Publishing…':'Publish family list'}</button>
        ${st.ready?`<button type="button" class="secondary" data-fh="pause">${st.active?'Pause link':'Reactivate link'}</button>`:''}
        <span class="fh-save-note">${st.dirty?'Unpublished changes':'Only published selections appear to relatives'}</span></div>
      </section>
      <section class="fh-control">${blockTitle('1. What’s in Santa’s bag','Short already-purchased list. Select only what relatives should know is covered.',st.bag.size)}${listFor('bag')}</section>
      <section class="fh-control">${blockTitle('2. Things they love','Favorite characters, colors, activities and interests, separated by commas or new lines.')}
        <div class="fh-likes-grid"><label><strong>${esc(settings.child1)}</strong><textarea data-fh-interest="1" rows="4" maxlength="1400" placeholder="Books, science, rainbows…">${esc(st.interests1)}</textarea></label>
        <label><strong>${esc(settings.child2)}</strong><textarea data-fh-interest="2" rows="4" maxlength="1400" placeholder="Animals, dolls, music…">${esc(st.interests2)}</textarea></label></div></section>
      <section class="fh-control">${blockTitle('3. Gift ideas relatives can claim','Pick from your Maybe / Ideas list. No budgets, hiding spots, notes or private shopping plans are included.',st.ideas.size)}${listFor('ideas')}</section>
      <section class="fh-control">${blockTitle('Family reservations','Private parent-only list of who has claimed each gift.')}${parentClaims()}</section>
      <p class="fh-footnote">Cloudflare stores only items you publish. Anyone with the family link can view those items and claim gifts; do not share the private admin token. Claim status refreshes automatically (about every 20 seconds).</p>
    </div>`;
  }
  const adminCSS = `
  .fh-admin{color:#3d3038;max-width:1050px}.fh-hero{background:linear-gradient(110deg,#fae7e9,#fdf2ef);border-radius:26px;padding:36px;position:relative;overflow:hidden;border:1px solid #f2dfe0;margin-bottom:18px}.fh-kicker{font-weight:800;letter-spacing:2px;font-size:10px;color:#b24b5f}.fh-hero h1{font:700 clamp(29px,4vw,45px)/1.1 Fraunces,Georgia,serif;margin:10px 0 12px;max-width:680px;letter-spacing:-1.3px}.fh-hero h1 em{font-style:normal;color:#be304a}.fh-hero p{color:#8c737c;max-width:570px;margin:0}.fh-hero-mark{position:absolute;width:165px;height:165px;border:10px solid #f8d3d9;border-radius:50%;right:-36px;bottom:-80px;opacity:.8}.fh-hero-mark span{display:block;width:100px;height:100px;border:12px solid #f3bdc6;border-radius:50%;margin:22px auto}.fh-control{padding:24px;background:#fff;border:1px solid #f0e2e1;border-radius:22px;margin:16px 0;box-shadow:0 9px 25px #8b576008}.fh-section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:18px}.fh-section-head h2{font:700 23px Fraunces,Georgia,serif;letter-spacing:-.4px;margin:0 0 5px}.fh-section-head p{font-size:12px;color:#927985;margin:0;max-width:600px}.fh-count,.fh-ready{font-size:11px;border-radius:99px;background:#fceef0;color:#ac455c;padding:6px 10px;white-space:nowrap;font-weight:800}.fh-ready{background:#f0f4ed;color:#557360}.fh-pick-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fh-pick{border:1.5px solid #f0e3e5;border-radius:15px;background:#fffdfa;text-align:left;padding:10px;display:flex;align-items:center;gap:12px;min-width:0;color:inherit}.fh-pick.chosen{border-color:#c85567;background:#fff7f8}.fh-thumb{height:52px;width:52px;border-radius:12px;flex:none;background:#fae8e8;display:grid;place-items:center;overflow:hidden}.fh-thumb img{width:100%;height:100%;object-fit:cover}.fh-ribbon{height:27px;width:25px;background:#e9a8b1;border-radius:5px;position:relative}.fh-ribbon:before{content:'';position:absolute;width:7px;height:100%;background:#fff2e8;left:9px;top:0}.fh-ribbon:after{content:'';position:absolute;width:24px;height:7px;background:#fff2e8;left:0;top:9px}.fh-pick-text{flex:1;min-width:0;display:grid;gap:4px}.fh-pick-text strong{font-size:12px;line-height:1.35;overflow-wrap:anywhere}.fh-pick-text small{font-size:10px;color:#96848b}.fh-checkbox{height:23px;width:23px;border:1.5px solid #d7c7ca;border-radius:7px;flex:none;display:grid;place-items:center;color:white;font-size:14px;font-weight:900}.fh-pick.chosen .fh-checkbox{background:#c62846;border-color:#c62846}.fh-likes-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.fh-likes-grid label{display:grid;gap:9px;font-size:13px}.fh-likes-grid label strong{font-weight:800}.fh-likes-grid textarea{border:1.5px solid #eadde1;border-radius:13px;background:#fffaf9;padding:12px;font:inherit;resize:vertical;width:100%;color:#392f37;min-height:106px}.fh-nothing{color:#977f8c;background:#fdf8f8;border:1px dashed #eacfd3;border-radius:14px;padding:19px;font-size:12px}.fh-share-link{display:flex;gap:9px;align-items:center}.fh-share-link input{flex:1;min-width:80px;background:#fff8f8;padding:12px 14px;border:1px solid #eddbdf;border-radius:11px;color:#66535b;font-size:12px}.fh-small-btn,.fh-mini{border:1px solid #e9d6dc;background:#bd2944;color:white;border-radius:11px;font-size:12px;font-weight:800;padding:11px 13px;white-space:nowrap}.fh-small-btn.alt,.fh-mini{background:#fff;color:#ae3650}.fh-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:15px}.fh-save-note,.fh-muted,.fh-footnote{color:#927f85;font-size:12px}.fh-alert{border:1px solid #edc4cb;background:#fff0f0;border-radius:16px;padding:18px;margin:14px 0;color:#804254}.fh-alert p{font-size:12px}.fh-alert .secondary{margin-right:7px}.fh-claims{display:grid;gap:9px}.fh-claim{display:flex;align-items:center;justify-content:space-between;gap:10px;background:#fbf7f6;border-radius:12px;padding:12px}.fh-claim span{display:grid;gap:4px}.fh-claim strong{font-size:12px}.fh-claim small{font-size:11px;color:#977c86}.fh-footnote{line-height:1.65;padding:3px 5px 15px}
  @media(max-width:760px){.mobile-nav{justify-content:flex-start!important;overflow-x:auto;scrollbar-width:none;gap:3px}.mobile-nav .nav-btn{flex:0 0 53px!important;scroll-snap-align:start}.mobile-nav::-webkit-scrollbar{display:none}}
  @media(max-width:690px){.fh-hero{padding:26px 22px}.fh-control{padding:18px}.fh-pick-grid,.fh-likes-grid{grid-template-columns:1fr}.fh-section-head{flex-wrap:wrap}.fh-share-link{flex-wrap:wrap}.fh-share-link input{flex-basis:100%}}
  `;

  const sty=document.createElement('style'); sty.textContent=adminCSS+`
  .fh-field{border:1.5px solid #eadde1;border-radius:13px;background:#fffaf9;padding:12px;font:inherit;width:100%;min-height:45px;color:#392f37}
  .fh-likes-grid .fh-field{display:block}
  `; document.head.appendChild(sty);

  function adoptServer(v) {
    if (v.list) {
      st.shareId=v.list.id; st.active=!!v.list.active; st.ready=true;
      st.published=v.items||[];
      st.claims=st.published.filter(x=>x.claimedBy).map(x=>({id:x.id,name:x.claimedBy}));
      if (!st.dirty) {
        st.ideas=new Set(st.published.filter(x=>x.kind==='idea').map(x=>x.id));
        st.bag=new Set(st.published.filter(x=>x.kind==='bag').map(x=>x.id));
        st.interests1=v.list.interests1||''; st.interests2=v.list.interests2||'';
      }
    } else { st.ready=false; st.shareId=''; st.claims=[]; st.published=[]; }
    savePublishedStateIfClean();
  }
  function savePublishedStateIfClean() {
    const dirty=st.dirty; saveDraft(); st.dirty=dirty;
    if (!dirty) {
      const obj=JSON.parse(localStorage.getItem(STORE)||'{}'); obj.dirty=false;
      localStorage.setItem(STORE, JSON.stringify(obj));
    }
  }
  async function beginSharing() {
    if (st.loading||!st.workerUrl||!st.token||st.validated) return;
    st.loading=true; st.attempted=true; st.error='';
    try {
      const data=await fetchApi('/api/admin/state');
      st.validated=true; adoptServer(data);
      if (!st.pollTimer) st.pollTimer=setInterval(refreshClaims, 20000);
    } catch(e) {st.error=e.message||'Cloudflare Worker not reachable.';st.validated=false;}
    finally {st.loading=false;if(appState.page==='family')render();}
  }
  async function refreshClaims() {
    if (!st.validated||!st.ready||document.hidden) return;
    try {
      const data=await fetchApi('/api/admin/state');
      const claims=(data.items||[]).filter(x=>x.claimedBy).map(x=>({id:x.id,name:x.claimedBy}));
      if (JSON.stringify(claims)!==JSON.stringify(st.claims)) {
        st.claims=claims;
        if(appState.page==='family') render();
      }
    } catch(e) {console.warn('Claim refresh unavailable:',e.message);}
  }
  async function publishFamily() {
    if (!st.validated||st.publishing) return;
    st.publishing=true;render();
    try {
      const approved=[];
      for(const id of st.ideas) {
        const g=liveGift(id);
        if(g&&isIdea(g)&&!isBought(g)) approved.push({id:String(g.id),kind:'idea',name:short(g.name,160),kid:g.kid||'unassigned',category:short(g.category,60),link:safeLink(g.link)||'',image:img(g)});
      }
      for(const id of st.bag) {
        const g=liveGift(id);
        if(g&&isBought(g)&&!approved.some(x=>x.id===String(id))) approved.push({id:String(g.id),kind:'bag',name:short(g.name,160),kid:g.kid||'unassigned',category:short(g.category,60),link:'',image:''});
      }
      const data=await fetchApi('/api/admin/publish',{body:{
        child1:short(settings.child1,65),child2:short(settings.child2,65),
        interests1:st.interests1,interests2:st.interests2,items:approved
      }});
      st.dirty=false; adoptServer(data); savePublished();
      showToast('Family page published!');
    } catch(e) {st.error=e.message;showToast('Could not publish: '+e.message);}
    finally {st.publishing=false;render();}
  }
  async function togglePause() {
    if(!st.validated||!st.ready)return;
    try {
      const v=await fetchApi('/api/admin/active',{body:{active:!st.active}});
      st.active=!!v.active; render(); showToast(st.active?'Family page reactivated':'Family page paused');
    } catch(e) {st.error=e.message;render();}
  }
  async function releaseGift(id) {
    const c=st.claims.find(c=>c.id===id);
    if(!c||!confirm(`Release the reservation made by ${c.name}?`))return;
    try {
      await fetchApi('/api/admin/release',{body:{id}});
      st.claims=st.claims.filter(x=>x.id!==id);
      render(); showToast('Reservation released');
    } catch(e) {st.error=e.message;render();}
  }
  document.addEventListener('click',e=>{
    const btn=e.target.closest('[data-fh]');if(!btn)return;
    const action=btn.dataset.fh;
    if(action==='pick') {
      const id=btn.dataset.id, kind=btn.dataset.kind, set=kind==='bag'?st.bag:st.ideas;
      if(set.has(id))set.delete(id);else set.add(id);
      if(kind==='bag')st.ideas.delete(id);else st.bag.delete(id);
      saveDraft();render();
    } else if(action==='sync') {navigate('cloud');
    } else if(action==='connect') {
      const raw=document.getElementById('fh-worker')?.value||'';
      const worker=normalizeWorker(raw), token=document.getElementById('fh-token')?.value.trim()||'';
      if(!worker){st.error='Enter your complete https://…workers.dev URL (no /api path).';render();return;}
      if(token.length<20){st.error='The ADMIN_TOKEN must have at least 20 characters.';render();return;}
      st.workerUrl=worker;st.token=token;sessionStorage.setItem(SECRET_STORE,token);
      st.validated=false;st.attempted=false;st.ready=false;st.error='';
      savePublishedStateIfClean();beginSharing();
    } else if(action==='publish') publishFamily();
    else if(action==='pause') togglePause();
    else if(action==='release')releaseGift(btn.dataset.id);
    else if(action==='open'&&st.ready)window.open(familyLink(),'_blank','noopener,noreferrer');
    else if(action==='copy'&&st.ready) {
      const link=familyLink();
      if(navigator.clipboard?.writeText)navigator.clipboard.writeText(link).then(()=>showToast('Family link copied'),()=>prompt('Copy the link',link));
      else prompt('Copy the link',link);
    }
  });
  document.addEventListener('input',e=>{
    const k=e.target.dataset?.fhInterest;
    if(k!=='1'&&k!=='2')return;
    if(k==='1')st.interests1=e.target.value;
    else st.interests2=e.target.value;
    saveDraft();
    const notice=document.querySelector('.fh-save-note');
    if(notice)notice.textContent='Unpublished changes';
  });
})();
