; Installeur Windows de l'Atelier MTG (Inno Setup 6), assemblé par installeur/construire.py qui passe VERSION, SOURCE et DEPOT.
; Tout va dans le dossier de l'utilisateur (%LOCALAPPDATA%\Programs\Atelier MTG), sans droits d'administrateur : le code,
; son Python, puis les decks, le classeur et les réglages que l'Atelier y crée. Une mise à jour remplace le code et
; laisse le reste ; la désinstallation demande avant d'effacer les decks.

#ifndef VERSION
  #define VERSION "0.0.0"
#endif
#ifndef SOURCE
  #define SOURCE "..\construction\app"
#endif
#ifndef DEPOT
  #define DEPOT "PierreRibeaucourt/atelier-mtg"
#endif
#define PYW "{app}\python\pythonw.exe"
#define APPPY "{app}\outils\atelier\app.py"
#define ICONE "{app}\outils\atelier\atelier.ico"

[Setup]
AppId={{73548744-DBCD-44A6-B03D-047D8E7971B2}
AppName=Atelier MTG
AppVersion={#VERSION}
AppVerName=Atelier MTG {#VERSION}
AppPublisher={#Copy(DEPOT, 1, Pos("/", DEPOT) - 1)}
AppPublisherURL=https://github.com/{#DEPOT}
AppUpdatesURL=https://github.com/{#DEPOT}/releases
VersionInfoVersion={#VERSION}
DefaultDirName={userpf}\Atelier MTG
PrivilegesRequired=lowest
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
WizardStyle=modern
ShowLanguageDialog=no
SetupIconFile={#SOURCE}\outils\atelier\atelier.ico
UninstallDisplayIcon={#ICONE}
UninstallDisplayName=Atelier MTG
OutputBaseFilename=Atelier-MTG-Windows
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no
SetupLogging=yes

[Languages]
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"

; une mise à jour repart d'un code propre : rien ne reste d'un fichier supprimé entre deux versions
[InstallDelete]
Type: filesandordirs; Name: "{app}\python"
Type: filesandordirs; Name: "{app}\connaissances"
Type: filesandordirs; Name: "{app}\outils\atelier\static"
Type: files; Name: "{app}\outils\atelier\*.py"
Type: files; Name: "{app}\outils\*.py"
Type: filesandordirs; Name: "{app}\outils\atelier\__pycache__"
Type: filesandordirs; Name: "{app}\outils\__pycache__"

[Files]
Source: "{#SOURCE}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userdesktop}\Atelier MTG"; Filename: "{#PYW}"; Parameters: """{#APPPY}"""; WorkingDir: "{app}"; IconFilename: "{#ICONE}"; Comment: "Atelier MTG"
Name: "{userprograms}\Atelier MTG"; Filename: "{#PYW}"; Parameters: """{#APPPY}"""; WorkingDir: "{app}"; IconFilename: "{#ICONE}"; Comment: "Atelier MTG"

; le lien atelier-mtg:// (bouton « Lancer l'Atelier » de la page hors ligne) : enregistré par l'Atelier, retiré avec lui
[Registry]
Root: HKCU; Subkey: "Software\Classes\atelier-mtg"; Flags: uninsdeletekey dontcreatekey

[Run]
Filename: "{#PYW}"; Parameters: """{#APPPY}"""; WorkingDir: "{app}"; Description: "{cm:LaunchProgram,Atelier MTG}"; Flags: postinstall nowait skipifsilent
; mise à jour lancée par l'Atelier (silencieuse) : il revient dans la barre d'état et la page ouverte se recharge
Filename: "{#PYW}"; Parameters: """{#APPPY}"" --sans-navigateur"; WorkingDir: "{app}"; Flags: nowait skipifnotsilent

; les caches se reconstruisent : ils partent avec le programme ; decks, classeur, réglages et discussions restent
[UninstallDelete]
Type: filesandordirs; Name: "{app}\python"
Type: files; Name: "{app}\outils\cache_cartes.json"
Type: files; Name: "{app}\outils\atelier\cache_*.json"
Type: files; Name: "{app}\outils\atelier\base_cartes.json.gz*"
Type: files; Name: "{app}\outils\atelier\mtgpics.json"
Type: files; Name: "{app}\outils\atelier\atelier.log"
Type: files; Name: "{app}\outils\atelier\connexion_github.dat"
Type: files; Name: "{app}\outils\atelier\publication_github.json"
Type: filesandordirs; Name: "{app}\outils\atelier\__pycache__"
Type: filesandordirs; Name: "{app}\outils\__pycache__"
Type: files; Name: "{userstartup}\Atelier MTG.lnk"

[Code]
// arrête l'Atelier lancé depuis ce dossier (et lui seul) : ses fichiers peuvent alors être remplacés ou effacés
procedure ArreterAtelier();
var
  Dossier: String;
  Code: Integer;
begin
  Dossier := ExpandConstant('{app}') + '\';
  StringChangeEx(Dossier, '''', '''''', True);
  Exec('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -Command "Get-Process python,pythonw -ErrorAction SilentlyContinue | '
    + 'Where-Object { $_.Path -and $_.Path.StartsWith(''' + Dossier + ''', ''OrdinalIgnoreCase'') } | Stop-Process -Force"',
    '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  ArreterAtelier();
  Result := '';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    ArreterAtelier();
  if (CurUninstallStep = usPostUninstall) and not UninstallSilent and DirExists(ExpandConstant('{app}')) then
    if MsgBox('Supprimer aussi tes decks, ton classeur et tes réglages ?', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      DelTree(ExpandConstant('{app}'), True, True, True);
end;
