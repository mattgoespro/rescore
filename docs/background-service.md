# Automatic Windows catalogue service

No manual service setup is required. Users only install or launch Rescore and approve a Windows administrator prompt if Windows requires one. Rescore handles user identification, registration, data transfer, startup, runtime updates, and health checks.

Installation, startup/recovery, and uninstallation use a windowless maintenance helper. Administrator approval does not open a PowerShell terminal.

Windows Services displays the service as **Rescore API**. One shared catalogue service serves every account on the computer.

During TMDb hydration, stdout logs report completed/total lookups and the completion rate every 30 seconds, including when a batch is waiting. Reports include actual poster and synopsis coverage, the latest error and retry countdown, plus a final completion or shutdown report. Lookup completion includes titles TMDb could not match; it does not mean all metadata is available. The rate measures durable title completions, not HTTP requests. **Hide progress** in the service log hides these reports. Failed lookups are retried. They log as one line per burst, with a count for each cause and the first title affected, because a network drop such as the computer entering standby fails every lookup in flight at once.

Selecting the catalogue status in the top bar opens the service log: a full-window view of `RescoreService.out.log` and, as error rows on the `stderr` channel, `RescoreService.err.log`. It follows new lines until you scroll up (**Follow new lines** resumes), keeps the newest 2,000, and filters by level, channel and text. When the catalogue has failed it shows the failure and **Retry** above the log. A session that started the API itself (development or `npm start`) shows that API's output instead; in development the output is also echoed, uncoloured, to the terminal. In Settings, **Open log folder** opens the folder containing the log files.

## Installed app

The installer wizard registers a fresh service and leaves it stopped. Launch Rescore on the finish page is unchecked, so setup launches Rescore only when that box is checked. Rebooting before the first app launch does not start the service.

The first app launch automatically starts the service. After successful activation, Windows starts it automatically after subsequent boots, including before sign-in. Closing Rescore leaves the service running.

## Unpacked app

Launching `Rescore.exe` from the complete unpacked folder automatically registers and starts a missing service, starts a stopped service, or connects to a healthy running service. No installer, PowerShell commands, SID lookup, or manual registration is needed.

Moving the unpacked folder or switching between unpacked and installed copies does not require manual removal or registration. Rescore automatically adopts the existing shared service, preserves its catalogue, and updates its runtime when needed. Installing a new copy does not activate a service that has never been started.

## Updates and recovery

Installation and app startup automatically update the service when required. Supported interrupted operations are repaired automatically. Uninstall automatically removes the service it manages and preserves catalogue data and recovery copies.

The uninstall wizard offers **Delete catalogue data for all users**, unchecked by default. Keep it unchecked when reinstalling to preserve ratings, library, downloads, and cache. Selecting it removes the shared catalogue and its retained recovery copies; app settings and logs remain.

Service code lives in `%ProgramFiles%\Rescore Catalogue`, separately from the desktop app. Default uninstall keeps shared data in `%ProgramData%\Rescore`; reinstall uses it without copying stale desktop data over it. Setup repairs missing service files/registration and reconciles interrupted removal.

If administrator approval is cancelled or an operation fails, the app explains the failure. **Retry** repeats the automated operation; the service log provides diagnostic details. The app never substitutes a second catalogue API process.

Each app launch allows one automatic preparation attempt when needed. After failure, Rescore keeps checking for recovery without repeatedly requesting administrator approval. It connects automatically once the catalogue becomes healthy; **Retry** explicitly requests another repair attempt. If maintenance is already running, the app waits for it rather than starting another operation. Rebuild requests are rejected while preparation, repair, or unverified maintenance is active.

You can close Rescore during maintenance after resolving any unsaved settings. Desktop work stops, while an already-started elevated Windows operation may finish independently. On the next launch, Rescore inspects its Windows recovery records and maintenance activity before reconnecting.

Windows administrator approval cannot be supplied automatically by the app. Custom or redirected Windows user-data paths remain unsupported.

## Browsing during hydration

The first IMDb titles preparation must finish before browsing. While it runs, the setup screen shows overall progress across its two steps (download titles, then index titles), each file's download, the titles indexed so far, and the current step's time left; the top bar reads "Setting up" with the same percent. Each title build records its download speed, the dumps' size, and how long indexing took (catalogue meta `setupTimings`); the next build weights the two steps from those, and uses the last index time for its early time-left estimate. A first launch has no history, so the download counts as about an eighth of the wait. A dump already on disk records no speed, and an interrupted index records no time, so neither skews the next build. Cast and directors, and TMDb hydration, do not block the interface: the preview panel shows that cast is loading, and if the credits import fails it says they will be tried again next launch. For You picks up directors and cast once they arrive. A forced rebuild from Settings holds browsing until its titles are reconciled, then reopens while credits rebuild. Visible titles and opened details automatically request missing metadata through the same coordinator as background upkeep.

Concurrent requests for a title share one job. Completed lookups persist, including confirmed missing metadata, so background work skips titles already hydrated during browsing. Transient failures retry with backoff. Content updates without resetting filters, selection, or scroll position.

The interface keeps poster and synopsis coverage visible after lookups finish. Titles missing either field become eligible for another lookup seven days after their last successful check. While the service is running, it checks for due retries every five minutes and processes up to 400 titles per batch, oldest checks first. Catalogues created before retry timestamps were introduced are gradually rechecked through the same bounded batches. Retries preserve posters, synopses, and age ratings already found, and pause while a catalogue build or another hydration pass is active. A successful lookup that still finds nothing starts another seven-day cooldown; failed requests retain the existing transient-error backoff.

## Maintainer reference

[Optional administrative commands, storage details, and developer verification](background-service-maintenance.md) are documented separately. They are not steps users must perform to use Rescore.
