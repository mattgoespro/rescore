# Catalogue service maintainer reference

These are optional developer and administrator tools, not application setup steps. Installation, registration, startup, updates, and supported recovery run automatically. Users do not need PowerShell, a SID, or manual service commands.

`resources/service/Rescore Maintenance.exe` is an x64 Windows GUI executable. NSIS and desktop startup/recovery call it directly with a fixed service action. It captures the launching user's data folder, elevates itself when needed, then starts native PowerShell with `UseShellExecute=false` and `CreateNoWindow=true`. PowerShell is never the UAC target. The worker records completion; cancellation, missing completion, and nonzero results stop the operation. The standalone `maintenance.ps1` entry point delegates to the same executable, including from 32-bit PowerShell.

## Standalone management

Use the complete installed app folder or `win-unpacked` folder, including `resources`. Build the latter with `npm run build:unpack --workspace=rescore`.

1. Close Rescore and any catalogue CLI processes before a transfer.
2. Open PowerShell as administrator and set these values. `dataDir` is the desktop catalogue folder for the account whose settings should seed a new registration. Any account then uses the same service.

   ```powershell
   $appFolder = 'C:\path\to\win-unpacked'
   $dataDir = Join-Path $env:APPDATA 'Rescore\data'
   $helper = Join-Path $appFolder 'resources\service\manage-service.ps1'
   ```

3. Run the operation required:

   ```powershell
   # Register only; a fresh service remains stopped until activation.
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper -Action Register -DataDir $dataDir

   # Register if missing, repair/update if needed, then start and activate.
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper -Action EnsureRunning -DataDir $dataDir

   # Restart and repair an unhealthy service.
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper -Action Retry -DataDir $dataDir

   # Administrative removal: return current data safely to the desktop profile that first registered it.
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper -Action Disable -DataDir $dataDir
   ```

   Run only the operation you need and check `$LASTEXITCODE` for zero. `Enable` remains a compatible alias for `EnsureRunning`. Launching Rescore after removal registers the required service again.
4. Verify `Get-Service -Name RescoreCatalogue`: a fresh Register produces `Stopped`; EnsureRunning produces `Running` after its authenticated health check.

Moving an unpacked build or switching between installed and unpacked copies is handled automatically by registration/startup. The new app location adopts the shared catalogue through a staged upgrade. The old location cannot remove the adopted service. Normal updates also run automatically; the following command is only for an administrator deliberately updating without launching Rescore:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\resources\service\maintenance.ps1 -Action UpgradeAll
```

## Ownership and storage

- Service name: `RescoreCatalogue`; one shared catalogue for every account on the computer.
- Identity: virtual account `NT SERVICE\RescoreCatalogue`, without a personal password.
- Runtime: `%ProgramFiles%\Rescore Catalogue\<runtime ID>`, independent of the desktop installation. Only administrators and SYSTEM can change executable files. Setup migrates older runtimes from `%ProgramFiles%\Rescore\Catalogue` after committing their replacement. Installer update cleanup preserves that old embedded folder until migration finishes.
- Profile: `%ProgramData%\Rescore`. Protected registration and configuration files identify the endpoint, catalogue, runtime version, and transfer phase. The API credential stays outside the renderer. Authenticated users can read this profile.
- Writable service directories: the selected `data-<ID>` directory and `logs`. The service account receives modify permission only there.
- Desktop preferences and search history remain in Electron's existing user-data directory. Data copies retain library state, hydration checkpoints, IMDb dumps, and media cache.

The service hosts the same Node API as the desktop. Electron never starts a replacement API while service ownership is recorded. A separate SQLite ownership transaction prevents simultaneous API/CLI owners of one catalogue path. Process exit, including forced termination, releases that lock.

Production data-transfer and shutdown entry points live in `apps/api/src/lifecycle/` and compile to `dist/lifecycle/service-data.js` and `dist/lifecycle/service-stop.js` within the API runtime. The management helper also recognizes the former `dist/scripts/` paths when recovering or removing an older installed runtime. New packages exclude API development tooling, which lives in `apps/api/scripts/`.

The service API binds to IPv4 loopback and requires a bearer credential. Desktop clients authenticate only the exact service origin and refuse redirects. Local poster requests pass through an Electron protocol handler. Health checks verify catalogue ID, protocol version, and runtime version; a service requiring an app-version update is blocked from desktop requests.

## Transfers and recovery

The elevated helper serializes all service operations with an exclusive machine-level file lock, waiting up to 30 seconds for another operation to finish. Setup performs reconciliation and registration under one lock. An identical reinstall reuses its runtime and catalogue. It rejects linked paths and untrusted installation-directory owners. Runtime files are checked against the packaged SHA-256 manifest. WinSW 2.12.0 is separately pinned by checksum and ships with its MIT licence.

Registration preserves the original desktop data while staging an independent service copy. Interrupted registration retries from the original; failed startup retains the service copy for repair. Disable recovers the latest service data even after an interrupted copy. Data transfer checks free space, SQLite integrity, and exclusive ownership, and refuses symbolic or hard links.

An upgrade stages a new runtime and a separate catalogue copy. For activated services, it commits only after authenticated health succeeds. Never-activated services are updated without starting; their first health check occurs on first app launch. A failed upgrade restores the previous runtime and data together. The rollback journal includes the complete previous installation record and configuration. Old runtime code is retired after commit; data recovery copies remain. Setup reconstructs missing runtime files and SCM registration from its packaged payload. Standalone Disable remains available for administrative recovery.

Uninstall presents a catalogue choice before doing any work. **Delete catalogue data for all users** is unchecked by default. Service removal runs on the progress page, before desktop files are deleted. Default removal retains the shared catalogue in ProgramData without copying it to a Windows profile. Reinstallation uses that retained shared catalogue, including for the same account, rather than stale desktop data. SCM removal works without the wrapper executable and does not require valid catalogue configuration or an available Windows profile. Native service handles are released before waiting for removal. Interrupted uninstall is reconciled by setup.

Explicit deletion removes shared `data-<ID>` directories, the original desktop catalogue, and its `data.backup-<ID>` / `data.service-<ID>` recovery copies after the service is removed. App settings and logs remain. Silent uninstall preserves data unless `--delete-catalogue` is passed; updates always preserve it. Missing SCM registration and rolled-back setup still clean their protected runtime files. An uninstaller from a different managing app location stops before deleting the active runtime.

If another account reinstalls, or the original desktop profile is gone, registration reuses the retained shared catalogue instead of seeding an empty one.

## Native lifecycle verification

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File apps/desktop/resources/service/test-native-launch.ps1
Get-Content apps/desktop/build/service/windows-lifecycle-report.json
```

The launcher requests administrator approval for a Windows GUI executable and starts PowerShell without a console. The test loads production management functions and creates a uniquely named disposable Windows service and protected folder under Program Files. It uses packaged WinSW and Node, real service identities/ACLs, and the production SQLite transfer scripts. A local authenticated HTTP fixture replaces catalogue ingestion. It verifies fresh/identical setup, missing runtime/SCM recovery, first activation, repair, active upgrade, preserve/uninstall/reinstall, and explicit deletion. Its service and temporary protected folders are removed afterward; the actual Rescore service, catalogue, and Windows profile are untouched. A complete report establishes native service behavior, not interactive installer page clicks or reboot/sign-in behavior.

Every Windows package is checked for Rescore identity, renderer/preload entries and assets, required service payload, and an x64 GUI maintenance helper before packaging proceeds. Run that check independently with `node apps/desktop/scripts/check-package.cjs`.

Installer process checks target the exact installed desktop executable. The sibling `Rescore Catalogue` runtime must not match a desktop-folder text prefix. `test-installer-processes.ps1`, included in `test:service`, runs disposable native processes to verify desktop detection/termination while preserving the sibling service process.

`Rescore Logs.exe` ships beside `Rescore.exe` and has a Start Menu shortcut. It opens a PowerShell window following `%ProgramData%\Rescore\logs\RescoreService.out.log`, showing the latest 50 lines. If no log exists yet, it explains how to start the catalogue and keeps the terminal open.

Service stop requests cancel producers and downloads, flush queued work, and close SQLite. WinSW allows 30 seconds before forced termination. Crash recovery requests restarts after 10, 30, and 60 seconds, then stops restarting. Transient upkeep failures retry from 30 seconds up to 15 minutes; existing provider retry delays are retained. Missing/rejected credentials and permanent storage failures require intervention. Logs rotate at 10 MB with five retained files.

## Verification

Automated service checks:

```powershell
npx tsx --test apps/api/src/services/service-runtime.test.ts apps/api/src/services/service-data.test.ts apps/api/src/services/catalog-ownership.test.ts apps/desktop/src/main/catalog-connection.test.ts
```

The runtime fixture uses local IMDb/TMDb substitutes. It checks a standalone build, authentication, durable hydration reuse, clean shutdown, and cancellation during a stalled download. Ownership tests include forced process termination. Transfer tests preserve WAL contents, library values, cache, and the source copy. These tests do not register a Windows service.

Read-only Windows helper checks, including the packaged WinSW executable:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File apps/desktop/resources/service/test-helper.ps1 -Wrapper apps/desktop/build/service/WinSW-x64.exe
powershell.exe -NoProfile -ExecutionPolicy Bypass -File apps/desktop/resources/service/test-lifecycle.ps1
npm run test:service --workspace=rescore
```

The aggregate service check compiles the production maintenance broker with an alternate test entry point that skips privilege detection, and uses a stub management script. It runs all lifecycle actions through the GUI broker and 32/64-bit PowerShell callers in a directory containing spaces and an apostrophe. Native `GetConsoleWindow` probes verify that the GUI helper, PowerShell worker, and a console executable invoked by the worker have no console attached. It also verifies missing-result failures and upgrade ordering. Lifecycle tests use temporary files and mocked SCM operations to verify activation, upgrades, interrupted/failed registration, preservation/deletion, missing profiles, and unrelated-installation protection. The NSIS file fixture compiles with the cached installer compiler and executes temporary uninstallers to check that updates retain `Catalogue` and stop on locked files without hanging. These checks do not change real services or user catalogues and do not exercise interactive UAC. Build once first if the NSIS compiler cache is absent.

Build the installer with `npm run build:win`. Exercise the bundled API runtime using:

```powershell
$env:RESCORE_TEST_RUNTIME = (Resolve-Path dist/win-unpacked/resources/api).Path
npx tsx --test apps/api/src/services/service-runtime.test.ts
Remove-Item Env:RESCORE_TEST_RUNTIME
```

Before release, complete elevated Windows acceptance on a disposable Windows profile: verify fresh installation registers a stopped Manual service; reboot before first launch and confirm it stays stopped; launch an unpacked build without registration; launch with a stopped service; close/reopen the app; sign out; reboot before sign-in; simulate UAC cancellation, storage failure, and interrupted transfers; upgrade/rollback for both never-activated and activated registrations; administrative removal; and uninstall with both catalogue choices. Cancel the uninstall wizard before progress and verify no service changes. Check that a second standard user connects to the shared catalogue. Open Rescore Logs from the Start Menu. These native SCM, UAC, reboot, cross-user, and interactive wizard checks are not established by the runtime fixture or installer build.
