; ── CamLink · Inno Setup installer ─────────────────────────────────────────
;
; Crea un installer .exe professionale (wizard) che:
;   - installa l'app in Program Files
;   - crea i collegamenti (Start Menu + Desktop)
;   - aggiunge la regola firewall automaticamente (TCP+UDP)
;   - rimuove tutto (firewall incluso) alla disinstallazione
;
; Prerequisito: PyInstaller ha gia' prodotto  build\dist\CamLink\
; Compila con:  iscc installer\CamLink.iss   (o tramite build\build.ps1)

#define AppName "CamLink"
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppPublisher "CamLink"
#define AppExe "CamLink.exe"

[Setup]
AppId={{8C3B2A41-9D5E-4C2A-BF11-CAM11NK00001}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=CamLink-Setup
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "it"; MessagesFile: "compiler:Languages\Italian.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Crea un collegamento sul desktop"; GroupDescription: "Collegamenti:"

[Files]
Source: "..\build\dist\CamLink\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#AppName}";        Filename: "{app}\{#AppExe}"; IconFilename: "{app}\{#AppExe}"
Name: "{group}\Disinstalla {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}";  Filename: "{app}\{#AppExe}"; IconFilename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
; Regola firewall (per-programma: copre 8443 TCP + porte UDP di WebRTC)
Filename: "{sys}\netsh.exe"; \
  Parameters: "advfirewall firewall add rule name=""CamLink"" dir=in action=allow program=""{app}\{#AppExe}"" enable=yes profile=any"; \
  Flags: runhidden
; Avvio dopo l'installazione
Filename: "{app}\{#AppExe}"; Description: "Avvia {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""CamLink"""; Flags: runhidden; RunOnceId: "DelFwRule"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Exec('taskkill.exe', '/F /IM CamLink.exe /T', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(1200);
  Result := '';
end;

[UninstallDelete]
; rimuove i dati locali (certificato)
Type: filesandordirs; Name: "{localappdata}\CamLink"
