import { EventEmitter } from 'node:events';
import https from 'node:https';
import { PassThrough } from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, afterAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';
const previousUploadDir = process.env.UPLOAD_DIR;
const dns = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', async original => ({ ...await original<object>(), lookup: dns }));
let fixture: Awaited<ReturnType<typeof createTestApp>>;
let deliver: typeof import('../../src/modules/api/webhook-service.js').deliverWebhook;
let download: typeof import('../../src/modules/attachments/attachment-downloader.js').downloadAttachment;
let dir: string; let orgId: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'outbound-policy-')); process.env.UPLOAD_DIR = dir;
  fixture = await createTestApp();
  deliver = (await import('../../src/modules/api/webhook-service.js')).deliverWebhook;
  download = (await import('../../src/modules/attachments/attachment-downloader.js')).downloadAttachment;
  orgId = (await fixture.prisma.organization.create({ data: { name: 'Outbound policy' } })).id;
}, 120_000);
beforeEach(() => { dns.mockReset(); dns.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]); });
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(path.join(dir, 'attachments'), { recursive: true, force: true }); });
afterAll(async () => {
  await fixture?.close(); await fs.rm(dir, { recursive: true, force: true });
  if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previousUploadDir;
});
type Reply = { status?: number; location?: string; bytes?: number; timeout?: boolean; contentLength?: number };
function transport(replies: Reply[]) {
  const pinned: string[] = []; const observed: any[] = [];
  const request = vi.spyOn(https, 'request').mockImplementation(((options: any, callback: any) => {
    observed.push(options);
    options.lookup(options.hostname, {}, (error: any, address: string) => { expect(error).toBeNull(); pinned.push(address); });
    const reply = replies.shift() ?? {}; let response: PassThrough | undefined;
    const req = Object.assign(new EventEmitter(), { write: vi.fn(), end() {
      setImmediate(() => {
        response = Object.assign(new PassThrough(), { statusCode: reply.status ?? 200, headers: { 'content-type': 'application/octet-stream', ...(reply.location ? { location: reply.location } : {}), ...(reply.contentLength ? { 'content-length': String(reply.contentLength) } : {}) } });
        callback(response);
        if (reply.timeout) { response.write('partial bytes'); setImmediate(() => req.emit('timeout')); }
        else response.end(Buffer.alloc(reply.bytes ?? 2));
      });
    }, destroy(error: Error) { response?.destroy(); req.emit('error', error); } });
    return req;
  }) as any);
  return { request, pinned, observed };
}
async function invoke(kind: string, url: string) {
  if (kind === 'download') return download(url, { originalFilename: 'test.bin', timeoutMs: 25 });
  await fixture.prisma.appSetting.upsert({ where: { orgId_settingKey: { orgId, settingKey: 'webhook_url' } }, create: { orgId, settingKey: 'webhook_url', valuePlain: url }, update: { valuePlain: url } });
  return deliver(orgId, 'test.delivery', { message: 'test' });
}
async function denied(kind: string, url: string) {
  if (kind === 'download') expect(await invoke(kind, url)).toBeNull();
  else await expect(invoke(kind, url)).rejects.toThrow();
  expect(await fs.readdir(path.join(dir, 'attachments')).catch(() => [])).toEqual([]);
}
for (const kind of ['webhook', 'download']) {
  it.each(['http://public.example/file', 'https://user:secret@public.example/file', 'https://2130706433/file', 'https://0x7f000001/file', 'https://[::ffff:127.0.0.1]/file'])(`${kind} rejects unsafe URL %s before transport`, async url => {
    const t = transport([]); await denied(kind, url); expect(t.request).not.toHaveBeenCalled();
  });
  it(`${kind} rejects mixed public/private DNS answers before transport`, async () => {
    dns.mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '169.254.169.254', family: 4 }]);
    const t = transport([]); await denied(kind, 'https://cdn.example/file'); expect(t.request).not.toHaveBeenCalled();
  });
  it(`${kind} pins the validated address and rechecks DNS on same-host redirects`, async () => {
    dns.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]).mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const t = transport([{ status: 302, location: '/rebound' }]); await denied(kind, 'https://cdn.example/file');
    expect(t.pinned).toEqual(['8.8.8.8']); expect(t.observed[0].servername).toBe('cdn.example'); expect(dns).toHaveBeenCalledTimes(2);
  });
  it.each(['https://169.254.169.254/latest', 'http://cdn.example/file', 'https://name:secret@cdn.example/file'])(`${kind} rejects redirect escape %s`, async location => {
    const t = transport([{ status: 302, location }]); await denied(kind, 'https://cdn.example/file'); expect(t.request).toHaveBeenCalledOnce();
  });
  it(`${kind} bounds redirect loops`, async () => {
    const t = transport(Array.from({ length: 5 }, () => ({ status: 302, location: '/loop' }))); await denied(kind, 'https://cdn.example/loop'); expect(t.request).toHaveBeenCalledTimes(4);
  });
  it(`${kind} aborts timeout and streamed byte overflow with no partial files`, async () => {
    const timeout = transport([{ timeout: true }]); await denied(kind, 'https://cdn.example/file');
    expect(timeout.observed[0].timeout).toBe(kind === 'download' ? 25 : 10_000); timeout.request.mockRestore();
    const overflow = transport([{ bytes: (kind === 'download' ? 10 : 1) * 1024 * 1024 + 1 }]); await denied(kind, 'https://cdn.example/file'); expect(overflow.request).toHaveBeenCalledOnce();
  });
  it(`${kind} successfully delivers through the public pinned transport`, async () => {
    const t = transport([{ bytes: 12 }]); const result = await invoke(kind, 'https://cdn.example/file'); expect(result).not.toBeNull(); expect(t.pinned).toEqual(['8.8.8.8']); expect(dns).toHaveBeenCalledOnce();
    if (kind === 'download') { expect(await fs.readFile((result as any).localPath)).toHaveLength(12); expect((await fs.readdir(path.join(dir, 'attachments'))).some(name => name.endsWith('.part'))).toBe(false); }
    else { expect(result).toMatchObject({ status: 200 }); expect(t.observed[0].method).toBe('POST'); }
  });
}
it('downloader rejects oversized content-length before writing a file', async () => {
  transport([{ contentLength: 10 * 1024 * 1024 + 1 }]); await denied('download', 'https://cdn.example/file');
});
