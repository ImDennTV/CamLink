/* ── CamLink · phone client ───────────────────────────────────────────────── */
'use strict';

const $ = id => document.getElementById(id);
const haptic = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

const BITRATE_KBPS = 5000;
const QUALITY = {
  '1080p30': { w: 1920, h: 1080, fps: 30 },
  '720p60':  { w: 1280, h: 720,  fps: 60 },
  '720p30':  { w: 1280, h: 720,  fps: 30 },
};
// Ordine per la qualità automatica: dal più esigente in banda al più leggero.
const QUALITY_ORDER = ['1080p30', '720p60', '720p30'];

/* ── Impostazioni persistenti (sopravvivono a riavvii/refresh) ───────────── */
const SETTINGS_KEY = 'camlink.settings';
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
  catch (e) { return {}; }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ quality, facing, mirror, statsOn, autoQuality })); }
  catch (e) {}
}
const _saved = loadSettings();

let pc, stream, retryT, statsTimer, wakeLock, _wakeLockTimer;
let facing      = _saved.facing      ?? 'environment';
let quality     = _saved.quality     ?? '720p60';
let mirror      = _saved.mirror      ?? false;
let statsOn     = _saved.statsOn     ?? true;
let autoQuality = _saved.autoQuality ?? true;
let live        = false;
let _manualDeviceId = null;   // set quando l'utente sceglie una camera specifica dalla lista
let _cameras = [];

/* ── Service worker (installabilità PWA) ─────────────────────────────────── */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

/* ── Wake lock: schermo sempre acceso mentre si trasmette ────────────────── */
async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    if (wakeLock && !wakeLock.released) return;
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) {}
}

function _startWakeLockKeeper() {
  _stopWakeLockKeeper();
  acquireWakeLock();
  _wakeLockTimer = setInterval(acquireWakeLock, 25000);
}

function _stopWakeLockKeeper() {
  clearInterval(_wakeLockTimer);
  _wakeLockTimer = null;
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && live) acquireWakeLock();
});

/* ── Batteria: la manda al PC per mostrarla nella dashboard ───────────────── */
let _batteryInited = false;
async function _initBattery() {
  if (_batteryInited || !navigator.getBattery) return;
  _batteryInited = true;
  try {
    const battery = await navigator.getBattery();
    const send = () => {
      fetch('/battery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: battery.level, charging: battery.charging }),
      }).catch(() => {});
    };
    send();
    battery.addEventListener('levelchange', send);
    battery.addEventListener('chargingchange', send);
    setInterval(send, 30000);
  } catch (e) {}
}

/* ── UI helpers ──────────────────────────────────────────────────────────── */
const setPill  = (text, cls) => { $('pillTxt').textContent = text; $('pill').className = cls || ''; };
const setError = msg => { $('err').textContent = msg || ''; };

function ctaSpinner(on) {
  const cta = $('btnStart');
  if (on) {
    cta.setAttribute('disabled', '');
    const ic = cta.querySelector('.icon'); if (ic) ic.outerHTML = '<div class="spinner"></div>';
    $('ctaLabel').textContent = 'Connessione…';
  } else {
    cta.removeAttribute('disabled');
    const sp = cta.querySelector('.spinner');
    if (sp) sp.outerHTML = '<svg viewBox="0 0 24 24" class="icon"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
    $('ctaLabel').textContent = 'Avvia';
  }
}

/* ── Camera ──────────────────────────────────────────────────────────────── */
function _videoConstraints(key, deviceId) {
  const q = QUALITY[key];
  const base = { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps } };
  return deviceId
    ? { ...base, deviceId: { exact: deviceId } }
    : { ...base, facingMode: { ideal: facing } };
}

async function start() {
  haptic(12);
  setError('');
  ctaSpinner(true);
  try {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      video: _videoConstraints(quality, _manualDeviceId),
      audio: false,
    });

    const track = stream.getVideoTracks()[0];
    try { track.contentHint = 'motion'; } catch (e) {}
    $('v').srcObject = stream;

    // Quando l'OS uccide il track (schermo spento) → riavvio completo
    track.addEventListener('ended', () => {
      if (live) { setPill('Riconnessione…', 'bad'); setTimeout(start, 800); }
    });

    live = true;
    document.body.classList.add('streaming');
    setPill('Connessione…', '');
    setupCapabilities(track);
    _startWakeLockKeeper();
    _initBattery();
    _refreshCameraList();
    connect();
  } catch (e) {
    live = false;
    document.body.classList.remove('streaming');
    setError('Impossibile accedere alla camera: ' + e.message);
    ctaSpinner(false);
  }
}

function stop() {
  haptic(12);
  live = false;
  clearTimeout(retryT);
  clearInterval(statsTimer);
  if (pc) { pc.close(); pc = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  _stopWakeLockKeeper();
  closeSheet();
  document.body.classList.remove('streaming');
  $('v').srcObject = null;
  $('btnTorch').hidden = true;
  $('zoomRow').hidden = true;
  ctaSpinner(false);
}

/* Sostituisce il track video in corsa (camera diversa/qualità diversa) senza
   toccare la connessione WebRTC — nessun disconnect, nessun freeze percepito. */
async function _switchTrack(constraints) {
  const newStream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
  const newTrack = newStream.getVideoTracks()[0];
  try { newTrack.contentHint = 'motion'; } catch (e) {}
  newTrack.addEventListener('ended', () => {
    if (live) { setPill('Riconnessione…', 'bad'); setTimeout(start, 800); }
  });
  const sender = pc && pc.getSenders().find(s => s.track && s.track.kind === 'video');
  if (!sender) { newStream.getTracks().forEach(t => t.stop()); throw new Error('no sender'); }
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = newStream;
  $('v').srcObject = stream;
  await sender.replaceTrack(newTrack);
  setupCapabilities(newTrack);
  return newTrack;
}

async function flip() {
  haptic();
  facing = facing === 'environment' ? 'user' : 'environment';
  _manualDeviceId = null;
  $('cameraSelect').value = '';
  saveSettings();
  if (live && pc && pc.connectionState === 'connected') {
    try { await _switchTrack(_videoConstraints(quality, null)); return; }
    catch (e) {}
  }
  start();
}

/* ── Multi-camera: lista/selezione quando il telefono ha più di 2 obiettivi ── */
async function _refreshCameraList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    _cameras = devices.filter(d => d.kind === 'videoinput');
  } catch (e) { _cameras = []; }
  _renderCameraList();
}

function _renderCameraList() {
  const row = $('cameraRow'), sel = $('cameraSelect');
  if (_cameras.length <= 2) { row.hidden = true; return; }
  sel.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = ''; auto.textContent = 'Automatica';
  sel.appendChild(auto);
  _cameras.forEach((cam, i) => {
    const opt = document.createElement('option');
    opt.value = cam.deviceId;
    opt.textContent = cam.label || `Camera ${i + 1}`;
    sel.appendChild(opt);
  });
  sel.value = _manualDeviceId || '';
  row.hidden = false;
}

async function selectCamera(deviceId) {
  haptic();
  _manualDeviceId = deviceId || null;
  if (!live) return;
  if (pc && pc.connectionState === 'connected') {
    try { await _switchTrack(_videoConstraints(quality, _manualDeviceId)); return; }
    catch (e) {}
  }
  start();
}

/* ── Capacità: torcia + zoom ─────────────────────────────────────────────── */
function setupCapabilities(track) {
  let caps = {};
  try { caps = track.getCapabilities ? track.getCapabilities() : {}; } catch (e) {}

  const tb = $('btnTorch');
  if (caps.torch) { tb.hidden = false; }
  else { tb.hidden = true; tb.classList.remove('active'); tb.dataset.on = ''; }

  const zr = $('zoomRow'), z = $('zoom');
  if (caps.zoom && caps.zoom.max > caps.zoom.min) {
    zr.hidden = false;
    z.min = caps.zoom.min; z.max = caps.zoom.max; z.step = caps.zoom.step || 0.1;
    z.value = track.getSettings().zoom || caps.zoom.min;
  } else { zr.hidden = true; }
}

async function toggleTorch() {
  haptic();
  const track = stream && stream.getVideoTracks()[0];
  if (!track) return;
  const btn = $('btnTorch');
  const on = btn.dataset.on !== '1';
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] });
    btn.dataset.on = on ? '1' : '';
    btn.classList.toggle('active', on);
  } catch (e) {}
}

async function setZoom(val) {
  const track = stream && stream.getVideoTracks()[0];
  if (!track) return;
  try { await track.applyConstraints({ advanced: [{ zoom: parseFloat(val) }] }); } catch (e) {}
}

/* ── Sheet ───────────────────────────────────────────────────────────────── */
const openSheet  = () => { haptic(); $('sheet').classList.add('open'); $('scrim').classList.add('open'); };
const closeSheet = () => { $('sheet').classList.remove('open'); $('scrim').classList.remove('open'); };

async function setQuality(key, opts) {
  const auto = !!(opts && opts.auto);
  if (!auto) { haptic(); autoQuality = false; $('swAutoQuality').checked = false; }
  quality = key;
  // Pausa di 10s prima che la logica automatica rivaluti, dopo QUALSIASI cambio
  // (manuale o automatico) — evita che rivaluti su statistiche non ancora stabili.
  _autoBadCount = 0; _autoGoodCount = 0; _autoCooldownUntil = Date.now() + 10000;
  saveSettings();
  document.querySelectorAll('#seg button').forEach(b => b.classList.toggle('active', b.dataset.q === key));
  if (!live) return;
  if (pc && pc.connectionState === 'connected') {
    try {
      await _switchTrack(_videoConstraints(key, _manualDeviceId));
      await applyBitrate();
      return;
    } catch (e) {}
  }
  start();
}

function toggleAutoQuality(on) {
  haptic();
  autoQuality = on;
  _autoBadCount = 0; _autoGoodCount = 0; _autoCooldownUntil = Date.now() + 5000;
  saveSettings();
}

function toggleMirror(on) {
  haptic();
  mirror = on;
  saveSettings();
  fetch('/control', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mirror: on }),
  }).catch(() => {});
}

function toggleStats(on) { statsOn = on; saveSettings(); if (!on) setPill('Live', 'good'); }

/* ── WebRTC ──────────────────────────────────────────────────────────────── */
function preferH264(pc) {
  try {
    const caps = RTCRtpSender.getCapabilities('video');
    if (!caps) return;
    const h264 = caps.codecs.filter(c => /H264/i.test(c.mimeType));
    const rest = caps.codecs.filter(c => !/H264/i.test(c.mimeType));
    if (!h264.length) return;
    pc.getTransceivers().forEach(t => {
      if (t.sender && t.sender.track && t.sender.track.kind === 'video' && t.setCodecPreferences)
        t.setCodecPreferences([...h264, ...rest]);
    });
  } catch (e) {}
}

function boostBitrateSDP(sdp, kbps) {
  const out = []; let inVideo = false;
  for (const line of sdp.split('\r\n')) {
    out.push(line);
    if (line.startsWith('m=video')) inVideo = true;
    else if (line.startsWith('m=')) inVideo = false;
    if (inVideo && line.startsWith('c=')) {
      out.push('b=AS:' + kbps);
      out.push('b=TIAS:' + (kbps * 1000));
    }
  }
  return out.join('\r\n');
}

async function applyBitrate() {
  try {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (!sender) return;
    const p = sender.getParameters();
    if (!p.encodings || !p.encodings.length) p.encodings = [{}];
    p.encodings[0].maxBitrate     = BITRATE_KBPS * 1000;
    p.degradationPreference       = 'balanced';
    await sender.setParameters(p);
  } catch (e) {}
}

function _trackAlive() {
  return stream && stream.getVideoTracks().some(t => t.readyState === 'live');
}

function _smartReconnect() {
  if (!live) return;
  // Se il track camera è morto (schermo spento, OS l'ha killato) → start completo
  // Se è ancora vivo → basta riconnettersi WebRTC
  if (_trackAlive()) { connect(); } else { start(); }
}

async function connect() {
  clearTimeout(retryT);
  if (pc) pc.close();
  setPill('Connessione…', '');

  pc = new RTCPeerConnection({ iceServers: [], iceCandidatePoolSize: 2 });
  stream.getTracks().forEach(t => pc.addTrack(t, stream));
  preferH264(pc);

  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === 'connected') {
      setPill('Live', 'good');
      ctaSpinner(false);
      applyBitrate();
      startStats();
    } else if (st === 'disconnected' || st === 'failed') {
      setPill('Riconnessione…', 'bad');
      retryT = setTimeout(_smartReconnect, 800);
    }
  };

  const offer = await pc.createOffer();
  offer.sdp = boostBitrateSDP(offer.sdp, BITRATE_KBPS);
  await pc.setLocalDescription(offer);

  let r;
  try {
    r = await fetch('/offer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp: pc.localDescription.sdp, type: 'offer' }),
    });
  } catch (e) {
    setPill('Errore di rete', 'bad');
    retryT = setTimeout(_smartReconnect, 2000);
    return;
  }
  if (!r.ok) { setPill('Errore server', 'bad'); return; }
  await pc.setRemoteDescription(await r.json());
  await applyBitrate();
}

/* ── Statistiche + qualità connessione ───────────────────────────────────── */
let _lastBytes = 0, _lastTs = 0, _frozenTicks = 0, _lastFrames = 0;
let _autoBadCount = 0, _autoGoodCount = 0, _autoCooldownUntil = 0;

/* Cambia qualità da sola solo dopo diversi secondi CONSECUTIVI di rete
   davvero scarsa (mai per un singolo scatto) e torna su solo dopo un periodo
   lungo di rete buona — isteresi larga apposta per non "ballare" a caso.
   Si basa sugli fps reali rispetto al target: è il segnale più affidabile,
   a differenza del bitrate che varia anche solo per il contenuto inquadrato
   (una scena ferma usa meno banda pur con rete perfetta). */
function _autoAdjust(fps, target) {
  if (!autoQuality || Date.now() < _autoCooldownUntil) return;
  const bad  = fps < target * 0.6;
  const good = fps >= target * 0.92;
  if (bad)       { _autoBadCount++; _autoGoodCount = 0; }
  else if (good) { _autoGoodCount++; _autoBadCount = 0; }
  else           { _autoBadCount = 0; _autoGoodCount = 0; }

  const qi = QUALITY_ORDER.indexOf(quality);
  if (_autoBadCount >= 8 && qi < QUALITY_ORDER.length - 1) {
    setQuality(QUALITY_ORDER[qi + 1], { auto: true });
  } else if (_autoGoodCount >= 20 && qi > 0) {
    setQuality(QUALITY_ORDER[qi - 1], { auto: true });
  }
}

function startStats() {
  clearInterval(statsTimer);
  _lastBytes = 0; _lastTs = 0; _frozenTicks = 0; _lastFrames = 0;
  _autoBadCount = 0; _autoGoodCount = 0; _autoCooldownUntil = Date.now() + 6000;
  statsTimer = setInterval(async () => {
    if (!pc) return;
    try {
      const stats = await pc.getStats();
      stats.forEach(rep => {
        if (rep.type === 'outbound-rtp' && rep.kind === 'video') {
          const fps = rep.framesPerSecond || 0;
          const frames = rep.framesSent || 0;
          let mbps = 0;
          if (_lastTs) {
            const db = rep.bytesSent - _lastBytes;
            const dt = (rep.timestamp - _lastTs) / 1000;
            if (dt > 0) mbps = db * 8 / dt / 1e6;
          }
          _lastBytes = rep.bytesSent; _lastTs = rep.timestamp;

          // watchdog: se i frame non avanzano per 4s di fila → riconnetti
          if (frames === _lastFrames) {
            _frozenTicks++;
            if (_frozenTicks >= 4 && live) {
              _frozenTicks = 0;
              setPill('Riconnessione…', 'bad');
              _smartReconnect();
              return;
            }
          } else {
            _frozenTicks = 0;
          }
          _lastFrames = frames;

          const target = QUALITY[quality].fps;
          _autoAdjust(fps, target);
          let cls = 'good';
          if (fps < target * 0.5 || mbps < 1) cls = 'bad';
          else if (fps < target * 0.75 || mbps < 2.5) cls = 'warn';

          setPill(statsOn ? `${fps | 0} fps · ${mbps.toFixed(1)} Mbps` : 'Live', cls);
        }
      });
    } catch (e) {}
  }, 1000);
}

/* ── Eventi ──────────────────────────────────────────────────────────────── */
function refresh() {
  haptic(20);
  const btn = $('btnRefresh');
  btn.classList.add('active');
  stop();
  setTimeout(() => { btn.classList.remove('active'); start(); }, 400);
}

$('btnStart').onclick    = start;
$('btnFlip').onclick     = flip;
$('btnTorch').onclick    = toggleTorch;
$('btnRefresh').onclick  = refresh;
$('btnSettings').onclick = openSheet;
$('btnStop').onclick     = stop;
$('scrim').onclick       = closeSheet;
$('zoom').oninput        = e => setZoom(e.target.value);
$('swMirror').onchange   = e => toggleMirror(e.target.checked);
$('swStats').onchange    = e => toggleStats(e.target.checked);
$('swAutoQuality').onchange = e => toggleAutoQuality(e.target.checked);
$('cameraSelect').onchange  = e => selectCamera(e.target.value);
document.querySelectorAll('#seg button').forEach(b => b.onclick = () => setQuality(b.dataset.q));

/* ── Applica impostazioni salvate alla UI ─────────────────────────────────── */
document.querySelectorAll('#seg button').forEach(b => b.classList.toggle('active', b.dataset.q === quality));
$('swMirror').checked = mirror;
$('swStats').checked  = statsOn;
$('swAutoQuality').checked = autoQuality;
if (mirror) {
  fetch('/control', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mirror: true }),
  }).catch(() => {});
}
