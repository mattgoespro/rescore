# Script layout verification

Development and validation tooling belongs in `apps/<app>/scripts/`, outside
functional application source. Production lifecycle entry points remain in
`src/lifecycle/`.

## Classification and changes

| Files | Location | Purpose |
| --- | --- | --- |
| `build-catalog.ts`, `enrich-posters.ts`, `migrate.ts`, `tmdb-throughput-smoke.ts` | Moved from `apps/api/src/scripts/` to `apps/api/scripts/` | Operator and development commands |
| `service-data.ts`, `service-stop.ts` | Moved from `apps/api/src/scripts/` to `apps/api/src/lifecycle/` | Production maintenance transfers and authenticated WinSW shutdown |
| `verify-ui.mjs`, `verify-library-refresh.mjs`, `verify-runtime-recovery.mjs`, `verify-native-lifecycle.mjs`, `check-package.cjs` | Retained in `apps/desktop/scripts/` | Validation and package checks; already outside `src/` |

API npm commands and source imports use the new tooling paths. Typechecking
includes tooling; production compilation includes only application source and
excludes colocated tests. Both the API build and Electron packaging invoke
`apps/api/scripts/build.mjs`, which clears generated API output before compiling.
The API entry remains `dist/index.js`; production helpers emit to
`dist/lifecycle/`.

Windows management uses the new lifecycle paths and accepts the former paths
when recovering or removing an older installed runtime. Packaging requires the
new helpers and rejects obsolete `dist/scripts/` output. Current documentation
and the native service fixture reference the new paths.

## Verification on 2026-10-16

All commands below passed in the working checkout:

- `npm test`: 121 API tests and 109 desktop tests, matching the passing baseline.
- API typechecking and desktop node/renderer typechecking.
- Scoped ESLint for moved TypeScript commands, lifecycle helpers, and the updated
  data-transfer test.
- `npm run test:scripts --workspace=@rescore/api`: clean build with deliberately
  stale output; migration; catalogue import; poster enrichment; throughput guard
  and both fixture key lanes at all three caps; compiled shutdown and data copy.
- `npm run test:ui --workspace=rescore` and
  `npm run test:library-ui --workspace=rescore`.
- `npm run test:recovery --workspace=rescore` and
  `npm run test:lifecycle-native --workspace=rescore`.
- `npm run test:service --workspace=rescore`: non-elevated Windows helper,
  broker, lifecycle, installer, process, and log fixtures.
- `test-helper.ps1 -Wrapper apps/desktop/build/service/WinSW-x64.exe`:
  legacy/current lifecycle selection and read-only wrapper status.
- `npm run build:unpack --workspace=rescore` and independent
  `node apps/desktop/scripts/check-package.cjs`.
- `service-runtime.test.ts` using `RESCORE_TEST_RUNTIME` set to the freshly built
  `dist/win-unpacked/resources/api`: both bundled-runtime tests passed.
- PowerShell syntax validation for the updated elevated native fixture and
  `git diff --check`.

The API command checks use temporary SQLite data and local IMDb/TMDb fixtures.
The native Electron check also uses a local authenticated fixture. No installed
service, real catalogue, or live provider was modified. Elevated SCM/UAC
acceptance was not rerun for this source-layout change.
