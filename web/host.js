/* ── CamLink · host dashboard ─────────────────────────────────────────────── */
'use strict';

const $ = id => document.getElementById(id);

function fmtUptime(sec) {
  sec = Math.max(0, sec | 0);
  const m = (sec / 60) | 0, s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ── Grafico live fps/Mbps ─────────────────────────────────────────────────── */
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

  const drawLine = (data, maxVal, color) => {
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (MAXH - 1)) * w;
      const y = h - (Math.min(v, maxVal) / maxVal) * (h * 0.88) - h * 0.06;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * dpr;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  drawLine(_mbpsHist, Math.max(6, ...(_mbpsHist.length ? _mbpsHist : [6])), '#5b8def');
  drawLine(_fpsHist, 60, '#22c55e');
}

async function poll() {
  try {
    const r = await fetch('/hostinfo', { cache: 'no-store' });
    const d = await r.json();

    $('url').textContent = d.url;

    const cam = d.cam || {};
    const net = d.net || {};
    const battery = d.battery || {};
    const row = $('statusRow');
    const active = d.connected && cam.active;

    if (active) {
      row.className = 'status connected';
      $('statusText').textContent = 'Telefono connesso';
      const res = cam.width ? `${cam.width}×${cam.height}` : '';
      const fps = cam.fps ? ` · ${cam.fps} fps` : '';
      const up = d.uptime ? ` · ${fmtUptime(d.uptime)}` : '';
      $('statusMeta').textContent = res + fps + up;
    } else if (d.connected) {
      row.className = 'status connected';
      $('statusText').textContent = 'Connesso, in attesa del video…';
      $('statusMeta').textContent = '';
    } else {
      row.className = 'status waiting';
      $('statusText').textContent = 'In attesa del telefono…';
      $('statusMeta').textContent = '';
    }

    const battEl = $('battInfo');
    if (battery.level != null) {
      const pct = Math.round(battery.level * 100);
      $('battPct').textContent = battery.charging ? `${pct}% (in carica)` : `${pct}%`;
      battEl.className = 'batt' + (battery.charging ? ' charging' : pct <= 20 ? ' low' : '');
      battEl.hidden = false;
    } else {
      battEl.hidden = true;
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
