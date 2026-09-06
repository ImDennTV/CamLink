/* ── CamLink · host dashboard ─────────────────────────────────────────────── */
'use strict';

const $ = id => document.getElementById(id);

function fmtUptime(sec) {
  sec = Math.max(0, sec | 0);
  const m = (sec / 60) | 0, s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ── Grafico live fps/Mbps con assi numerati ──────────────────────────────── */
const MAXH = 60;
const _fpsHist = [], _mbpsHist = [];

function drawGraph() {
  const canvas = $('graph');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width  = canvas.clientWidth * dpr;
  const h = canvas.height = canvas.clientHeight * dpr;
  ctx.clearRect(0, 0, w, h);
  if (_fpsHist.length < 2) return;

  const padL = 30 * dpr, padR = 38 * dpr, padT = 10 * dpr, padB = 4 * dpr;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const fpsMax  = Math.max(60, ..._fpsHist);
  const mbpsMax = Math.max(2, ..._mbpsHist);

  ctx.font = `${10 * dpr}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  [0, 0.5, 1].forEach(f => {
    const y = padT + plotH * (1 - f);
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();

    ctx.fillStyle = '#22c55e'; ctx.textAlign = 'right';
    ctx.fillText(String(Math.round(fpsMax * f)), padL - 6 * dpr, y);

    ctx.fillStyle = '#5b8def'; ctx.textAlign = 'left';
    ctx.fillText((Math.round(mbpsMax * f * 10) / 10).toString(), padL + plotW + 6 * dpr, y);
  });

  const drawLine = (data, maxVal, color) => {
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = padL + (i / (data.length - 1 || 1)) * plotW;
      const y = padT + plotH - (Math.min(v, maxVal) / maxVal) * plotH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * dpr;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  drawLine(_mbpsHist, mbpsMax, '#5b8def');
  drawLine(_fpsHist, fpsMax, '#22c55e');
}

/* ── Preview live (MJPEG, solo mentre il telefono e' connesso e attivo) ───── */
let _previewOn = false;
function setPreview(on) {
  if (on === _previewOn) return;
  _previewOn = on;
  const img = $('preview');
  if (on) {
    img.src = '/preview.mjpg?_=' + Date.now();
  } else {
    img.src = '';
    img.removeAttribute('src');
  }
}

async function poll() {
  try {
    const r = await fetch('/hostinfo', { cache: 'no-store' });
    const d = await r.json();

    $('url').textContent = d.url;

    const cam = d.cam || {};
    const net = d.net || {};
    const battery = d.battery || {};
    const active = d.connected && cam.active;

    // Badge di stato
    const badge = $('statusBadge');
    badge.className = 'badge' + (d.connected ? ' connected' : '');
    $('statusText').textContent = d.connected
      ? (active ? 'Connesso' : 'In attesa del video…')
      : 'In attesa';

    // Box principale: QR (non connesso) <-> preview live (connesso e attivo)
    $('idleInfo').hidden = d.connected;
    $('connectedInfo').hidden = !d.connected;
    if (d.connected) {
      $('resLine').textContent = cam.width ? `${cam.width}×${cam.height}` : 'In attesa del video…';
      $('codecLine').textContent = [
        d.quality || null,
        cam.mirror ? 'specchiato' : null,
      ].filter(Boolean).join(' · ');
      $('uptimeLine').textContent = d.uptime ? `Connesso da ${fmtUptime(d.uptime)}` : '';
    }

    $('qr').hidden = active;
    $('preview').hidden = !active;
    $('visualTag').hidden = !active;
    document.querySelector('.visualBox').classList.toggle('live', active);
    setPreview(active);

    // Tessere statistiche
    $('statTiles').hidden = !active;
    if (active) {
      $('tFps').textContent = cam.fps ?? '–';
      $('tMbps').textContent = net.mbps != null ? net.mbps.toFixed(1) : '–';
      $('tLoss').textContent = net.lossPercent != null ? `${net.lossPercent}%` : '–';
      $('tJitter').textContent = net.jitterMs != null ? `${net.jitterMs}ms` : '–';
      const tileBatt = $('tileBatt');
      if (battery.level != null) {
        tileBatt.hidden = false;
        const pct = Math.round(battery.level * 100);
        $('tBatt').textContent = battery.charging ? `${pct}%+` : `${pct}%`;
      } else {
        tileBatt.hidden = true;
      }
    }

    $('obsWarn').hidden = !cam.failed;

    $('graphWrap').hidden = !active;
    if (active) {
      _fpsHist.push(cam.fps || 0);
      _mbpsHist.push(net.mbps || 0);
      if (_fpsHist.length > MAXH) _fpsHist.shift();
      if (_mbpsHist.length > MAXH) _mbpsHist.shift();
      drawGraph();
    } else {
      _fpsHist.length = 0; _mbpsHist.length = 0;
    }
  } catch (e) {
    /* server in fase di avvio o chiuso: riprova al prossimo giro */
  }
}

function copyUrl() {
  const text = $('url').textContent;
  navigator.clipboard?.writeText(text).then(() => {
    const t = $('toast');
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1600);
  }).catch(() => {});
}

async function checkUpdate() {
  try {
    const r = await fetch('/update-info', { cache: 'no-store' });
    const d = await r.json();
    $('versionLabel').textContent = d.current ? `v${d.current}` : '';
    if (d.update_available) {
      $('updateVer').textContent = `v${d.current} → v${d.latest}`;
      $('updateBtn').href = d.download_url;
      $('updateBanner').hidden = false;
    }
  } catch (e) {}
}

$('url').onclick = copyUrl;
poll();
setInterval(poll, 1000);
checkUpdate();
setInterval(checkUpdate, 5 * 60 * 1000);
