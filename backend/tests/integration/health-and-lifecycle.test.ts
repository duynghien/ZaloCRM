import { fork } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { startDisposablePostgres, migrateDisposablePostgres, seedBackendTestEnv, type DisposablePostgres } from '../helpers/disposable-postgres.js';
let database: DisposablePostgres;
beforeAll(async () => { database = await startDisposablePostgres(); await migrateDisposablePostgres(database.databaseUrl); seedBackendTestEnv(database.databaseUrl); }, 120_000);
afterAll(async () => { await database?.stop(); });
async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = (server.address() as net.AddressInfo).port; server.close(error => error ? reject(error) : resolve(port)); });
  });
}
it.each(['exception', 'rejection', 'SIGTERM'])('production lifecycle drains and exits after %s', async fault => {
  const port = await freePort();
  const child = fork(fileURLToPath(new URL('../helpers/fatal-lifecycle-child.ts', import.meta.url)), [], {
    execArgv: ['--import', 'tsx'], silent: true,
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), HOST: '127.0.0.1', APP_URL: `http://127.0.0.1:${port}`, DATABASE_URL: database.databaseUrl, GEMINI_API_KEY: '' },
  });
  let diagnostics = ''; child.stdout?.on('data', data => { diagnostics = (diagnostics + String(data)).slice(-5000); }); child.stderr?.on('data', data => { diagnostics = (diagnostics + String(data)).slice(-5000); });
  let exited = false;
  const exit = new Promise<{ code: number | null; signal: string | null }>(resolve => child.once('exit', (code, signal) => { exited = true; resolve({ code, signal }); }));
  try {
    const deadline = Date.now() + 15_000; let ready = false;
    while (!ready && Date.now() < deadline && !exited) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
      if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(ready, diagnostics).toBe(true);
    if (fault === 'SIGTERM') child.kill('SIGTERM'); else child.send(fault);
    const outcome = await Promise.race([exit, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('Fatal lifecycle did not exit within deadline')), 15_000); timer.unref(); })]);
    expect(outcome.signal).toBeNull(); expect(outcome.code).toBe(fault === 'SIGTERM' ? 0 : 1);
    await expect(fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
  } finally {
    if (!exited) { child.kill('SIGTERM'); await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 2000))]); }
    if (!exited) { child.kill('SIGKILL'); await exit; }
  }
}, 40_000);
