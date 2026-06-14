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

let pc, stream, retryT, statsTimer, wakeLock;
let facing  = 'environment';
let quality = '720p60';
let statsOn = true;
let live    = false;

/* ── Service worker (installabilità PWA) ─────────────────────────────────── */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

/* ── Wake lock: schermo sempre acceso mentre si trasmette ────────────────── */
async function acquireWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); }
  catch (e) {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && live) acquireWakeLock();
});

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
async function start() {
  haptic(12);
  setError('');
  ctaSpinner(true);
  const q = QUALITY[quality];
  try {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facing },
        width:      { ideal: q.w },
        height:     { ideal: q.h },
        frameRate:  { ideal: q.fps },
      },
      audio: false,
    });

    const track = stream.getVideoTracks()[0];
    try { track.contentHint = 'motion'; } catch (e) {}
    $('v').srcObject = stream;

    live = true;
    document.body.classList.add('streaming');
    setPill('Connessione…', '');
    setupCapabilities(track);
    acquireWakeLock();
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
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  closeSheet();
  document.body.classList.remove('streaming');
  $('v').srcObject = null;
  $('btnTorch').hidden = true;
  $('zoomRow').hidden = true;
  ctaSpinner(false);
}

async function flip() {
  haptic();
  facing = facing === 'environment' ? 'user' : 'environment';
  if (live && pc && pc.connectionState === 'connected') {
    try {
      const q = QUALITY[quality];
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps } },
        audio: false,
      });
      const newTrack = newStream.getVideoTracks()[0];
      try { newTrack.contentHint = 'motion'; } catch (e) {}
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        if (stream) stream.getTracks().forEach(t => t.stop());
        stream = newStream;
        $('v').srcObject = stream;
        await sender.replaceTrack(newTrack);
        setupCapabilities(newTrack);
        return;
      }
    } catch (e) {}
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

async function setQuality(key) {
  haptic();
  quality = key;
  document.querySelectorAll('#seg button').forEach(b => b.classList.toggle('active', b.dataset.q === key));
  if (!live) return;
  if (pc && pc.connectionState === 'connected') {
    try {
      const q = QUALITY[key];
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps } },
        audio: false,
      });
      const newTrack = newStream.getVideoTracks()[0];
      try { newTrack.contentHint = 'motion'; } catch (e) {}
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        if (stream) stream.getTracks().forEach(t => t.stop());
        stream = newStream;
        $('v').srcObject = stream;
        await sender.replaceTrack(newTrack);
        await applyBitrate();
        setupCapabilities(newTrack);
        return;
      }
    } catch (e) {}
  }
  start();
}

function toggleMirror(on) {
  haptic();
  fetch('/control', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mirror: on }),
  }).catch(() => {});
}

function toggleStats(on) { statsOn = on; if (!on) setPill('Live', 'good'); }

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
      retryT = setTimeout(connect, 1500);
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
    retryT = setTimeout(connect, 2000);
    return;
  }
  if (!r.ok) { setPill('Errore server', 'bad'); return; }
  await pc.setRemoteDescription(await r.json());
  await applyBitrate();
}

/* ── Statistiche + qualità connessione ───────────────────────────────────── */
let _lastBytes = 0, _lastTs = 0, _frozenTicks = 0, _lastFrames = 0;
function startStats() {
  clearInterval(statsTimer);
  _lastBytes = 0; _lastTs = 0; _frozenTicks = 0; _lastFrames = 0;
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
              connect();
              return;
            }
          } else {
            _frozenTicks = 0;
          }
          _lastFrames = frames;

          const target = QUALITY[quality].fps;
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
document.querySelectorAll('#seg button').forEach(b => b.onclick = () => setQuality(b.dataset.q));
