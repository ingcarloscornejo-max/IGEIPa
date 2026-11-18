'use strict';
const GEI_ASSET_CACHE='gei-brand-v2.9';
const GEI_ASSETS=['logo-gei.webp','icon-192.png','icon-512.png','apple-touch-icon.png','favicon.png'];
const GEI_URLS=GEI_ASSETS.map(p=>new URL(p,self.registration.scope).href);
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(GEI_ASSET_CACHE).then(cache=>cache.addAll(GEI_URLS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('gei-brand-')&&k!==GEI_ASSET_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET'||new URL(request.url).origin!==self.location.origin)return;
 if(GEI_URLS.includes(request.url)){
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request)));
 }else if(request.mode==='navigate'){
  // La página siempre viene de la red: no servir formularios viejos ni simular sincronización.
  event.respondWith(fetch(request).catch(()=>new Response(
   '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>GEI Panamá</title><body style="font-family:system-ui;padding:35px;color:#163d32"><h1>GEI Panamá</h1><p>Conecta el dispositivo a Internet y vuelve a abrir la app para trabajar con la base compartida.</p><button onclick="location.reload()" style="padding:12px">Volver a intentar</button></body></html>',
   {status:503,headers:{'Content-Type':'text/html; charset=utf-8'}})));
 }
});
