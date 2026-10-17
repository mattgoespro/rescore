# Windows lifecycle revision

## Storage and ownership

| Location | Contents | Creation and removal |
| --- | --- | --- |
| Desktop install folder, normally `%ProgramFiles%\Rescore` | Electron executable, renderer/preload, packaged API payload, maintenance helper, uninstaller, logs launcher | NSIS installs/updates it; uninstall removes it after service removal. |
| `%ProgramFiles%\Rescore Catalogue\<ID>` | Protected service executable and versioned API code | Maintenance stages/checks it before switching SCM; retires previous code after commit; uninstall removes service code. Independent of desktop updates. |
| `%ProgramData%\Rescore` | Protected service registration/configuration, operation lock, versioned shared catalogue directories and logs | Maintenance creates it. Default uninstall retains data and logs. Explicit catalogue deletion removes data directories and designated recovery copies. |
| `%APPDATA%\Rescore` | Per-user app settings/history, original desktop catalogue and any previous recovery copies | Desktop creates settings on launch. Setup captures the requesting profile before elevation. Settings survive uninstall. Original catalogue is an initial migration source; a retained shared catalogue takes precedence on reinstall. |

The single service remains `RescoreCatalogue`, displayed as **Rescore API**, running as `NT SERVICE\RescoreCatalogue`. Executable directories permit writes only by administrators/SYSTEM. The service can modify its selected shared data and logs, and read its protected configuration/code.

## Operation contract

1. **Setup/reinstall:** NSIS calls the GUI helper directly. One maintenance lock covers registration and reconciliation. Identical setup reuses the catalogue/runtime. Missing service files or SCM registration are repaired from the packaged payload. Old embedded service code is migrated independently of the desktop folder. New setup leaves an unused service stopped and Manual.
2. **First launch:** Electron shows its own window and requests service activation if required. Authenticated health must succeed before committing automatic service startup. A healthy running service is reused without elevation.
3. **Repair/update:** changed payloads stage a separate runtime and SQLite copy. A journal holds the previous configuration and full installation record. Active updates commit after health succeeds; unused installations stay stopped. Interrupted removal can be reconciled by setup.
4. **Close/reopen:** desktop shutdown stops only API work owned by the desktop. The shared Windows service continues. Late events skip destroyed windows/renderers; service preparation cannot restart desktop polling after shutdown begins. Secondary app instances do not initialize another lifecycle.
5. **Uninstall:** after the user's catalogue choice, maintenance stops/removes SCM registration and then executable directories. Removal uses SCM even when the wrapper or catalogue configuration is missing. Default uninstall retains shared data in place and does not copy it into a profile. An unrelated installation cannot remove another managing installation's service.
6. **Reinstall after removal:** the retained shared catalogue wins over the initial desktop seed for all accounts. Explicit deletion remains opt-in, validates all targets before deleting data, and keeps settings/logs.

Lifecycle elevation targets a GUI executable. Native PowerShell uses `CreateNoWindow=true` and `UseShellExecute=false`; it is never the UAC target. **Rescore Logs** intentionally opens a terminal when selected. Setup's finish-page launch targets the installed executable directly and remains unchecked by default.

## Verification

- Desktop tests cover launch decisions, recorded completion failures, destroyed-window notifications and related process/data boundaries.
- Non-elevated service tests cover repeated setup, embedded-code migration, interrupted operations, missing runtime/registration/wrapper, rollback, preservation/deletion and unrelated-installation protection. Native console probes cover the GUI helper, PowerShell and native descendants.
- An elevated disposable service test exercises production management functions, real SCM/WinSW/virtual-account permissions, real Node and SQLite transfers. The API health endpoint is a local fixture; no real catalogue downloads occur.
- Package verification checks identity and renderer/preload/assets as well as service payload and the helper's Windows GUI/x64 subsystem. Installer compilation and a native NSIS cleanup fixture verify file-removal behavior.

The original screenshot dialogs identify a separate Phraseback development process under a Codex worktree. The Rescore installation's registry entry and shortcuts target `C:\Program Files\Rescore\Rescore.exe`; the observed service registration was ready and never activated. This revision does not modify that separate Phraseback development checkout.

Full installer wizard interaction, reboot/sign-in, cross-user acceptance, and catalogue ingestion are separate from the service verification above.
