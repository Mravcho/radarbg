'use strict';
// ── RadarBG v2 — app.js ──────────────────────────────────────────────────────

// ── Config ───────────────────────────────────────────────────────────────────
const CFG = {
  alertDist:    800,    // m — police / fixed camera
  avgAlertDist: 1500,   // m — average speed section start
  searchRadius: 5,      // km
  showPolice:   true,
  showCamera:   true,
  showAvg:      true,
  showCharge:   true,
  onlyFast:     false,  // only fast chargers ≥50kW
  sound:        true,
  interval:     60,     // auto-refresh seconds
};

// ── State ────────────────────────────────────────────────────────────────────
let myLat = 42.6977, myLng = 23.3219;
let mySpeed = null;           // m/s from GPS
let alertItems   = [];        // [{lat,lng,type,id,label,maxspeed}]
let alerted      = new Set();
let gpsWatcher   = null;
let autoTimer    = null;
let alertTimer   = null;
let audioCtx     = null;
let isRefreshing = false;
let routeControl = null;
let destMarker   = null;
let suggestTimer = null;

// ── Leaflet layers ────────────────────────────────────────────────────────────
let myMarker   = null;
let myCircle   = null;
const layerPolice = L.layerGroup();
const layerCamera = L.layerGroup();
const layerAvg    = L.layerGroup();
const layerCharge = L.layerGroup();

// ── DOM ───────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Loading ───────────────────────────────────────────────────────────────────
let loadPct = 0;
const lFill = $('load-fill'), lTxt = $('load-txt');
const lTimer = setInterval(() => {
  loadPct = Math.min(loadPct + Math.random() * 15, 87);
  lFill.style.width = loadPct + '%';
}, 220);
function doneLoading() {
  clearInterval(lTimer);
  lFill.style.width = '100%';
  lTxt.textContent  = 'Готово!';
  setTimeout(() => $('loading').classList.add('hide'), 600);
}

// ── Map ───────────────────────────────────────────────────────────────────────
const map = L.map('map', {
  center: [myLat, myLng], zoom: 13,
  zoomControl: false, attributionControl: false,
});
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 19, subdomains: 'abcd',
}).addTo(map);

layerPolice.addTo(map);
layerCamera.addTo(map);
layerAvg.addTo(map);
layerCharge.addTo(map);

// ── Icons ─────────────────────────────────────────────────────────────────────
const mkIcon = (cls, emoji, size = 32) => L.divIcon({
  className: '',
  html: `<div class="marker-base ${cls}">${emoji}</div>`,
  iconSize: [size, size], iconAnchor: [size/2, size/2], popupAnchor: [0, -size/2],
});
const ICONS = {
  police: mkIcon('mk-police', '🚔'),
  camera: mkIcon('mk-camera', '📷'),
  avg:    mkIcon('mk-avg',    '📏'),
  charge: mkIcon('mk-charge', '⚡'),
  dest:   L.divIcon({ className:'', html:'<div class="mk-dest">📍</div>', iconSize:[28,28], iconAnchor:[14,14] }),
};
const myIcon = () => L.divIcon({
  className: '', html: '<div class="mk-me"></div>',
  iconSize: [18,18], iconAnchor: [9,9],
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function distM(lat1, lng1, lat2, lng2) {
  const R = 6371000, dL = (lat2-lat1)*Math.PI/180, dN = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dL/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dN/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function fmtDist(m) { return m >= 1000 ? (m/1000).toFixed(1)+'км' : Math.round(m)+'м'; }
function fmtTime(now) {
  return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}
function updateMyPos(lat, lng) {
  if (!myMarker) myMarker = L.marker([lat,lng],{icon:myIcon(),zIndexOffset:1000}).addTo(map);
  else myMarker.setLatLng([lat,lng]);
  const r = CFG.searchRadius * 1000;
  if (!myCircle) {
    myCircle = L.circle([lat,lng],{radius:r,color:'#00d4ff',opacity:.2,fillOpacity:.03,weight:1}).addTo(map);
  } else { myCircle.setLatLng([lat,lng]).setRadius(r); }
}

// ── Audio ─────────────────────────────────────────────────────────────────────
function initAudio() {
  if (!audioCtx) try { audioCtx = new (window.AudioContext||window.webkitAudioContext)(); } catch(e){}
  if (audioCtx?.state === 'suspended') audioCtx.resume();
}
function beep(freq, dur, type='sine', vol=.32) {
  if (!CFG.sound || !audioCtx) return;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  o.frequency.value = freq; o.type = type;
  g.gain.setValueAtTime(vol, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + dur);
  o.start(); o.stop(audioCtx.currentTime + dur);
}
const sounds = {
  police() { beep(880,.12,'square',.28); setTimeout(()=>beep(660,.2,'square',.28),160); setTimeout(()=>beep(880,.12,'square',.22),400); },
  camera() { beep(1400,.08,'sine',.22); setTimeout(()=>beep(1000,.16,'sine',.18),110); },
  avg()    { beep(600,.06,'sine',.2); setTimeout(()=>beep(800,.06,'sine',.2),90); setTimeout(()=>beep(1000,.12,'sine',.2),180); },
  charge() { beep(1200,.06,'sine',.18); setTimeout(()=>beep(1400,.1,'sine',.18),100); },
};

// ── Alert banner ──────────────────────────────────────────────────────────────
function showAlert(type, dist, sub='') {
  const banner = $('alert-banner'), inner = $('alert-inner');
  const cfg = {
    police: {icon:'🚔', title:'ПОЛИЦИЯ',  sub:'Докладвано от потребители'},
    camera: {icon:'📷', title:'КАМЕРА',   sub:'Фиксирана камера'},
    avg:    {icon:'📏', title:'СРЕДНА СКОРОСТ', sub:'Начало на секцията'},
    charge: {icon:'⚡', title:'ЗАРЯДНА',  sub:'OpenChargeMap'},
  };
  const c = cfg[type] || cfg.camera;
  inner.className = type;
  $('alert-icon').textContent  = c.icon;
  $('alert-title').textContent = c.title;
  $('alert-sub').textContent   = sub || c.sub;
  $('alert-dist').textContent  = fmtDist(dist);
  banner.classList.add('show');
  if (alertTimer) clearTimeout(alertTimer);
  alertTimer = setTimeout(() => banner.classList.remove('show'), 9000);
}
$('alert-banner').addEventListener('click', () => $('alert-banner').classList.remove('show'));

// ── Proximity check ───────────────────────────────────────────────────────────
function checkProximity() {
  let best = { dist: Infinity, type: null, id: null, sub: '' };
  alertItems.forEach(item => {
    const d = distM(myLat, myLng, item.lat, item.lng);
    const threshold = item.type === 'avg' ? CFG.avgAlertDist : CFG.alertDist;
    if (d > threshold * 1.6) alerted.delete(item.id);
    if (d <= threshold && !alerted.has(item.id) && d < best.dist) {
      best = { dist: d, type: item.type, id: item.id, sub: item.label || '' };
    }
  });
  if (best.id) {
    alerted.add(best.id);
    showAlert(best.type, best.dist, best.sub);
    sounds[best.type]?.();
  }
}

// ── Waze Police data ──────────────────────────────────────────────────────────
const CORS_PROXIES = [
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
];
async function proxyFetch(rawUrl) {
  for (const fn of CORS_PROXIES) {
    try {
      const r = await fetch(fn(rawUrl), { signal: AbortSignal.timeout(7000) });
      if (!r.ok) continue;
      const txt = await r.text();
      try { const j = JSON.parse(txt); return j.contents ? JSON.parse(j.contents) : j; }
      catch { continue; }
    } catch { /* next proxy */ }
  }
  return null;
}

async function loadWaze() {
  const box = 0.016 * (CFG.searchRadius + 1);
  const url = `https://www.waze.com/row-rtserver/web/TGeoRSS?tk=community&format=JSON`
    + `&left=${myLng-box*1.5}&right=${myLng+box*1.5}&bottom=${myLat-box}&top=${myLat+box}`
    + `&ma=200&mj=200&mu=200&types=alerts`;
  const data = await proxyFetch(url);
  let cnt = 0;
  if (data?.alerts) {
    data.alerts.forEach(a => {
      const lat = a.location?.y, lng = a.location?.x;
      if (!lat || !lng) return;
      if (distM(myLat,myLng,lat,lng) > CFG.searchRadius*1000*1.2) return;
      if ((a.type||'').toUpperCase() !== 'POLICE') return;
      if (!CFG.showPolice) return;
      const id = a.uuid || `w_${lat.toFixed(5)}_${lng.toFixed(5)}`;
      const m = L.marker([lat,lng],{icon:ICONS.police}).addTo(layerPolice);
      m.bindPopup(`<b style="color:var(--police)">🚔 Полиция</b><br><small style="color:var(--text2)">${a.reportDescription||'Докладвано'}</small>`);
      alertItems.push({lat,lng,type:'police',id,label:'Докладвано от потребители'});
      cnt++;
    });
  } else {
    // demo police points
    if (CFG.showPolice) {
      [[myLat+.005,myLng+.008],[myLat-.007,myLng-.004]].forEach((p,i)=>{
        const [lat,lng]=p, id=`dp_${i}`;
        const m = L.marker([lat,lng],{icon:ICONS.police}).addTo(layerPolice);
        m.bindPopup('<b style="color:var(--police)">🚔 Полиция</b><br><small>⚠️ ДЕМО</small>');
        alertItems.push({lat,lng,type:'police',id,label:'ДЕМО'});
        cnt++;
      });
    }
  }
  return cnt;
}

// ── OSM Cameras (static JSON, updated daily) ──────────────────────────────────
async function loadOSMCameras() {
  let fixed = 0, avg = 0;
  try {
    const r = await fetch(`cameras.json?t=${Date.now()}`);
    if (!r.ok) throw new Error('no cameras.json');
    const data = await r.json();

    if (data.cameras && data.cameras.length > 0) {
      data.cameras.forEach(cam => {
        if (distM(myLat,myLng,cam.lat,cam.lng) > CFG.searchRadius*1000*1.5) return;
        const id = cam.id;
        const speedStr = cam.maxspeed ? ` · ${cam.maxspeed} км/ч` : '';

        if (cam.type === 'average_speed') {
          if (!CFG.showAvg) return;
          const m = L.marker([cam.lat,cam.lng],{icon:ICONS.avg}).addTo(layerAvg);
          m.bindPopup(`<b style="color:var(--avg)">📏 Средна скорост</b>${speedStr}<br><small style="color:var(--text2)">Начало на секция</small>`);
          alertItems.push({lat:cam.lat,lng:cam.lng,type:'avg',id,label:`Средна скорост${speedStr}`});
          avg++;
        } else {
          if (!CFG.showCamera) return;
          const icon = cam.type==='traffic_light' ? mkIcon('mk-camera','🚦') : ICONS.camera;
          const m = L.marker([cam.lat,cam.lng],{icon}).addTo(layerCamera);
          m.bindPopup(`<b style="color:var(--camera)">📷 ${cam.label}</b>${speedStr}<br><small style="color:var(--text2)">OpenStreetMap</small>`);
          alertItems.push({lat:cam.lat,lng:cam.lng,type:'camera',id,label:cam.label});
          fixed++;
        }
      });

      // Show updated timestamp
      const upd = new Date(data.updated);
      $('cnt-t').title = `OSM: ${fmtTime(upd)} ${upd.toLocaleDateString('bg')}`;
    } else {
      // Demo cameras if cameras.json is empty (first deploy)
      addDemoCameras();
      fixed = 3; avg = 2;
    }
  } catch(e) {
    console.warn('OSM cameras:', e);
    addDemoCameras();
    fixed = 3; avg = 2;
  }
  return { fixed, avg };
}

function addDemoCameras() {
  if (CFG.showCamera) {
    [[myLat+.010,myLng-.005],[myLat-.005,myLng+.012],[myLat+.018,myLng+.003]].forEach((p,i)=>{
      const [lat,lng]=p, id=`dc_${i}`;
      const m = L.marker([lat,lng],{icon:ICONS.camera}).addTo(layerCamera);
      m.bindPopup('<b style="color:var(--camera)">📷 Камера</b><br><small>⚠️ ДЕМО (стартирай GitHub Action за реални данни)</small>');
      alertItems.push({lat,lng,type:'camera',id,label:'ДЕМО камера'});
    });
  }
  if (CFG.showAvg) {
    [[myLat-.012,myLng+.006],[myLat+.022,myLng-.009]].forEach((p,i)=>{
      const [lat,lng]=p, id=`da_${i}`;
      const m = L.marker([lat,lng],{icon:ICONS.avg}).addTo(layerAvg);
      m.bindPopup('<b style="color:var(--avg)">📏 Средна скорост</b><br><small>⚠️ ДЕМО</small>');
      alertItems.push({lat,lng,type:'avg',id,label:'ДЕМО средна скорост'});
    });
  }
}

// ── EV Chargers (OpenChargeMap) ────────────────────────────────────────────────
async function loadChargers() {
  if (!CFG.showCharge) return 0;
  layerCharge.clearLayers();

  // OpenChargeMap public API — demo key works for low volume
  const url = `https://api.openchargemap.io/v3/poi/?output=json`
    + `&latitude=${myLat}&longitude=${myLng}`
    + `&distance=${CFG.searchRadius}&distanceunit=KM`
    + `&maxresults=80&compact=true&verbose=false`
    + `&countrycode=BG`
    + `&key=e65cde82-2e3f-4d44-842e-a8d3e2fba648`; // public demo key

  let cnt = 0;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('OCM ' + r.status);
    const data = await r.json();

    data.forEach(poi => {
      const lat = poi.AddressInfo?.Latitude, lng = poi.AddressInfo?.Longitude;
      if (!lat || !lng) return;

      // Get max power
      let maxKw = 0;
      (poi.Connections || []).forEach(c => {
        if (c.PowerKW) maxKw = Math.max(maxKw, c.PowerKW);
      });

      if (CFG.onlyFast && maxKw < 50) return;

      const name = poi.AddressInfo?.Title || 'Зарядна станция';
      const kwStr = maxKw ? `${maxKw} kW` : '?';
      const plugs = (poi.Connections||[]).length;
      const status = poi.StatusType?.IsOperational ? '🟢 Работи' : '🔴 Не работи';
      const id = `ocm_${poi.ID}`;

      const m = L.marker([lat,lng],{icon:ICONS.charge}).addTo(layerCharge);
      m.bindPopup(`
        <div class="charge-popup">
          <b>⚡ ${name}</b><br>
          <span class="pow">${kwStr}</span> · ${plugs} конектора<br>
          <small>${status}</small>
        </div>
      `);
      // Don't add chargers to proximity alerts by default (too noisy while driving)
      // but could be enabled for range-anxiety use cases
      cnt++;
    });
  } catch(e) {
    console.warn('OpenChargeMap:', e);
    // Demo chargers
    [[myLat+.008,myLng+.006],[myLat-.014,myLng+.010],[myLat+.020,myLng-.012]].forEach((p,i)=>{
      const [lat,lng]=p;
      const m = L.marker([lat,lng],{icon:ICONS.charge}).addTo(layerCharge);
      m.bindPopup(`<div class="charge-popup"><b>⚡ ДЕМО зарядна</b><br><span class="pow">50 kW</span><br><small>⚠️ Демо данни</small></div>`);
      cnt++;
    });
  }
  return cnt;
}

// ── Master refresh ────────────────────────────────────────────────────────────
async function refreshAll() {
  if (isRefreshing) return;
  isRefreshing = true;
  $('btn-refresh').textContent = '↻ Зарежда...';
  $('status-dot').className = 'busy';
  $('status-txt').textContent = 'Зарежда...';

  // Clear layers
  layerPolice.clearLayers();
  layerCamera.clearLayers();
  layerAvg.clearLayers();
  alertItems = [];
  alerted.clear();

  const [polCnt, {fixed, avg}, chargeCnt] = await Promise.all([
    loadWaze(),
    loadOSMCameras(),
    loadChargers(),
  ]);

  $('cnt-p').textContent = polCnt;
  $('cnt-c').textContent = fixed;
  $('cnt-a').textContent = avg;
  $('cnt-e').textContent = chargeCnt;
  $('cnt-t').textContent = fmtTime(new Date());

  $('status-dot').className = 'gps';
  $('status-txt').textContent = `${polCnt+fixed+avg} обекта`;
  $('btn-refresh').textContent = '↻ Обнови';
  isRefreshing = false;
  checkProximity();
}

function startAutoRefresh() {
  clearInterval(autoTimer);
  autoTimer = setInterval(refreshAll, CFG.interval * 1000);
}

// ── GPS ───────────────────────────────────────────────────────────────────────
function startGPS() {
  if (!('geolocation' in navigator)) {
    $('status-txt').textContent = 'GPS недостъпен';
    return;
  }
  gpsWatcher = navigator.geolocation.watchPosition(pos => {
    myLat = pos.coords.latitude;
    myLng  = pos.coords.longitude;
    mySpeed = pos.coords.speed;
    const kmh = mySpeed != null && mySpeed >= 0 ? Math.round(mySpeed * 3.6) : null;
    $('speed-box').innerHTML = (kmh !== null ? kmh : '--') + '<span id="speed-unit">км/ч</span>';
    updateMyPos(myLat, myLng);
    $('status-dot').className = 'gps';
    $('status-txt').textContent = 'GPS активен';
    checkProximity();
  }, err => {
    $('status-txt').textContent = 'GPS грешка';
  }, { enableHighAccuracy: true, maximumAge: 2500, timeout: 12000 });
}

// ── Navigation ────────────────────────────────────────────────────────────────
let searchDebounce = null;

async function geocode(query) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&countrycodes=bg&accept-language=bg`,
      { headers: { 'Accept-Language': 'bg' }, signal: AbortSignal.timeout(5000) }
    );
    return await r.json();
  } catch { return []; }
}

function showSuggestions(results) {
  const box = $('suggestions');
  if (!results.length) { box.style.display = 'none'; return; }
  box.innerHTML = results.map((r,i) => {
    const name = r.display_name.split(',')[0];
    const addr = r.display_name.split(',').slice(1,3).join(',').trim();
    return `<div class="sug-item" data-lat="${r.lat}" data-lng="${r.lon}">
      <span class="sug-icon">📍</span>
      <div><div class="sug-name">${name}</div><div class="sug-addr">${addr}</div></div>
    </div>`;
  }).join('');
  box.style.display = 'block';
  box.querySelectorAll('.sug-item').forEach(el => {
    el.addEventListener('click', () => {
      const lat = parseFloat(el.dataset.lat), lng = parseFloat(el.dataset.lng);
      $('nav-input').value = el.querySelector('.sug-name').textContent;
      box.style.display = 'none';
      $('nav-clear').style.display = 'flex';
      startRoute(lat, lng);
    });
  });
}

function startRoute(destLat, destLng) {
  // Remove old route
  if (routeControl) { map.removeControl(routeControl); routeControl = null; }
  if (destMarker)   { map.removeLayer(destMarker); destMarker = null; }

  destMarker = L.marker([destLat, destLng], { icon: ICONS.dest }).addTo(map);

  routeControl = L.Routing.control({
    waypoints: [L.latLng(myLat, myLng), L.latLng(destLat, destLng)],
    router: L.Routing.osrmv1({
      serviceUrl: 'https://router.project-osrm.org/route/v1',
      profile: 'driving',
    }),
    lineOptions: {
      styles: [{ color: '#00d4ff', weight: 4, opacity: 0.7 }],
      addWaypoints: false,
    },
    createMarker: () => null,
    show: false,
    fitSelectedRoutes: true,
    routeWhileDragging: false,
  }).addTo(map);

  routeControl.on('routesfound', e => {
    const route = e.routes[0];
    const km    = (route.summary.totalDistance / 1000).toFixed(1);
    const mins  = Math.round(route.summary.totalTime / 60);
    const hrs   = Math.floor(mins / 60);
    const m     = mins % 60;
    const timeStr = hrs > 0 ? `${hrs}ч ${m}мин` : `${mins} мин`;
    const eta   = new Date(Date.now() + route.summary.totalTime * 1000);
    $('route-dist').textContent = km + ' км';
    $('route-time').textContent = `· ${timeStr}`;
    $('route-eta').textContent  = `Пристигане: ${fmtTime(eta)}`;
    $('route-bar').classList.add('show');
  });

  $('nav-go').style.display   = 'none';
  $('nav-stop').style.display = 'flex';
}

function stopRoute() {
  if (routeControl) { map.removeControl(routeControl); routeControl = null; }
  if (destMarker)   { map.removeLayer(destMarker); destMarker = null; }
  $('route-bar').classList.remove('show');
  $('nav-go').style.display   = 'flex';
  $('nav-stop').style.display = 'none';
  $('nav-input').value = '';
  $('nav-clear').style.display = 'none';
}

// Nav input events
$('nav-input').addEventListener('input', function() {
  const v = this.value.trim();
  $('nav-clear').style.display = v ? 'flex' : 'none';
  clearTimeout(searchDebounce);
  if (v.length < 3) { $('suggestions').style.display='none'; return; }
  searchDebounce = setTimeout(async () => {
    const res = await geocode(v);
    showSuggestions(res);
  }, 400);
});
$('nav-input').addEventListener('keydown', e => {
  if (e.key === 'Escape') { $('suggestions').style.display='none'; $('nav-input').blur(); }
});
$('nav-clear').addEventListener('click', () => {
  $('nav-input').value = '';
  $('nav-clear').style.display = 'none';
  $('suggestions').style.display = 'none';
});
$('nav-go').addEventListener('click', async () => {
  const v = $('nav-input').value.trim();
  if (!v) return;
  initAudio();
  const res = await geocode(v);
  if (res.length) startRoute(parseFloat(res[0].lat), parseFloat(res[0].lon));
});
$('nav-stop').addEventListener('click', stopRoute);
document.addEventListener('click', e => {
  if (!$('nav-input-wrap').contains(e.target)) $('suggestions').style.display = 'none';
});
map.on('click', e => {
  $('suggestions').style.display = 'none';
  $('settings-panel').classList.remove('open');
});

// ── Layer pills ───────────────────────────────────────────────────────────────
function pillToggle(pillId, flag, layerGroup, activeClass) {
  $(pillId).addEventListener('click', () => {
    CFG[flag] = !CFG[flag];
    $(pillId).className = 'pill ' + (CFG[flag] ? activeClass : '');
    if (CFG[flag]) layerGroup.addTo(map);
    else map.removeLayer(layerGroup);
    if (flag === 'showPolice' || flag === 'showCamera' || flag === 'showAvg') refreshAll();
  });
}
pillToggle('pill-police','showPolice',layerPolice,'active-police');
pillToggle('pill-camera','showCamera',layerCamera,'active-camera');
pillToggle('pill-avg',   'showAvg',   layerAvg,   'active-avg');
pillToggle('pill-charge','showCharge',layerCharge,'active-charge');

// ── Controls ──────────────────────────────────────────────────────────────────
$('btn-center').addEventListener('click', () => map.setView([myLat,myLng],14,{animate:true}));
$('btn-refresh').addEventListener('click', () => { initAudio(); refreshAll(); });
$('btn-settings').addEventListener('click', () => { initAudio(); $('settings-panel').classList.toggle('open'); });
$('sh').addEventListener('click', () => $('settings-panel').classList.remove('open'));

// ── Settings ──────────────────────────────────────────────────────────────────
[
  ['s-alert',    'alertDist',    'l-alert',    v => v+'м'],
  ['s-avg-alert','avgAlertDist', 'l-avg',      v => v+'м'],
  ['s-radius',   'searchRadius', 'l-radius',   v => v+'км'],
  ['s-interval', 'interval',     'l-interval', v => v+'с'],
].forEach(([id, key, lbl, fmt]) => {
  $(id).addEventListener('input', function() {
    CFG[key] = +this.value;
    $(lbl).textContent = fmt(this.value);
    if (key === 'searchRadius' && myCircle) myCircle.setRadius(CFG.searchRadius*1000);
    if (key === 'interval') startAutoRefresh();
    if (key === 'alertDist' || key === 'avgAlertDist') alerted.clear();
  });
});

function togPair(onId, offId, onFn, offFn) {
  $(onId).addEventListener('click', () => {
    $(onId).classList.add('on'); $(offId).classList.remove('on');
    if (onFn) onFn();
  });
  $(offId).addEventListener('click', () => {
    $(offId).classList.add('on'); $(onId).classList.remove('on');
    if (offFn) offFn();
  });
}
togPair('t-sound-on','t-sound-off',
  () => { CFG.sound=true; initAudio(); },
  () => { CFG.sound=false; }
);
togPair('t-all-charge','t-fast-charge',
  () => { CFG.onlyFast=false; loadChargers().then(n=>$('cnt-e').textContent=n); },
  () => { CFG.onlyFast=true;  loadChargers().then(n=>$('cnt-e').textContent=n); }
);

// ── Service Worker ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}

// ── BOOT ──────────────────────────────────────────────────────────────────────
(async () => {
  updateMyPos(myLat, myLng);
  startGPS();
  lTxt.textContent = 'Зареждане на данни...';
  await refreshAll();
  doneLoading();
  startAutoRefresh();
})();
