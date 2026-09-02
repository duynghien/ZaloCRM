import { lookup } from 'node:dns/promises';
import https from 'node:https';
import fs from 'node:fs';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;

export interface PublicFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
}

export interface PublicFetchResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  body: Buffer;
  url: string;
}

export interface PublicFileDownload {
  status: number;
  ok: boolean;
  headers: Headers;
  bytes: number;
  url: string;
}

export class OutboundUrlPolicyError extends Error {}

function ipv4ToNumber(address: string): number {
  return address.split('.').reduce((value, part) => value * 256 + Number(part), 0);
}

function isPrivateIpv4(address: string): boolean {
  const value = ipv4ToNumber(address);
  const inRange = (network: string, prefix: number) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (ipv4ToNumber(network) & mask);
  };
  return [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
    ['224.0.0.0', 4], ['240.0.0.0', 4],
  ].some(([network, prefix]) => inRange(network as string, prefix as number));
}

function parseIpv6(address: string): number[] | null {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  const mapped = normalized.lastIndexOf(':');
  if (normalized.includes('.') && mapped >= 0) {
    const ipv4 = normalized.slice(mapped + 1);
    if (isIP(ipv4) !== 4) return null;
    const parts = ipv4.split('.').map(Number);
    return parseIpv6(`${normalized.slice(0, mapped)}:${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`);
  }
  const [left, right = ''] = normalized.split('::');
  if (normalized.split('::').length > 2) return null;
  const leftParts = left ? left.split(':') : [];
  const rightParts = right ? right.split(':') : [];
  if (leftParts.length + rightParts.length > 8) return null;
  const parts = [...leftParts, ...Array(8 - leftParts.length - rightParts.length).fill('0'), ...rightParts];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.map((part) => Number.parseInt(part, 16));
}

function isPrivateIpv6(address: string): boolean {
  const parts = parseIpv6(address);
  if (!parts) return true;
  const mappedIpv4 = parts.slice(0, 6).every((part, index) => index < 5 ? part === 0 : part === 0xffff);
  if (mappedIpv4) return isPrivateIpv4(`${parts[6] >> 8}.${parts[6] & 255}.${parts[7] >> 8}.${parts[7] & 255}`);
  if (parts.every((part) => part === 0) || parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1) return true;
  if ((parts[0] & 0xfe00) === 0xfc00 || (parts[0] & 0xffc0) === 0xfe80 || (parts[0] & 0xff00) === 0xff00) return true;
  return (parts[0] === 0x2001 && [0, 2, 0x10, 0x20, 0xdb8].includes(parts[1]));
}

export function isPublicIp(address: string): boolean {
  const version = isIP(address);
  return version === 4 ? !isPrivateIpv4(address) : version === 6 ? !isPrivateIpv6(address) : false;
}

async function resolvePublicAddress(url: URL): Promise<string> {
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) {
    throw new OutboundUrlPolicyError('Outbound URL must be HTTPS, public, and contain no credentials');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname.toLowerCase() === 'localhost') throw new OutboundUrlPolicyError('Outbound URL host is not public');
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new OutboundUrlPolicyError('Outbound URL resolves to a non-public address');
  }
  return addresses[0].address;
}

async function requestPinned(url: URL, address: string, options: PublicFetchOptions): Promise<PublicFetchResponse> {
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  return new Promise((resolve, reject) => {
    const request = https.request({
      protocol: 'https:', hostname: url.hostname, port: url.port || 443,
      path: `${url.pathname}${url.search}`, method: options.method ?? 'GET', headers: options.headers,
      servername: url.hostname.replace(/^\[|\]$/g, ''),
      lookup: (_hostname, _options, callback) => callback(null, address, isIP(address)),
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxResponseBytes) {
          request.destroy(new Error('Outbound response exceeds size limit'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({
        status: response.statusCode ?? 500,
        ok: (response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300,
        headers: new Headers(Object.entries(response.headers).flatMap(([key, value]): [string, string][] => value === undefined ? [] : [[key, Array.isArray(value) ? value.join(', ') : value]])),
        body: Buffer.concat(chunks), url: url.toString(),
      }));
    });
    request.once('timeout', () => request.destroy(new Error('Outbound request timed out')));
    request.once('error', reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

async function requestPinnedToFile(url: URL, address: string, targetPath: string, options: PublicFetchOptions): Promise<PublicFileDownload> {
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  return new Promise((resolve, reject) => {
    let completed = false;
    let responseStream: IncomingMessage | undefined;
    let file: fs.WriteStream | undefined;
    const rejectAndCleanup = (error: Error) => {
      if (completed) return;
      completed = true;
      responseStream?.destroy(error);
      file?.destroy();
      void fs.promises.unlink(targetPath).catch(() => undefined).finally(() => reject(error));
    };
    const request = https.request({ protocol: 'https:', hostname: url.hostname, port: url.port || 443, path: `${url.pathname}${url.search}`, method: options.method ?? 'GET', headers: options.headers, servername: url.hostname.replace(/^\[|\]$/g, ''), lookup: (_hostname, _options, callback) => callback(null, address, isIP(address)), timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS }, (response) => {
      responseStream = response;
      const status = response.statusCode ?? 500;
      const headers = new Headers(Object.entries(response.headers).flatMap(([key, value]): [string, string][] => value === undefined ? [] : [[key, Array.isArray(value) ? value.join(', ') : value]]));
      const contentLength = Number.parseInt(headers.get('content-length') || '', 10);
      if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
        response.destroy();
        rejectAndCleanup(new Error('Outbound response exceeds size limit'));
        return;
      }
      file = fs.createWriteStream(targetPath, { flags: 'wx' });
      const outputFile = file;
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxResponseBytes) {
          request.destroy(new Error('Outbound response exceeds size limit'));
          return;
        }
        if (!outputFile.write(chunk)) response.pause(), outputFile.once('drain', () => response.resume());
      });
      response.once('error', rejectAndCleanup);
      outputFile.once('error', rejectAndCleanup);
      response.once('end', () => outputFile.end());
      outputFile.once('finish', () => {
        if (completed) return;
        completed = true;
        resolve({ status, ok: status >= 200 && status < 300, headers, bytes, url: url.toString() });
      });
    });
    request.once('timeout', () => request.destroy(new Error('Outbound request timed out')));
    request.once('error', rejectAndCleanup);
    request.end();
  });
}

/** HTTPS-only request that validates every DNS answer and pins the validated address. */
export async function fetchPublicHttps(rawUrl: string, options: PublicFetchOptions = {}): Promise<PublicFetchResponse> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new OutboundUrlPolicyError('Outbound URL is invalid');
  }
  const redirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  for (let hop = 0; hop <= redirects; hop++) {
    const address = await resolvePublicAddress(url);
    const response = await requestPinned(url, address, options);
    const location = response.headers.get('location');
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) return response;
    if (hop === redirects) throw new OutboundUrlPolicyError('Outbound redirect limit exceeded');
    url = new URL(location, url);
    if (response.status === 303) {
      options = { ...options, method: 'GET', body: undefined };
    }
  }
  throw new OutboundUrlPolicyError('Outbound redirect limit exceeded');
}

/** Streams a validated HTTPS response to disk; redirects are revalidated per hop. */
export async function downloadPublicHttpsToFile(rawUrl: string, targetPath: string, options: PublicFetchOptions = {}): Promise<PublicFileDownload> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new OutboundUrlPolicyError('Outbound URL is invalid'); }
  const redirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  for (let hop = 0; hop <= redirects; hop++) {
    const address = await resolvePublicAddress(url);
    const response = await requestPinnedToFile(url, address, targetPath, options);
    const location = response.headers.get('location');
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) return response;
    await fs.promises.unlink(targetPath).catch(() => undefined);
    if (hop === redirects) throw new OutboundUrlPolicyError('Outbound redirect limit exceeded');
    url = new URL(location, url);
  }
  throw new OutboundUrlPolicyError('Outbound redirect limit exceeded');
}
