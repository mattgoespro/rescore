import { _electron as electron } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const root = process.argv[2];
await mkdir(root, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const desktop = await electron.launch({ executablePath: 'C:/Program Files/Rescore/Rescore.exe', cwd: 'C:/Program Files/Rescore', env, timeout: 30000 });
const page = await desktop.firstWindow();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.waitForFunction(() => Boolean(window.api));
await page.evaluate(() => {
  window.__acceptanceStatuses = [];
  window.api.onCatalogStatus(s => window.__acceptanceStatuses.push({ time: Date.now(), ...s }));
});
const metadata = await desktop.evaluate(({ app }) => ({ packaged: app.isPackaged, executable: app.getPath('exe'), appPath: app.getAppPath(), userData: app.getPath('userData'), version: app.getVersion() }));
await writeFile(join(root, 'app-launch.json'), JSON.stringify(metadata, null, 2));
console.log('Installed Electron attached: ' + JSON.stringify(metadata));
let last = '';
let closing = false;
try {
  while (!closing) {
    let command;
    try { command = JSON.parse(await readFile(join(root, 'command.json'), 'utf8')); } catch {}
    if (command?.id && command.id !== last) {
      last = command.id;
      let result;
      try {
        if (command.action === 'status') {
          result = await page.evaluate(async () => ({ status: await window.api.catalogStatus(), service: await window.api.backgroundService.getStatus(), statuses: window.__acceptanceStatuses, title: document.title, body: document.body.innerText.slice(0, 5000) }));
        } else if (command.action === 'repair') {
          result = await page.evaluate(async () => ({ service: await window.api.backgroundService.retry(), status: await window.api.catalogStatus() }));
        } else if (command.action === 'repairStart') {
          result = await page.evaluate(() => {
            window.__acceptanceRepair = { pending: true };
            window.api.backgroundService.retry().then(service => { window.__acceptanceRepair = { pending: false, service }; }).catch(error => { window.__acceptanceRepair = { pending: false, error: error.message }; });
            return { started: true };
          });
        } else if (command.action === 'browse') {
          result = await page.evaluate(async () => {
            const library = await window.api.listLibrary();
            const discover = await window.api.discover({ query: '', titleKind: 'movie', genres: [], withoutGenres: [], excludeLanguages: [], yearMin: 2000, yearMax: 2026, ratingMin: 7, ratingMax: 10, voteCountMin: 1000, runtimeMin: null, runtimeMax: null, sortBy: 'match', hideWatched: true, hideWatchlist: false, page: 1 });
            const forYou = await window.api.forYou();
            return { libraryCount: library.length, searchCount: discover.results.length, canLoadMore: discover.canLoadMore, forYouCount: forYou.movies.length };
          });
        } else if (command.action === 'libraryRoundtrip') {
          result = await page.evaluate(async () => {
            const before = await window.api.listLibrary();
            if (before.length !== 0) throw new Error('Roundtrip expects the observed empty Library baseline');
            const movie = await window.api.movie('tt0111161');
            if (!movie) throw new Error('Known catalogue title is unavailable');
            try {
              const written = await window.api.upsertLibrary({ movie, status: 'watched', rating: 8 });
              if (written.length !== 1 || written[0].rating !== 8) throw new Error('Library write did not roundtrip');
              const profile = await window.api.profile();
              const recommendations = await window.api.forYou();
              return { writtenCount: written.length, rating: written[0].rating, profileKeys: Object.keys(profile), recommendations: recommendations.movies.length };
            } finally {
              await window.api.removeLibrary('tt0111161');
              const after = await window.api.listLibrary();
              if (after.length !== 0) throw new Error('Temporary Library entry was not removed');
            }
          });
        } else if (command.action === 'navigate') {
          await page.getByRole('button', { name: command.name, exact: true }).click();
          if (command.name === 'Settings') {
            await page.getByRole('heading', { name: 'Background catalogue service', exact: true }).waitFor();
            await page.getByRole('status').filter({ hasText: /^(Running|Stopped|Needs attention|Updating service)/ }).first().waitFor();
          }
          result = { body: await page.locator('body').innerText() };
        } else if (command.action === 'screenshot') {
          if (command.name) await page.getByRole('heading', { name: command.name, exact: true }).scrollIntoViewIfNeeded();
          await page.screenshot({ path: join(root, command.id + '.png') });
          result = { screenshot: command.id + '.png' };
        } else if (command.action === 'close') {
          await desktop.close();
          closing = true;
          result = { closed: true };
        } else throw new Error('Unknown acceptance command');
        await writeFile(join(root, command.id + '.json'), JSON.stringify({ ok: true, result, errors }, null, 2));
        console.log('PASS ' + command.id);
      } catch (error) {
        await writeFile(join(root, command.id + '.json'), JSON.stringify({ ok: false, error: error.message, errors }, null, 2));
        console.log('FAIL ' + command.id + ': ' + error.message);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
} finally {
  if (!closing) await desktop.close();
}
