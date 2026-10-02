# Catalogue service maintainer reference

These are optional developer and administrator tools, not application setup steps. Installation, registration, startup, updates, and supported recovery run automatically. Users do not need PowerShell, a SID, or manual service commands.

## Standalone management

Use the complete installed app folder or `win-unpacked` folder, including `resources`. Build the latter with `npm run build:unpack --workspace=rescore`.

1. Close Rescore and any catalogue CLI processes before a transfer. In a normal PowerShell window, run `whoami /user` and copy the owning user's SID before elevation.
2. Open PowerShell as administrator and set these values:

   ```powershell
   $appFolder = 'C:\path\to\win-unpacked'
   $ownerSid = 'S-1-5-21-REPLACE-WITH-THE-OWNING-USERS-SID'
   $helper = Join-Path $appFolder 'resources\service\manage-service.ps1'
   ```

3. Run the operation required:

   ```powershell
   # Register only; a fresh service remains stopped until activation.
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper -Action Register -OwnerSid $ownerSid

   # Register if missing, repair/update if needed, then start and activate.
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper -Action EnsureRunning -OwnerSid $ownerSid

   # Restart and repair an unhealthy service.
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper -Action Retry -OwnerSid $ownerSid

   # Administrative removal: return current data safely to the desktop profile.
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File $helper -Action Disable -OwnerSid $ownerSid
   ```

   Run only the operation you need and check `$LASTEXITCODE` for zero. `Enable` remains a compatible alias for `EnsureRunning`. Launching Rescore after removal registers the required service again.
4. Verify `Get-Service -Name "RescoreCatalogue-$ownerSid"`: a fresh Register produces `Stopped`; EnsureRunning produces `Running` after its authenticated health check.

Moving an unpacked build or switching between installed and unpacked copies is handled automatically by registration/startup. The new app location adopts the same Windows user's existing catalogue through a staged upgrade. The old location cannot remove the adopted service. Normal updates also run automatically; the following command is only for an administrator deliberately updating without launching Rescore:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\resources\service\maintenance.ps1 -Action UpgradeAll
```

## Ownership and storage

- Service name: `RescoreCatalogue-<Windows user SID>`; one isolated catalogue per Windows user.
- Identity: virtual account `NT SERVICE\RescoreCatalogue-<SID>`, without a personal password.
- Runtime: `%ProgramFiles%\Rescore Catalogue\<SID>\<runtime ID>`. Only administrators and SYSTEM can change executable files.
- Profile: `%ProgramData%\Rescore\<SID>`. Protected registration and configuration files identify the endpoint, catalogue, runtime version, and transfer phase. The API credential stays outside the renderer.
- Writable service directories: the selected `data-<ID>` directory and `logs`. The service SID receives modify permission only there. The owning user can read their profile; other standard users cannot.
- Desktop preferences and search history remain in Electron's existing user-data directory. Data copies retain library state, hydration checkpoints, IMDb dumps, and media cache.

The service hosts the same Node API as the desktop. Electron never starts a replacement API while service ownership is recorded. A separate SQLite ownership transaction prevents simultaneous API/CLI owners of one catalogue path. Process exit, including forced termination, releases that lock.

The service API binds to IPv4 loopback and requires a bearer credential. Desktop clients authenticate only the exact service origin and refuse redirects. Local poster requests pass through an Electron protocol handler. Health checks verify catalogue ID, protocol version, and runtime version; a service requiring an app-version update is blocked from desktop requests.

## Transfers and recovery

The elevated helper serializes all service operations with an exclusive machine-level file lock. It rejects linked paths and untrusted installation-directory owners. Runtime files are checked against the packaged SHA-256 manifest. WinSW 2.12.0 is separately pinned by checksum and ships with its MIT licence.

Registration preserves the original desktop data while staging an independent service copy. Interrupted registration retries from the original; failed startup retains the service copy for repair. Disable recovers the latest service data even after an interrupted copy. Data transfer checks free space, SQLite integrity, and exclusive ownership, and refuses symbolic or hard links.

An upgrade stages a new runtime and a separate catalogue copy. For activated services, it commits only after authenticated health succeeds. Never-activated services are updated without starting; their first health check occurs on first app launch. A failed upgrade restores the previous runtime and data together. Interrupted upgrades retain a rollback record. App startup repairs interrupted transitions and checks the runtime manifest hash, including same-version unpacked replacements. Standalone Disable remains available for administrative recovery.

Uninstall removes the service before desktop files. Denied administrator approval stops uninstall. User catalogue data and backups remain. If the Windows profile was deleted, uninstall retains the catalogue under ProgramData without recreating that profile.

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
```

Lifecycle tests use temporary files and mocked Windows service operations. They verify inactive registration, first activation, repeated launch, inactive upgrades, missing-registration repair, and interrupted registration without changing real services.

Build the installer with `npm run build:win`. Exercise the bundled API runtime using:

```powershell
$env:RESCORE_TEST_RUNTIME = (Resolve-Path apps/desktop/dist/win-unpacked/resources/api).Path
npx tsx --test apps/api/src/services/service-runtime.test.ts
Remove-Item Env:RESCORE_TEST_RUNTIME
```

Before release, complete elevated Windows acceptance on a disposable Windows profile: verify fresh installation registers a stopped Manual service; reboot before first launch and confirm it stays stopped; launch an unpacked build without registration; launch with a stopped service; close/reopen the app; sign out; reboot before sign-in; simulate UAC cancellation, storage failure, and interrupted transfers; upgrade/rollback for both never-activated and activated registrations; administrative removal; and uninstall. Check that a second standard user cannot read the service profile or authenticate. These native SCM, UAC, reboot, and cross-user checks are not established by the runtime fixture or installer build.
