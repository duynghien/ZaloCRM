import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error standalone Node policy intentionally has no build dependency
import { evaluateProductionAudit } from '../../scripts/audit-production-policy.mjs';

const allowlist = JSON.parse(readFileSync(new URL('../../scripts/audit-production-allowlist.json', import.meta.url), 'utf8'));
const leaf = (name: string, id: string) => ({ name, dependency: name, source: 1234, severity: 'high', url: `https://github.com/advisories/${id}` });
function fixture() {
  const lockfile: any = { lockfileVersion: 3, packages: {
    'node_modules/prisma': { version: '7.10.0', dependencies: { '@prisma/config': '7.10.0', mysql2: '3.15.3' } },
    'node_modules/@prisma/config': { version: '7.10.0', dependencies: { 'deepmerge-ts': '7.1.5' } },
    'node_modules/deepmerge-ts': { version: '7.1.5' },
    'node_modules/mysql2': { version: '3.15.3' },
  } };
  const vulnerabilities: any = {};
  for (const [name, via] of Object.entries({ prisma: ['@prisma/config', 'mysql2'], '@prisma/config': ['deepmerge-ts'],
    'deepmerge-ts': [leaf('deepmerge-ts', 'GHSA-ggr8-5vv4-36mx')], mysql2: [leaf('mysql2', 'GHSA-3f6p-5ww8-9rcr')] })) {
    vulnerabilities[name] = { name, severity: 'high', nodes: [`node_modules/${name}`], via };
  }
  const audit: any = { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 4, critical: 0, total: 4 } } };
  return { lockfile, audit };
}
function evaluate(f = fixture(), override = {}) {
  return evaluateProductionAudit({ stdout: JSON.stringify(f.audit), status: 1, lockfile: f.lockfile, allowlist, ...override });
}

describe('production audit exact advisory policy', () => {
  it('accepts only the two reviewed leaves and fully approved parents', () => {
    expect(evaluate()).toMatchObject({ ok: true, blocked: [], waived: expect.any(Array) });
    expect(evaluate().waived).toHaveLength(2);
  });
  it.each(['low', 'moderate', 'high', 'critical'])('blocks a new %s advisory in an approved package', (severity) => {
    const f = fixture();
    f.audit.vulnerabilities.mysql2.via.push({ ...leaf('mysql2', 'GHSA-new-advisory'), severity });
    const result = evaluate(f);
    expect(result.ok).toBe(false);
    expect(result.blocked.join('\n')).toContain('prisma: propagated');
  });
  it('rejects a replacement advisory ID with the same baseline count', () => {
    const f = fixture();
    f.audit.vulnerabilities.mysql2.via[0].url = 'https://github.com/advisories/GHSA-rgwj-5xj2-c3m3';
    expect(evaluate(f).ok).toBe(false);
  });
  it.each(['node_modules/mysql2', 'node_modules/prisma', 'node_modules/@prisma/config'])('rejects changed reviewed version at %s', (path) => {
    const f = fixture(); f.lockfile.packages[path].version = '99.0.0';
    expect(evaluate(f).ok).toBe(false);
  });
  it('rejects a new installation path', () => {
    const f = fixture();
    f.lockfile.packages['node_modules/prisma/node_modules/mysql2'] = { version: '3.15.3' };
    f.audit.vulnerabilities.mysql2.nodes = ['node_modules/prisma/node_modules/mysql2'];
    expect(evaluate(f).ok).toBe(false);
  });
  it('rejects a new consumer of the same hoisted leaf', () => {
    const f = fixture(); f.lockfile.packages.backend = { dependencies: { mysql2: '3.15.3' } };
    expect(evaluate(f).ok).toBe(false);
  });
  it('rejects a broken chain even when versions and advisory paths match', () => {
    const f = fixture(); delete f.lockfile.packages['node_modules/prisma'].dependencies.mysql2;
    expect(evaluate(f).ok).toBe(false);
  });
  it('blocks unapproved uuid and its ExcelJS parent', () => {
    const f = fixture();
    f.lockfile.packages['node_modules/uuid'] = { version: '8.3.2' };
    f.audit.vulnerabilities.uuid = { name: 'uuid', severity: 'moderate', nodes: ['node_modules/uuid'], via: [leaf('uuid', 'GHSA-w5hq-g745-h8pq')] };
    f.audit.metadata.vulnerabilities.moderate++; f.audit.metadata.vulnerabilities.total++;
    expect(evaluate(f).blocked.join('\n')).toContain('GHSA-w5hq-g745-h8pq');
  });
  it.each([{ stdout: '{' }, { stdout: '{}' }, { stdout: JSON.stringify({ error: { code: 'E503' } }) },
    { error: new Error('network failure') }, { status: 2 }, { status: null }, { signal: 'SIGTERM' }, { status: 0 }])('fails closed on tool/JSON failure %j', (override) => {
    expect(evaluate(fixture(), override).ok).toBe(false);
  });
  it.each(['nodes', 'via', 'name', 'severity'])('rejects a malformed finding missing %s', (key) => {
    const f = fixture(); delete f.audit.vulnerabilities.mysql2[key];
    expect(evaluate(f).ok).toBe(false);
  });
  it('accepts a newly propagated client wrapper only through real lock edges and approved leaves', () => {
    const f = fixture();
    f.lockfile.packages['node_modules/@prisma/client'] = { version: '7.10.0', peerDependencies: { prisma: '*' } };
    f.audit.vulnerabilities['@prisma/client'] = { name: '@prisma/client', severity: 'high', nodes: ['node_modules/@prisma/client'], via: ['prisma'] };
    f.audit.metadata.vulnerabilities.high++; f.audit.metadata.vulnerabilities.total++;
    expect(evaluate(f).ok).toBe(true);
    f.audit.vulnerabilities['@prisma/client'].via.push(leaf('@prisma/client', 'GHSA-new-risk'));
    expect(evaluate(f).ok).toBe(false);
    f.audit.vulnerabilities['@prisma/client'].via.pop();
    f.lockfile.packages['node_modules/deepmerge-ts'].version = '7.1.6';
    expect(evaluate(f).ok).toBe(false);
    f.lockfile.packages['node_modules/deepmerge-ts'].version = '7.1.5';
    delete f.lockfile.packages['node_modules/@prisma/client'].peerDependencies.prisma;
    expect(evaluate(f).ok).toBe(false);
  });
  it('rejects malformed waiver configuration', () => {
    expect(evaluate(fixture(), { allowlist: { schemaVersion: 1, waivers: [{}] } }).ok).toBe(false);
  });
  it('rejects inconsistent metadata', () => {
    const f = fixture(); f.audit.metadata.vulnerabilities.total = 0;
    expect(evaluate(f).ok).toBe(false);
  });
  it('rejects dangling and cyclic parent sources', () => {
    const f = fixture(); f.audit.vulnerabilities.mysql2.via = ['missing'];
    expect(evaluate(f).ok).toBe(false);
    f.audit.vulnerabilities.mysql2.via = ['prisma'];
    expect(evaluate(f).ok).toBe(false);
  });
  it('accepts an empty successful audit', () => {
    const f = fixture(); f.audit.vulnerabilities = {};
    f.audit.metadata.vulnerabilities.high = 0; f.audit.metadata.vulnerabilities.total = 0;
    expect(evaluate(f, { status: 0 }).ok).toBe(true);
    expect(evaluate(f).ok).toBe(false);
  });
});
