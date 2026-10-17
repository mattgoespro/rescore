# Installed Rescore and Windows service verification

Acceptance run on Matt's Windows computer, 14 October 2026, from `codex/architecture-uplift`. Evidence and the original catalogue/settings backup are retained in `C:\Users\Matt\AppData\Local\Temp\rescore-installed-acceptance-20261014`.

## Initial state and installation

There was no installed Rescore executable, uninstall registration, or SCM service. ProgramData retained a disabled registration and its catalogue. The retained SQLite copy passed `quick_check`, contained 484,727 titles and 3,476,576 credits, and had an empty Library. A full SQLite copy and the original settings were saved before installation.

The current installer was built and installed with administrator approval. Registration reused the retained catalogue and initially produced a stopped Manual service, with activation uncommitted. The installed app archive matched the built archive by SHA-256. Package checks passed against the installed folder.

The real installed Electron executable was driven through Playwright with its actual preload, IPC, native adapters, user-data folder, and Windows catalogue. IPC responses and catalogue data were not replaced. Authenticated service health validated service mode, protocol, catalogue ID, and runtime version. Requests without authentication returned HTTP 401.

## Live acceptance results

- First launch prepared and activated the service through the elevated GUI maintenance broker. SCM then reported Automatic startup and `NT SERVICE\RescoreCatalogue`; the catalogue became ready with 484,727 titles.
- Opening the installed app during setup observed the active management lock and displayed maintenance in progress without starting a second catalogue process.
- Search and For You each returned 40 real titles. The Search interface and posters rendered successfully. No renderer exceptions were recorded.
- A temporary rating for a known catalogue title roundtripped through Library, taste profile, and recommendations. The entry was removed in `finally`, restoring the observed empty Library.
- An elevated controlled service stop made the desktop report unavailability. An external service start restored browsing through passive monitoring without a desktop Retry command.
- Forced termination targeted only the uniquely identified API child of the actual service. SCM recorded event 7031 and restarted WinSW after the configured delay; authenticated health and browsing recovered.
- The corrected installed build was subjected to another forced outage. SCM recorded its 60-second restart action, the app observed unavailability, and both catalogue readiness and service status returned to Ready/Running with no renderer exceptions.
- The app closed during repair preflight. In a separate run, two maintenance brokers were observed before closure, establishing that elevated maintenance had started. Desktop closure completed while the elevated worker remained alive; the service subsequently returned to Running.
- Elevated read-only SQLite checks after repair and final recovery passed `quick_check`; title count and Library hash matched the baseline. Supported settings remained unchanged. The original search-history timestamps were restored after test navigation updated their recency. The existing settings migration removed the obsolete `region` and `imdbApiUrl` fields.

## Regressions found and corrected

1. A health probe could succeed after service inspection captured a restart error, leaving Settings with a stale service-error projection despite ready browsing. Accepted authenticated service health now updates the service projection to Running. The new lifecycle regression failed before the fix; all 105 desktop tests passed afterward, together with native Electron and HTTP recovery fixtures.
2. electron-builder's default process selection used a folder-prefix comparison: `C:\Program Files\Rescore Catalogue` matched `C:\Program Files\Rescore`. A live update therefore killed the service, and SCM restarted it. The installer now selects the exact desktop executable while retaining the existing close prompts and retry flow. A disposable native NSIS test reproduced the sibling-service kill before the change and passed afterward. It verifies both detection and termination without touching the real catalogue. The new test is included in `test:service`.

The old installed uninstaller contained its compiled process check. The service was stopped cleanly while replacing that uninstaller, avoiding another involuntary crash. An identical reinstall using the corrected installer and uninstaller then preserved the running shared service's PID (`8376`) and activation. The installed app archive matched the corrected build (`4382EA482717419C47E4E8136FFB4D52E9753A6609BEEAC747492B039FE696BC`).

After crash testing, SCM registration was reconstructed through the production Retry broker so the test-exercised restart budget was not left exhausted. The protected installation/configuration, runtime, catalogue, and endpoint were retained. The restored service runs as `NT SERVICE\RescoreCatalogue` with Automatic startup, and authenticated health retains catalogue ID `192ed5a7-973b-44d0-92b8-e197b9c96123`.

## Final gate

`acceptance-summary.json` reports `passed: true`. The corrected installed app's Settings screen shows Running; Search and For You return 40 titles; renderer exception records are empty. The desktop was closed normally after verification, and the shared service remains Running. The final read-only SQLite snapshot passes integrity checking, contains 484,727 titles, and matches the original empty Library hash. Supported settings and original search history match the pre-test baseline after the existing obsolete-field migration.

The production Windows installer build, installed package checks, 105 desktop tests, root typechecks, scoped lint, native Electron recovery fixtures, aggregate Windows fixtures, and the nine-scenario elevated disposable-service runner pass. Source changes remain uncommitted on the existing branch; installed binaries include the two acceptance fixes.

## Elevated disposable-service coverage

The production native verification runner passed all nine scenarios: fresh stopped registration, identical setup reuse, missing files/SCM recovery, first activation, repair, active upgrade, retained-data uninstall, reinstall, and explicit deletion. It used real SCM, WinSW, virtual accounts, ACLs, Node, and SQLite transfers with an isolated HTTP fixture. Its uniquely named service and protected temporary directory were both verified removed. This fixture's deletion scenarios did not operate on the real catalogue.

## Limits

Reboot/sign-in, a second Windows user, interactive installer-page traversal, and cancellation of a secure-desktop UAC prompt were not exercised. Real catalogue deletion and uninstall were deliberately confined to the disposable service. These results do not establish those remaining release-acceptance cases.
