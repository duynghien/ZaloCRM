import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Ephemeral key/certificate are owned by the fixture and never enter the repository. */
export async function createBrowserTls() {
  const directory = await mkdtemp(path.join(tmpdir(), 'zalocrm-browser-tls-'));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem'),
      '-days', '1', '-subj', '/CN=127.0.0.1']);
    const key = await readFile(path.join(directory, 'key.pem'));
    const cert = await readFile(path.join(directory, 'cert.pem'));
    // Fastify consumes buffers; remove sensitive temporary files before the server starts.
    await cleanup();
    return { key, cert, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
