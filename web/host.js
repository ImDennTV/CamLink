/* ── CamLink · host dashboard ─────────────────────────────────────────────── */
'use strict';

const $ = id => document.getElementById(id);

async function poll() {
  try {
    const r = await fetch('/hostinfo', { cache: 'no-store' });
    const d = await r.json();

    $('url').textContent = d.url;

    const cam = d.cam || {};
    const row = $('statusRow');
    if (d.connected && cam.active) {
      row.className = 'status connected';
      $('statusText').textContent = 'Telefono connesso';
      const res = cam.width ? `${cam.width}×${cam.height}` : '';
      const fps = cam.fps ? ` · ${cam.fps} fps` : '';
      $('statusMeta').textContent = res + fps;
    } else if (d.connected) {
      row.className = 'status connected';
      $('statusText').textContent = 'Connesso, in attesa del video…';
      $('statusMeta').textContent = '';
    } else {
      row.className = 'status waiting';
      $('statusText').textContent = 'In attesa del telefono…';
      $('statusMeta').textContent = '';
    }

    $('obsWarn').hidden = !cam.failed;
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
