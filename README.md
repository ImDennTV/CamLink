<div align="center">

<img src="web/icon.svg" width="96" height="96" alt="CamLink icon">

# CamLink

**Trasforma il tuo telefono in una webcam professionale per il PC.**
Zero latenza, zero watermark, zero cloud. Solo la tua rete locale.

[![Versione](https://img.shields.io/github/v/release/ImDennTV/CamLink?style=flat-square&color=5b8def&label=versione)](https://github.com/ImDennTV/CamLink/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows-blue?style=flat-square&color=845cf6)](https://github.com/ImDennTV/CamLink/releases/latest)
[![Licenza](https://img.shields.io/badge/licenza-MIT-green?style=flat-square)](LICENSE)

### [⬇️ Scarica l'installer](https://github.com/ImDennTV/CamLink/releases/latest)

</div>

---

## Come funziona

```
📱 Telefono                            💻 PC
┌─────────────────┐   WebRTC (WiFi)   ┌──────────────────────────┐
│  PWA (browser)  │ ────────────────► │  CamLink                 │
│  Camera live    │   HTTPS · LAN     │  → OBS Virtual Camera    │
│  H.264 · 60fps  │                   │  → Discord / Zoom / Meet │
└─────────────────┘                   └──────────────────────────┘
```

Il telefono apre una web app e trasmette il video via **WebRTC** direttamente al PC sulla rete locale.
Il PC riceve il flusso e lo espone come **webcam virtuale** a qualsiasi app.
Nessun server esterno, nessun account, nessuna latenza di rete internet.

---

## Installazione

> **Requisito:** [OBS Studio](https://obsproject.com/) installato (fornisce la Virtual Camera)

### 1. Scarica e installa

**[→ Scarica CamLink-Setup.exe](https://github.com/ImDennTV/CamLink/releases/latest)**

Doppio click sull'installer → Avanti → Fine.
Aggiunge automaticamente la regola firewall e crea il collegamento nel menu Start.

> Se Windows mostra "PC protetto": clicca **Ulteriori informazioni** → **Esegui comunque**

### 2. Avvia CamLink

Appare l'icona nella **barra delle applicazioni** (vicino all'orologio) e si apre la dashboard nel browser.

### 3. Connetti il telefono

- Stessa rete WiFi del PC
- Inquadra il **QR code** dalla dashboard con la fotocamera
- Alla prima apertura: accetta l'avviso del certificato → *Avanzate* → *Procedi*
- Tocca **Avvia**

### 4. Seleziona la webcam

In Discord, Zoom, Meet o OBS scegli **"OBS Virtual Camera"** come sorgente video.

---

## Funzionalità

| | |
|---|---|
| **Bassa latenza** | WebRTC peer-to-peer sulla LAN, modello *latest-frame* lato server |
| **Alta qualità** | H.264 hardware, fino a 1080p · bitrate fino a 12 Mbps |
| **Controlli live** | Cambia camera, torcia, zoom, specchio, qualità, refresh istantaneo |
| **PWA installabile** | Dal telefono: *"Aggiungi a schermata Home"* → app a schermo intero |
| **Wake lock** | Lo schermo del telefono non si spegne durante lo streaming |
| **Firewall automatico** | L'installer apre le porte necessarie senza configurazione manuale |
| **Dashboard locale** | Stato connessione in tempo reale, QR code, avviso OBS |
| **Aggiornamenti automatici** | Notifica nella dashboard quando è disponibile una nuova versione |

---

## Problemi comuni

| Sintomo | Soluzione |
|---|---|
| Il telefono non apre la pagina | Stessa WiFi? NordVPN: abilita *Allow LAN traffic* |
| Avviso certificato sul telefono | Normale — *Avanzate → Procedi* |
| "Virtual Camera non attiva" | OBS → *Strumenti → Avvia Virtual Camera* |
| La webcam non compare in Discord | Riavvia Discord dopo aver avviato la Virtual Camera |
| Video pixelato / che si blocca | Usa la camera **posteriore** — ha encoder hardware migliore |
| Windows blocca l'installer | *Ulteriori informazioni → Esegui comunque* (nessun certificato commerciale) |

---

## Privacy

Il flusso video viaggia **solo** tra telefono e PC sulla rete locale (WebRTC peer-to-peer, HTTPS).
Nessun server esterno, nessuna registrazione, nessun dato trasmesso su internet.

---

## Per sviluppatori

<details>
<summary>Build dai sorgenti</summary>

**Requisiti:** Python 3.10+

```bash
pip install -r requirements.txt
python server.py            # console (sviluppo)
python server.py --tray     # tray senza impacchettare
```

Doppio click su `Avvia CamLink.bat` per un avvio rapido con venv automatico.

**Build completa (exe + installer):**

```powershell
powershell -ExecutionPolicy Bypass -File build\build.ps1
```

Produce:
- `build\dist\CamLink\CamLink.exe` — eseguibile standalone
- `installer\output\CamLink-Setup.exe` — **installer da distribuire**

</details>

<details>
<summary>Struttura del progetto</summary>

```
server.py                   backend (aiohttp + aiortc + pyvirtualcam + pystray)
web/
  index.html / styles.css / app.js     PWA telefono
  host.html / host.css / host.js       dashboard PC
  manifest.webmanifest / sw.js / icon.svg
assets/                     icone generate (non in repo)
installer/CamLink.iss       script Inno Setup
build/build.ps1             pipeline completa
build/make_icon.py          generatore icona
requirements.txt
```

</details>
