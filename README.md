# CamLink

Trasforma il telefono in una **webcam per il PC** — nitida, fluida e a bassa
latenza. Il telefono inquadra, il video arriva al PC via WebRTC sulla rete
locale e diventa una webcam virtuale usabile in **Discord, Zoom, Meet, OBS**…

Niente cloud, niente account, niente watermark: tutto resta sulla tua rete.

```
┌──────────────┐    WebRTC (LAN, HTTPS)    ┌──────────────────────────┐
│   Telefono   │ ────────────────────────► │  PC: CamLink             │
│  (PWA, cam)  │                           │  → OBS Virtual Camera    │
└──────────────┘                           │  → Discord / Zoom / Meet │
                                           └──────────────────────────┘
```

## Per gli utenti (installazione)

1. Scarica **`CamLink-Setup.exe`** e installalo (un click; aggiunge da solo la
   regola del firewall, nessuna configurazione manuale).
2. Avvia **CamLink**: gira in background con un'**icona nella tray** (vicino
   all'orologio) e apre la **dashboard** nel browser con un **QR code**.
3. Sul telefono inquadra il QR (stessa WiFi del PC), accetta l'avviso del
   certificato (*Avanzate → Procedi*) e tocca **Avvia**.
4. In Discord/Zoom/Meet seleziona **“OBS Virtual Camera”**.

> Serve **OBS Studio** installato (fornisce la Virtual Camera). CamLink la avvia
> da solo se in OBS abiliti *Strumenti → Server WebSocket* (porta 4455, senza
> password); altrimenti avviala a mano da *Strumenti → Avvia Virtual Camera*.

L'icona nella tray ha il menu **Apri dashboard** ed **Esci**.

## Funzioni

- **Bassa latenza**: H.264 hardware, modello *latest-frame* lato server (la
  latenza resta costante, non si accumula).
- **Alta qualità**: bitrate fino a 12 Mbps sulla LAN, fino a 1080p60.
- **Controlli dal telefono**: cambio camera, torcia, zoom, specchia, qualità.
- **PWA installabile**: dal telefono *“Aggiungi a schermata Home”* → app a
  schermo intero.
- **Wake lock**: lo schermo del telefono non si spegne durante lo streaming.
- **Firewall automatico** e **dashboard** con stato in tempo reale.

## Per gli sviluppatori (dai sorgenti)

Requisiti: Python 3.10+ e le dipendenze.

```bash
pip install -r requirements.txt
python server.py            # modalità console (sviluppo)
python server.py --tray     # prova la modalità tray senza impacchettare
```

Doppio click su **`Avvia CamLink.bat`** prepara il venv e avvia (utile senza
toccare il terminale).

## Creare l'installer

```powershell
powershell -ExecutionPolicy Bypass -File build\build.ps1
```

La pipeline genera l'icona, impacchetta l'eseguibile windowless con PyInstaller
e crea l'installer con Inno Setup (installato via winget se manca):

- Eseguibile:  `build\dist\CamLink\CamLink.exe`
- **Installer:  `installer\output\CamLink-Setup.exe`** ← questo dai agli amici.

## Struttura

```
server.py                 backend (aiohttp + aiortc + pyvirtualcam) + tray
web/                      frontend
  index.html / styles.css / app.js    PWA del telefono
  host.html / host.css / host.js      dashboard del PC
  manifest.webmanifest / sw.js / icon.svg
assets/icon.ico|png       icona app/tray/installer (generata)
installer/CamLink.iss     script Inno Setup (wizard + firewall)
build/build.ps1           pipeline completa (exe + installer)
build/make_icon.py        generatore icona
Avvia CamLink.bat         launcher one-click dai sorgenti
requirements.txt
```

## Problemi comuni

| Sintomo | Soluzione |
|---|---|
| Il telefono non apre la pagina | Stessa WiFi? NordVPN: abilita *Allow LAN traffic*. (Il firewall lo gestisce l'installer.) |
| “Virtual Camera non attiva” | Apri OBS → *Strumenti → Avvia Virtual Camera*. |
| La webcam non compare in Discord | Riavvia Discord dopo aver avviato la Virtual Camera. |
| Avviso certificato sul telefono | Normale (certificato locale): *Avanzate → Procedi*. |

## Privacy

Il flusso video viaggia **solo** tra telefono e PC sulla rete locale (WebRTC
peer-to-peer, HTTPS). Nessun server esterno, nessuna registrazione.
