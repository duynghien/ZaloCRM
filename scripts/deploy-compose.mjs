/** Stop and verify the previous binary drained before applying any migration. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function docker(args, { capture = false, timeout = 900_000, env = process.env } = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', timeout, env });
  if (result.error || result.status !== 0) throw new Error(`docker ${args.slice(0, 3).join(' ')} failed (${result.error?.message || result.status})`);
  return result.stdout?.trim() || '';
}

export function deploy({ composeArgs = [], env = process.env, build = true, backup = true } = {}) {
  let activeArgs = composeArgs;
  const run = (args, options = {}) => docker(['compose', ...activeArgs, ...args], { env, ...options });
  const config = JSON.parse(run(['config', '--format', 'json'], { capture: true }));
  const lock = join(tmpdir(), `zalocrm-deploy-${config.name}.lock`);
  // A concurrent or interrupted deployment requires operator reconciliation.
  mkdirSync(lock);
  try {
    if (build) run(['build', 'app', 'migrator']);
    const images = Object.fromEntries(['app', 'migrator'].map(service => [service,
      docker(['image', 'inspect', config.services[service].image, '--format', '{{.Id}}'], { capture: true, env })]));
    const pinnedImages = join(lock, 'images.json');
    writeFileSync(pinnedImages, JSON.stringify({ services: Object.fromEntries(
      Object.entries(images).map(([service, image]) => [service, { image, pull_policy: 'never' }]),
    ) }));
    // Pin both jobs before cutover so another build cannot change mutable tags.
    // Supplying -f requires retaining the default base file explicitly.
    activeArgs = [...(composeArgs.length ? composeArgs : ['-f', 'docker-compose.yml']), '-f', pinnedImages];
    const oldApps = run(['ps', '--all', '--quiet', 'app'], { capture: true }).split(/\s+/).filter(Boolean);
    if (oldApps.length) {
      run(['stop', '--timeout', '70', 'app'], { timeout: 80_000 });
      for (const id of oldApps) {
        const state = JSON.parse(docker(['inspect', id, '--format', '{{json .State}}'], { capture: true, env }));
        if (state.Running || state.ExitCode !== 0 || state.OOMKilled) {
          throw new Error(`App ${id} did not drain cleanly; migration aborted. Reconcile before retrying.`);
        }
      }
    }
    run(['up', '-d', '--wait', 'db']);
    // Never trust a completed migrator from an earlier deployment.
    run(['up', '-d', '--no-deps', '--force-recreate', 'migrator']);
    const migrationId = run(['ps', '--all', '--quiet', 'migrator'], { capture: true });
    const migrationImage = docker(['inspect', migrationId, '--format', '{{.Image}}'], { capture: true, env });
    if (migrationImage !== images.migrator) throw new Error('Migrator image changed during deployment');
    const exit = docker(['wait', migrationId], { capture: true, timeout: 300_000, env });
    if (exit !== '0') throw new Error(`Migration failed (${exit}); app remains stopped`);
    run(['up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '120', 'app']);
    const appId = run(['ps', '--quiet', 'app'], { capture: true });
    const appImage = docker(['inspect', appId, '--format', '{{.Image}}'], { capture: true, env });
    if (appImage !== images.app) {
      run(['stop', '--timeout', '70', 'app']);
      throw new Error('App image changed during deployment; app stopped');
    }
    if (backup && config.services.backup) run(['up', '-d', '--no-deps', 'backup']);
    console.log('Deployment healthy; migration completed with the expected image after clean app drain.');
  } finally {
    rmSync(lock, { recursive: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { deploy(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
