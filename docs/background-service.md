# Automatic Windows catalogue service

No manual service setup is required. Users only install or launch Rescore and approve a Windows administrator prompt if Windows requires one. Rescore handles user identification, registration, data transfer, startup, runtime updates, and health checks.

Windows Services displays the service as **Rescore API**. Its internal service identifier remains unique to each Windows user.

During TMDb hydration, stdout logs report completed/total titles and the completion rate every 30 seconds, including when a batch is waiting. Reports include the latest error and retry countdown, plus a final completion or shutdown report. The rate measures durable title completions, not HTTP requests. **Open logs** opens the folder containing `RescoreService.out.log`.

## Installed app

The installer automatically registers a fresh service and leaves it stopped. It does not launch Rescore automatically. Rebooting before the first app launch does not start the service.

The first app launch automatically starts the service. After successful activation, Windows starts it automatically after subsequent boots, including before sign-in. Closing Rescore leaves the service running.

## Unpacked app

Launching `Rescore.exe` from the complete unpacked folder automatically registers and starts a missing service, starts a stopped service, or connects to a healthy running service. No installer, PowerShell commands, SID lookup, or manual registration is needed.

Moving the unpacked folder or switching between unpacked and installed copies does not require manual removal or registration. Rescore automatically adopts the same Windows user's existing service, preserves its catalogue, and updates its runtime when needed. Installing a new copy does not activate a service that has never been started.

## Updates and recovery

Installation and app startup automatically update the service when required. Supported interrupted operations are repaired automatically. Uninstall automatically removes the service it manages and preserves catalogue data and recovery copies.

If administrator approval is cancelled or an operation fails, the app explains the failure. **Retry** repeats the automated operation; **Open logs** provides diagnostic details. The app never substitutes a second catalogue API process.

Windows administrator approval cannot be supplied automatically by the app. Custom or redirected Windows user-data paths remain unsupported.

## Browsing during hydration

The first IMDb titles and credits preparation must finish before browsing. TMDb hydration does not block the interface. Visible titles and opened details automatically request missing metadata through the same coordinator as background upkeep.

Concurrent requests for a title share one job. Completed lookups persist, including confirmed missing metadata, so background work skips titles already hydrated during browsing. Transient failures retry with backoff. Content updates without resetting filters, selection, or scroll position.

## Maintainer reference

[Optional administrative commands, storage details, and developer verification](background-service-maintenance.md) are documented separately. They are not steps users must perform to use Rescore.
