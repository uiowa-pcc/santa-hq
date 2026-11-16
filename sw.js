/* Santa HQ offline cache. Optional files may not be present on every deployment. */
const CACHE='santa-hq-v11-gift-sorter-playground';
const CORE=['./','./index.html'];
const OPTIONAL=[
  './family.html','./family-hq.js','./cloud-sync.js','./manifest.webmanifest',
  './icon-192.png','./icon-512.png',
  './art/crayons.svg','./art/elf.svg','./art/letter.svg','./art/mailbox.svg',
  './art/microphone.svg','./art/ornament.svg','./art/present.svg',
  './art/santa-full.svg','./art/santa-peek.svg','./art/stocking.svg','./art/tree.svg'
];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(async cache=>{
    await cache.addAll(CORE);
    // An unavailable optional asset should not prevent the whole app from installing.
    await Promise.all(OPTIONAL.map(asset=>cache.add(asset).catch(()=>{})));
  }));
  self.skipWaiting();
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(
    keys.filter(key=>key.startsWith('santa-hq-')&&key!==CACHE).map(key=>caches.delete(key))
  )));
  self.clients.claim();
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  event.respondWith(
    fetch(event.request).then(response=>{
      if(response.ok&&!url.search){
        const copy=response.clone();
        event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));
      }
      return response;
    }).catch(async()=>{
      const cached=await caches.match(event.request,{ignoreSearch:true});
      if(cached)return cached;
      return event.request.mode==='navigate' ? (await caches.match('./index.html')||Response.error()) : Response.error();
    })
  );
});
