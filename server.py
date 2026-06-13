#!/usr/bin/env python3
"""
CamLink — il tuo telefono diventa una webcam per il PC.

Architettura
------------
- Il telefono apre una PWA servita in HTTPS sulla rete locale e invia il video
  via WebRTC (aiortc) con la latenza piu' bassa possibile.
- Il PC riceve i frame e li inoltra alla OBS Virtual Camera (pyvirtualcam), che
  qualsiasi app (Discord, Zoom, Meet, OBS...) vede come una normale webcam.
- Una dashboard locale (HTTP su 127.0.0.1) mostra QR e stato in tempo reale.

Avvio:  python server.py
"""

from __future__ import annotations

import asyncio
import datetime
import io
import ipaddress
import os
import socket
import ssl
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

from aiohttp import web
from aiortc import RTCPeerConnection, RTCSessionDescription

# ── Configurazione ────────────────────────────────────────────────────────────

VERSION      = "1.0.0"
GITHUB_REPO  = "ImDennTV/CamLink"

HTTPS_PORT   = 8443          # porta per il telefono (richiede HTTPS per la camera)
DASH_PORT    = 8080          # dashboard locale del PC (solo 127.0.0.1, HTTP)
BITRATE_KBPS = 12000         # bitrate target sulla LAN (12 Mbps = massima nitidezza)
TARGET_FPS   = 60

# Path: in modalita' "frozen" (PyInstaller) i file statici stanno in _MEIPASS;
# i dati scrivibili (cert/chiave) vanno in %LOCALAPPDATA%\CamLink perche' la
# cartella d'installazione (Program Files) e' di sola lettura per l'utente.
_FROZEN = getattr(sys, 'frozen', False)
_BASE   = Path(getattr(sys, '_MEIPASS', Path(__file__).parent))
if _FROZEN:
    _DATA_DIR = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'CamLink'
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
else:
    _DATA_DIR = Path(__file__).parent
WEB    = _BASE / 'web'
ASSETS = _BASE / 'assets'
CERT   = _DATA_DIR / 'cert.pem'
KEY    = _DATA_DIR / 'key.pem'

_CONTENT_TYPES = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.svg': 'image/svg+xml', '.json': 'application/json',
    '.webmanifest': 'application/manifest+json', '.png': 'image/png',
    '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}


# ── Certificato self-signed ───────────────────────────────────────────────────

def make_cert(ips: list[str]) -> None:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    alt = list({ipaddress.IPv4Address(ip) for ip in [*ips, '127.0.0.1']})
    cert = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'CamLink')]))
        .issuer_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'CamLink')]))
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.now(datetime.timezone.utc))
        .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3650))
        .add_extension(x509.SubjectAlternativeName([x509.IPAddress(i) for i in alt]), critical=False)
        .sign(key, hashes.SHA256())
    )
    CERT.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    KEY.write_bytes(key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    ))
    print('[ssl] Certificato generato')


# ── Virtual camera ────────────────────────────────────────────────────────────

class VCam:
    """Modello "latest-frame": un thread dedicato invia sempre il frame piu'
    recente. Se il PC rimane indietro i frame intermedi vengono scartati, cosi'
    la latenza resta costante invece di accumularsi."""

    def __init__(self) -> None:
        self._cam     = None
        self._w       = 0
        self._h       = 0
        self._fps     = 0.0
        self._failed  = False
        self._mirror  = False
        self._lock    = threading.Lock()
        self._latest  = None
        self._event   = threading.Event()
        self._last_ts = 0.0
        self._running = True
        threading.Thread(target=self._run, daemon=True).start()

    def set_mirror(self, on: bool) -> None:
        self._mirror = bool(on)

    def submit(self, frame) -> None:
        with self._lock:
            self._latest = frame
        self._event.set()

    def status(self) -> dict:
        active = (time.monotonic() - self._last_ts) < 1.5 if self._last_ts else False
        return {
            'active': active,
            'width': self._w,
            'height': self._h,
            'fps': round(self._fps, 1),
            'failed': self._failed,
            'mirror': self._mirror,
        }

    def _run(self) -> None:
        ema = 0.0
        prev = 0.0
        while self._running:
            if not self._event.wait(timeout=1.0):
                continue
            self._event.clear()
            with self._lock:
                frame = self._latest
                self._latest = None
            if frame is None:
                continue

            now = time.monotonic()
            if prev:
                dt = now - prev
                if dt > 0:
                    inst = 1.0 / dt
                    ema = inst if ema == 0 else ema * 0.9 + inst * 0.1
                    self._fps = ema
            prev = now
            self._last_ts = now
            self._send(frame)

    def _send(self, frame) -> None:
        if self._failed:
            return
        if self._cam is None:
            w, h = frame.width, frame.height
            try:
                import pyvirtualcam
                self._cam = pyvirtualcam.Camera(
                    width=w, height=h, fps=TARGET_FPS,
                    fmt=pyvirtualcam.PixelFormat.BGR, print_fps=False,
                )
                self._cam.__enter__()
                self._w, self._h = w, h
                print(f'[cam] {w}x{h} @ {TARGET_FPS}fps  ->  virtual camera attiva')
            except Exception as e:
                self._failed = True
                print(f'\n[cam] ERRORE: {e}')
                print('[cam] Apri OBS Studio -> Strumenti -> Avvia Virtual Camera\n')
                return

        if frame.width != self._w or frame.height != self._h:
            frame = frame.reformat(width=self._w, height=self._h)
        arr = frame.to_ndarray(format='bgr24')
        if self._mirror:
            arr = arr[:, ::-1].copy()
        self._cam.send(arr)


_vcam = VCam()


# ── WebRTC ────────────────────────────────────────────────────────────────────

_pcs: set[RTCPeerConnection] = set()
_connected = False


async def _consume_video(track) -> None:
    print('[rtc] Track video ricevuto')
    while True:
        try:
            frame = await asyncio.wait_for(track.recv(), timeout=10.0)
            _vcam.submit(frame)
        except Exception as exc:
            if type(exc).__name__ not in ('TimeoutError', 'MediaStreamError', 'CancelledError'):
                print(f'[rtc] {type(exc).__name__}: {exc}')
            break
    print('[rtc] Track terminato')


async def route_offer(request: web.Request) -> web.Response:
    global _connected
    body  = await request.json()
    offer = RTCSessionDescription(sdp=body['sdp'], type=body['type'])

    for old in list(_pcs):            # un solo telefono: chiudi i precedenti
        _pcs.discard(old)
        await old.close()

    pc = RTCPeerConnection()
    _pcs.add(pc)

    @pc.on('track')
    def on_track(track):
        if track.kind == 'video':
            asyncio.ensure_future(_consume_video(track))

    @pc.on('connectionstatechange')
    async def on_state():
        global _connected
        s = pc.connectionState
        icons = {'connected': '[OK]', 'disconnected': '[--]', 'failed': '[!!]', 'closed': '[  ]'}
        print(f'[rtc] {icons.get(s, "[ ]")} {s}')
        _connected = any(p.connectionState == 'connected' for p in _pcs)
        if s in ('failed', 'closed', 'disconnected'):
            _pcs.discard(pc)
            _connected = any(p.connectionState == 'connected' for p in _pcs)

    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    loop = asyncio.get_running_loop()
    deadline = loop.time() + 8.0
    while pc.iceGatheringState != 'complete' and loop.time() < deadline:
        await asyncio.sleep(0.05)

    return web.json_response({'sdp': pc.localDescription.sdp, 'type': pc.localDescription.type})


async def route_control(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.Response(status=400, text='bad request')
    if 'mirror' in body:
        _vcam.set_mirror(body['mirror'])
    return web.json_response({'ok': True})


async def route_health(request: web.Request) -> web.Response:
    return web.json_response({
        'ok': True,
        'connected': _connected,
        'cam': _vcam.status(),
    })


# ── Static / pagine ───────────────────────────────────────────────────────────

def _file(name: str) -> web.Response:
    p = WEB / name
    data = p.read_bytes()
    ct = _CONTENT_TYPES.get(p.suffix, 'application/octet-stream')
    if ct.startswith(('text/', 'application/')) and 'octet' not in ct:
        return web.Response(text=data.decode('utf-8'), content_type=ct)
    return web.Response(body=data, content_type=ct)


def _page(name: str):
    async def handler(request: web.Request) -> web.Response:
        return _file(name)
    return handler


async def route_qr(request: web.Request) -> web.Response:
    import qrcode
    import qrcode.image.svg
    ip = _primary_ip()
    img = qrcode.make(
        f'https://{ip}:{HTTPS_PORT}',
        image_factory=qrcode.image.svg.SvgPathImage,
        box_size=11, border=2,
    )
    buf = io.BytesIO()
    img.save(buf)
    return web.Response(body=buf.getvalue(), content_type='image/svg+xml')


async def route_hostinfo(request: web.Request) -> web.Response:
    return web.json_response({
        'url': f'https://{_primary_ip()}:{HTTPS_PORT}',
        'ips': _local_ips(),
        'connected': _connected,
        'cam': _vcam.status(),
    })


# ── Network helpers ───────────────────────────────────────────────────────────

def _local_ips() -> list[str]:
    found: set[str] = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith('127.'):
                found.add(ip)
    except Exception:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        found.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    return sorted(found) or ['127.0.0.1']


def _primary_ip() -> str:
    """IP della LAN piu' probabile (preferisce 192.168.x / 10.x non-VPN)."""
    ips = _local_ips()
    for ip in ips:
        if ip.startswith('192.168.'):
            return ip
    for ip in ips:
        if ip.startswith('10.') and not ip.startswith('10.5.'):  # 10.5 = NordLynx
            return ip
    for ip in ips:
        if ip.startswith(('172.', '10.')):
            return ip
    return ips[0]


# ── Update check ─────────────────────────────────────────────────────────────

_update_info: dict = {}


def _parse_version(v: str) -> tuple:
    try:
        return tuple(int(x) for x in v.lstrip('v').split('.'))
    except Exception:
        return (0,)


async def _check_updates() -> None:
    if not GITHUB_REPO:
        return
    import aiohttp
    try:
        url = f'https://api.github.com/repos/{GITHUB_REPO}/releases/latest'
        async with aiohttp.ClientSession() as s:
            async with s.get(url, timeout=aiohttp.ClientTimeout(total=10),
                             headers={'Accept': 'application/vnd.github.v3+json'}) as r:
                if r.status != 200:
                    return
                data = await r.json()
        tag = data.get('tag_name', '')
        download_url = data.get('html_url', '')
        for asset in data.get('assets', []):
            if asset['name'].lower().endswith('.exe'):
                download_url = asset['browser_download_url']
                break
        global _update_info
        _update_info = {
            'current': VERSION,
            'latest': tag.lstrip('v'),
            'download_url': download_url,
            'update_available': _parse_version(tag) > _parse_version(VERSION),
        }
        if _update_info['update_available']:
            print(f'[update] Aggiornamento disponibile: v{_update_info["latest"]}')
    except Exception as e:
        print(f'[update] Check fallito: {e}')


async def route_update_info(request: web.Request) -> web.Response:
    return web.json_response(_update_info or {
        'current': VERSION, 'latest': VERSION,
        'download_url': '', 'update_available': False,
    })


# ── OBS auto-start ────────────────────────────────────────────────────────────

async def _obs_start_virtualcam() -> bool:
    import aiohttp
    try:
        async with aiohttp.ClientSession() as session:
            async with session.ws_connect('ws://localhost:4455',
                                          timeout=aiohttp.ClientTimeout(total=3.0)) as ws:
                msg = await asyncio.wait_for(ws.receive_json(), timeout=3.0)
                if msg.get('op') != 0 or msg.get('d', {}).get('authentication'):
                    return False
                await ws.send_json({'op': 1, 'd': {'rpcVersion': 1, 'eventSubscriptions': 0}})
                msg = await asyncio.wait_for(ws.receive_json(), timeout=3.0)
                if msg.get('op') != 2:
                    return False
                await ws.send_json({'op': 6, 'd': {'requestType': 'StartVirtualCam', 'requestId': '1'}})
                msg = await asyncio.wait_for(ws.receive_json(), timeout=3.0)
                return msg.get('d', {}).get('requestStatus', {}).get('code', 0) in (100, 703)
    except Exception:
        return False


# ── Banner ────────────────────────────────────────────────────────────────────

def _setup_io() -> None:
    """Rende l'output robusto: stdout puo' essere None (modalita' windowed) o
    usare un codepage non-UTF8 (cp1252) che farebbe crashare i print."""
    class _Null:
        def write(self, *a): return 0
        def flush(self): pass

    if sys.stdout is None:
        sys.stdout = _Null()
    if sys.stderr is None:
        sys.stderr = _Null()
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
        except Exception:
            pass


def _banner(ip: str) -> None:
    line = '=' * 50
    print('\n+' + line + '+')
    print('|' + '  CamLink'.ljust(50) + '|')
    print('+' + line + '+')
    print('|' + f'  Telefono:   https://{ip}:{HTTPS_PORT}'.ljust(50) + '|')
    print('|' + f'  Dashboard:  http://localhost:{DASH_PORT}'.ljust(50) + '|')
    print('+' + line + '+')
    print('  La dashboard si apre nel browser. Inquadra il QR col telefono.\n')


# ── Firewall (Windows) ────────────────────────────────────────────────────────

def _ensure_firewall() -> None:
    """Consente l'app nel firewall di Windows (TCP+UDP, profilo privato).

    Regola per-programma: copre la porta 8443 e tutte le porte UDP effimere che
    WebRTC usa per il video. Best-effort: se non si hanno i permessi admin non
    fa nulla (ci pensa l'installer in fase di installazione)."""
    if os.name != 'nt':
        return
    program = sys.executable
    name = 'CamLink'
    try:
        check = subprocess.run(
            ['netsh', 'advfirewall', 'firewall', 'show', 'rule', f'name={name}'],
            capture_output=True, text=True, timeout=5,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
        if 'CamLink' in check.stdout and program.lower() in check.stdout.lower():
            return  # regola gia' presente per questo eseguibile
        add = subprocess.run(
            ['netsh', 'advfirewall', 'firewall', 'add', 'rule', f'name={name}',
             'dir=in', 'action=allow', f'program={program}', 'enable=yes', 'profile=private'],
            capture_output=True, text=True, timeout=5,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
        if add.returncode == 0:
            print('[fw] Regola firewall aggiunta.')
    except Exception:
        pass  # niente permessi: ci pensa l'installer


# ── Tray icon (app senza console) ─────────────────────────────────────────────

def _tray_image():
    from PIL import Image
    png = ASSETS / 'icon.png'
    if png.exists():
        return Image.open(png)
    # fallback minimale
    img = Image.new('RGBA', (64, 64), (91, 141, 239, 255))
    return img


def _run_tray(dash_url: str) -> None:
    import pystray
    from pystray import Menu, MenuItem

    def open_dash(icon=None, item=None):
        try: webbrowser.open(dash_url)
        except Exception: pass

    def quit_app(icon, item):
        icon.stop()
        os._exit(0)

    icon = pystray.Icon(
        'CamLink', _tray_image(), 'CamLink',
        menu=Menu(
            MenuItem('Apri dashboard', open_dash, default=True),
            MenuItem('Esci', quit_app),
        ),
    )
    icon.run()


# ── Main ──────────────────────────────────────────────────────────────────────

def _build_app() -> web.Application:
    app = web.Application()
    r = app.router
    r.add_get('/',                     _page('index.html'))
    r.add_get('/host',                 _page('host.html'))
    r.add_get('/styles.css',           _page('styles.css'))
    r.add_get('/app.js',               _page('app.js'))
    r.add_get('/host.css',             _page('host.css'))
    r.add_get('/host.js',              _page('host.js'))
    r.add_get('/icon.svg',             _page('icon.svg'))
    r.add_get('/sw.js',                _page('sw.js'))
    r.add_get('/manifest.webmanifest', _page('manifest.webmanifest'))
    r.add_get('/qr.svg',               route_qr)
    r.add_get('/health',               route_health)
    r.add_get('/hostinfo',             route_hostinfo)
    r.add_post('/offer',               route_offer)
    r.add_post('/control',             route_control)
    r.add_get('/update-info',          route_update_info)
    app.on_shutdown.append(_on_shutdown)
    return app


async def _on_shutdown(_app: web.Application) -> None:
    for pc in list(_pcs):
        _pcs.discard(pc)
        await pc.close()


async def _serve(ready: threading.Event | None = None) -> None:
    ip = _primary_ip()

    if not CERT.exists() or not KEY.exists():
        print('[ssl] Generazione certificato...')
        make_cert(_local_ips())

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(CERT, KEY)

    _ensure_firewall()

    if await _obs_start_virtualcam():
        print('[obs] Virtual Camera avviata automaticamente.')
        await asyncio.sleep(0.4)

    app = _build_app()
    runner = web.AppRunner(app)
    await runner.setup()
    # Telefono (HTTPS, tutta la rete) + Dashboard (HTTP, solo locale)
    await web.TCPSite(runner, '0.0.0.0', HTTPS_PORT, ssl_context=ctx,
                      reuse_address=True).start()
    await web.TCPSite(runner, '127.0.0.1', DASH_PORT, reuse_address=True).start()

    _banner(ip)
    try:
        webbrowser.open(f'http://localhost:{DASH_PORT}/host')
    except Exception:
        pass

    asyncio.ensure_future(_check_updates())
    print('[server] Pronto.\n')
    if ready:
        ready.set()
    await asyncio.Event().wait()


def _want_tray() -> bool:
    """Modalita' tray (senza console) quando impacchettato, o con --tray."""
    if '--console' in sys.argv:
        return False
    if '--tray' in sys.argv:
        return True
    return _FROZEN


def main() -> None:
    _setup_io()
    dash_url = f'http://localhost:{DASH_PORT}/host'

    if _want_tray():
        # Server nel thread di background; tray sul thread principale.
        ready = threading.Event()

        def run_loop():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(_serve(ready))
            except Exception as e:
                print(f'[server] errore: {e}')

        threading.Thread(target=run_loop, daemon=True).start()
        ready.wait(timeout=15)
        try:
            _run_tray(dash_url)
        except Exception as e:
            print(f'[tray] non disponibile ({e}); resto attivo in background.')
            threading.Event().wait()
    else:
        try:
            asyncio.run(_serve())
        except KeyboardInterrupt:
            print('\n[bye]')


if __name__ == '__main__':
    main()
