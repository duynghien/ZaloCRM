/** Isolated Docker contract fixtures. Never loads the operator's .env or stack. */
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { docker, deploy } from './deploy-compose.mjs';

export async function fixture(kind) {
  const dev = kind === 'dev';
  const project = `zalocrm-${kind}-contract`;
  const ports = dev ? [13081, 15173, 15434] : [13080, 15433];
  for (const port of ports) await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Fixture port ${port} occupied; refusing to change ports or stop its owner`)));
    server.listen(port, '127.0.0.1', () => server.close(resolvePort));
  });
  for (const resource of ['container', 'volume', 'network']) {
    const args = resource === 'container' ? ['ps', '-aq'] : [resource, 'ls', '-q'];
    if (docker([...args, '--filter', `label=com.docker.compose.project=${project}`], { capture: true })) {
      throw new Error(`Existing fixture ${project} ${resource}; reconcile its ownership before retrying`);
    }
  }
  const dir = mkdtempSync(join(tmpdir(), `${project}-`));
  const envFile = join(dir, 'fixture.env');
  writeFileSync(envFile, `DB_PASSWORD=fixture-password-only\nJWT_SECRET=${'a'.repeat(64)}\nENCRYPTION_KEY=${'b'.repeat(64)}\nAPP_URL=http://localhost:${ports[0]}\n`);
  const env = { ...process.env, ENV_FILE: envFile, DB_PASSWORD: 'fixture-password-only',
    DB_USER: 'crmuser', DB_NAME: 'zalocrm', APP_PORT: String(ports[0]), DB_PORT: String(ports.at(-1)),
    APP_IMAGE: `${project}-app:fixture`, MIGRATOR_IMAGE: `${project}-migrator:fixture`,
    DEV_IMAGE: `${project}:fixture`, VITE_PORT: '15173', DEV_APP_URL: 'http://localhost:15173' };
  const composeArgs = ['--project-name', project, '--env-file', envFile, '-f', resolve(dev ? 'docker-compose.dev.yml' : 'docker-compose.yml')];
  const run = (args, options = {}) => docker(['compose', ...composeArgs, ...args], { ...options, env });
  let cleaned = false;
  const onInterrupt = () => { cleanup(); process.exit(130); };
  const onTerminate = () => { cleanup(); process.exit(143); };
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    try { run(['down', '--volumes', '--remove-orphans', '--timeout', '70']); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  }
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  return { dir, env, composeArgs, run, cleanup };
}

export async function waitFor(url, predicate = r => r.ok) {
  for (let attempt = 0; attempt < 90; attempt++) {
    try { const response = await fetch(url); if (await predicate(response)) return; } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 1000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function verify() {
  const f = await fixture('prod');
  try {
    f.run(['build', 'app', 'migrator']);
    const inventory = `const fs=require('fs'); const {createRequire}=require('module'); const r=createRequire('/app/backend/package.json');
      for(const p of ['fastify','@prisma/client','@prisma/adapter-pg','exceljs'])r.resolve(p);
      for(const p of ['prisma','typescript','vite','vitest','playwright','@playwright/test','vue','vuetify','tsx']) {
        let found=false;try{r.resolve(p);found=true}catch{} if(found)throw Error('Unexpected runtime package '+p);
      }
      const inventory=JSON.parse(fs.readFileSync('/app/runtime-dependencies.json'));
      for(const item of inventory)if(['prisma','typescript','vite','vitest','playwright','@playwright/test','vue','vuetify','tsx'].includes(item.name))throw Error('Unexpected nested runtime package '+item.name);
      r('@prisma/client');
      console.log(JSON.stringify(inventory));
      if(process.getuid()===0)throw Error('Runtime is root');`;
    docker(['run', '--rm', '--network', 'none', '--entrypoint', 'node', f.env.APP_IMAGE, '-e', inventory]);
    // CLI executes without a registry/network connection, using its locked copy.
    docker(['run', '--rm', '--network', 'none', '--entrypoint', 'node', f.env.MIGRATOR_IMAGE,
      'node_modules/prisma/build/index.js', '--version']);
    deploy({ ...f, build: false, backup: false });
    await waitFor('http://localhost:13080/health');
    assert.equal((await fetch('http://localhost:13080/')).status, 200);
    assert.equal((await fetch('http://localhost:13080/api/v1/setup/status')).status, 200);
    assert.match(await (await fetch('http://localhost:13080/socket.io/?EIO=4&transport=polling')).text(), /^0/);
    const query = sql => f.run(['exec', '-T', 'db', 'psql', '-U', 'crmuser', '-d', 'zalocrm', '-Atc', sql], { capture: true });
    // Rehearse a real backup restore into a second database owned by this fixture.
    query("CREATE TABLE restore_probe (value text PRIMARY KEY); INSERT INTO restore_probe VALUES ('fixture-preserved')");
    f.run(['exec', '-T', 'db', 'pg_dump', '-U', 'crmuser', '-d', 'zalocrm', '-Fc', '-f', '/tmp/fixture-backup.dump']);
    f.run(['exec', '-T', 'db', 'createdb', '-U', 'crmuser', 'zalocrm_restore']);
    f.run(['exec', '-T', 'db', 'pg_restore', '-U', 'crmuser', '-d', 'zalocrm_restore', '--exit-on-error', '/tmp/fixture-backup.dump']);
    const restoredQuery = sql => f.run(['exec', '-T', 'db', 'psql', '-U', 'crmuser', '-d', 'zalocrm_restore', '-Atc', sql], { capture: true });
    assert.equal(restoredQuery('SELECT value FROM restore_probe'), 'fixture-preserved');
    const migrationSnapshot = 'SELECT migration_name,checksum FROM _prisma_migrations ORDER BY migration_name';
    assert.equal(restoredQuery(migrationSnapshot), query(migrationSnapshot));
    f.run(['run', '--rm', '--no-deps', '-e', 'DATABASE_URL=postgresql://crmuser:fixture-password-only@db:5432/zalocrm_restore', 'migrator']);
    assert.equal(restoredQuery(migrationSnapshot), query(migrationSnapshot));
    assert.equal(restoredQuery('SELECT value FROM restore_probe'), 'fixture-preserved');
    query('DROP TABLE restore_probe');
    f.run(['exec', '-T', 'db', 'dropdb', '-U', 'crmuser', 'zalocrm_restore']);
    f.run(['exec', '-T', 'db', 'rm', '/tmp/fixture-backup.dump']);
    const lastMigration = query('SELECT migration_name FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 1');
    assert.match(lastMigration, /^[a-zA-Z0-9_]+$/);
    const checksum = query(`SELECT checksum FROM _prisma_migrations WHERE migration_name='${lastMigration}'`);
    assert.match(checksum, /^[a-f0-9]{64}$/);
    query(`UPDATE _prisma_migrations SET checksum=repeat('0',64) WHERE migration_name='${lastMigration}'`);
    assert.equal((await fetch('http://localhost:13080/health')).status, 503, 'Wrong schema must not advertise readiness');
    query(`UPDATE _prisma_migrations SET checksum='${checksum}' WHERE migration_name='${lastMigration}'`);
    await waitFor('http://localhost:13080/health');
    const firstJob = f.run(['ps', '-aq', 'migrator'], { capture: true });
    deploy({ ...f, build: false, backup: false });
    assert.notEqual(f.run(['ps', '-aq', 'migrator'], { capture: true }), firstJob);
    // A failed migration on the next deploy must leave the old app stopped.
    const failure = join(f.dir, 'failure.json');
    writeFileSync(failure, JSON.stringify({ services: { migrator: { command: ['node', '-e', 'process.exit(42)'] } } }));
    assert.throws(() => deploy({ ...f, composeArgs: [...f.composeArgs, '-f', failure], build: false, backup: false }), /Migration failed/);
    assert.equal(f.run(['ps', '--status', 'running', '-q', 'app'], { capture: true }), '');
    deploy({ ...f, build: false, backup: false });
    const beforeDrainFailure = f.run(['ps', '-aq', 'migrator'], { capture: true });
    const failedDrain = join(f.dir, 'failed-drain.json');
    writeFileSync(failedDrain, JSON.stringify({ services: { app: {
      command: ['node', '-e', "process.on('SIGTERM',()=>process.exit(42));console.log('drain-fixture-ready');setInterval(()=>{},1000)"],
      healthcheck: { disable: true },
    } } }));
    f.run(['stop', '--timeout', '70', 'app']);
    docker(['compose', ...f.composeArgs, '-f', failedDrain, 'up', '-d', '--no-deps', '--force-recreate', 'app'], { env: f.env });
    const badApp = f.run(['ps', '-q', 'app'], { capture: true });
    for (let attempt = 0; attempt < 30; attempt++) {
      if (docker(['logs', badApp], { capture: true }).includes('drain-fixture-ready')) break;
      await new Promise(resolveReady => setTimeout(resolveReady, 100));
    }
    assert.match(docker(['logs', badApp], { capture: true }), /drain-fixture-ready/);
    assert.throws(() => deploy({ ...f, build: false, backup: false }), /did not drain cleanly/);
    assert.equal(f.run(['ps', '-aq', 'migrator'], { capture: true }), beforeDrainFailure);
    f.run(['rm', '-f', 'app']);
    // A process that ignores SIGTERM must hit the real stop deadline and still
    // leave the migrator untouched; checking a voluntary failure is not enough.
    writeFileSync(failedDrain, JSON.stringify({ services: { app: {
      command: ['node', '-e', "process.on('SIGTERM',()=>{});console.log('drain-timeout-ready');setInterval(()=>{},1000)"],
      healthcheck: { disable: true },
    } } }));
    docker(['compose', ...f.composeArgs, '-f', failedDrain, 'up', '-d', '--no-deps', '--force-recreate', 'app'], { env: f.env });
    const stuckApp = f.run(['ps', '-q', 'app'], { capture: true });
    for (let attempt = 0; attempt < 30; attempt++) {
      if (docker(['logs', stuckApp], { capture: true }).includes('drain-timeout-ready')) break;
      await new Promise(resolveReady => setTimeout(resolveReady, 100));
    }
    assert.match(docker(['logs', stuckApp], { capture: true }), /drain-timeout-ready/);
    assert.throws(() => deploy({ ...f, build: false, backup: false }), /did not drain cleanly/);
    assert.equal(docker(['inspect', stuckApp, '--format', '{{.State.ExitCode}}'], { capture: true }), '137');
    assert.equal(f.run(['ps', '-aq', 'migrator'], { capture: true }), beforeDrainFailure);
    f.run(['rm', '-f', 'app']);

    // Multi-replica scaling must be rejected before cutover (Decision 4)
    const multiReplica = join(f.dir, 'multi-replica.json');
    writeFileSync(multiReplica, JSON.stringify({ services: { app: { deploy: { replicas: 2 } } } }));
    assert.throws(
      () => deploy({ ...f, composeArgs: [...f.composeArgs, '-f', multiReplica], build: false, backup: false }),
      /exactly 1 app replica/,
    );

    deploy({ ...f, build: false, backup: false });
    console.log('PASS backup restore, schema mismatch readiness, failed and timed-out drain abort, single-replica gate, production inventory, offline CLI, fresh migration, rerun, failed migration gate, recovery, UI/API/socket/health');
  } finally { f.cleanup(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verify().catch(error => { console.error(error); process.exitCode = 1; });
}
