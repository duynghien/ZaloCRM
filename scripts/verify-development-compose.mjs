/** Real Vite/browser smoke; all edited sources are private fixture copies. */
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { fixture, waitFor } from './verify-production-container.mjs';

const f = await fixture('dev');
let browser;
try {
  const backend = join(f.dir, 'backend-src');
  const frontend = join(f.dir, 'frontend-src');
  cpSync('backend/src', backend, { recursive: true });
  cpSync('frontend/src', frontend, { recursive: true });
  const mounts = join(f.dir, 'mounts.json');
  writeFileSync(mounts, JSON.stringify({ services: {
    app: { volumes: [`${backend}:/app/backend/src`] },
    frontend: { volumes: [`${frontend}:/app/frontend/src`] },
  } }));
  f.composeArgs.push('-f', mounts);
  f.run(['up', '-d', '--build', '--wait', '--wait-timeout', '180']);
  const origin = 'http://localhost:15173';
  await waitFor(`${origin}/api/v1/setup/status`);
  assert.equal((await fetch(`${origin}/`)).status, 200);
  const email = 'container-fixture@example.invalid';
  const password = 'Fixture!Password987';
  const setup = await fetch(`${origin}/api/v1/setup`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orgName: 'Container fixture', fullName: 'Fixture Owner', email, password }),
  });
  assert.equal(setup.status, 200, await setup.text());
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const page = await browser.newPage();
  await page.goto(`${origin}/login`);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.waitForURL(url => !url.pathname.includes('login'));
  await page.reload();
  await page.waitForLoadState('networkidle');
  assert.ok(!page.url().includes('/login'), 'Session survives a browser reload');
  assert.equal(await page.evaluate(async () => {
    const csrf = document.cookie.split('; ').find(c => c.startsWith('zalo_crm_csrf='))?.split('=')[1];
    const response = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'x-csrf-token': csrf } });
    return response.status;
  }), 200);
  const cookieHeader = (await page.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ');
  const csrf = (await page.context().cookies()).find(c => c.name === 'zalo_crm_csrf').value;
  assert.equal((await fetch(`${origin}/api/v1/auth/refresh`, { method: 'POST', headers: {
    origin: 'https://foreign.invalid', cookie: cookieHeader, 'x-csrf-token': csrf,
  } })).status, 403);
  assert.equal(await page.evaluate(() => new Promise((resolveSocket, reject) => {
    const ws = new WebSocket(`ws://${location.host}/socket.io/?EIO=4&transport=websocket`);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('Socket proxy timeout')); }, 10000);
    ws.onmessage = event => { clearTimeout(timeout); ws.close(); resolveSocket(String(event.data).startsWith('0')); };
    ws.onerror = () => { clearTimeout(timeout); reject(new Error('Socket proxy failed')); };
  })), true);
  const vuePath = join(frontend, 'App.vue');
  writeFileSync(vuePath, readFileSync(vuePath, 'utf8').replace('<template>', '<template>\n<div id="container-hmr-proof">Container HMR verified</div>'));
  await page.locator('#container-hmr-proof').waitFor();
  const appPath = join(backend, 'app-factory.ts');
  writeFileSync(appPath, readFileSync(appPath, 'utf8').replace("  app.get('/health'", "  app.get('/api/container-hmr-proof', async () => ({ reloaded: true }));\n  app.get('/health'"));
  await waitFor(`${origin}/api/container-hmr-proof`, async response => response.ok && (await response.json()).reloaded === true);
  assert.equal(await page.evaluate(async () => {
    const csrfValue = () => document.cookie.split('; ').find(c => c.startsWith('zalo_crm_csrf='))?.split('=')[1];
    const response = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'x-csrf-token': csrfValue() } });
    const { token } = await response.json();
    return (await fetch('/api/v1/auth/logout', { method: 'POST', headers: {
      authorization: `Bearer ${token}`, 'x-csrf-token': csrfValue(),
    } })).status;
  }), 200);
  await page.reload();
  await page.waitForURL('**/login');
  console.log('PASS Vite browser login/reload/refresh/logout, foreign origin rejection, websocket proxy, Vue HMR and backend watch reload');
} finally {
  await browser?.close();
  f.cleanup();
}
