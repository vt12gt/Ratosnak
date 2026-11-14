const CACHE='navega-pe-shell-v2';
const SHELL=['./','./index.html','./manifest.json'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('navega-pe-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);
 if(url.hostname==='tile.openstreetmap.org'||url.hostname.endsWith('.tile.openstreetmap.fr')){
  event.respondWith(caches.open('navega-pe-tiles').then(async cache=>{
   const cached=await cache.match(event.request);
   try{const response=await fetch(event.request);if(response.ok)cache.put(event.request,response.clone());return response}
   catch{return cached||Response.error()}
  }));
  return;
 }
 if(url.origin===location.origin){
  event.respondWith(fetch(event.request).then(response=>{
   if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy))}
   return response;
  }).catch(()=>caches.match(event.request)));
 }
});