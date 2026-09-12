import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const packageName = (path) => path.split('node_modules/').at(-1);

// Resolve lockfile edges with Node's ancestor lookup, including nested installations.
function resolveDependency(packages, from, name) {
  let directory = from;
  while (true) {
    const candidate = `${directory ? `${directory}/` : ''}node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!directory) return undefined;
    directory = directory.includes('/') ? directory.slice(0, directory.lastIndexOf('/')) : '';
  }
}

function validChain(waiver, packages) {
  const chain = waiver.chain;
  if (!Array.isArray(chain) || chain.length < 2) return false;
  for (let index = 0; index < chain.length; index++) {
    const entry = chain[index];
    if (!object(entry) || packages[entry.path]?.version !== entry.version) return false;
    if (!index) continue;
    const previous = chain[index - 1];
    const name = packageName(entry.path);
    const dependencies = { ...packages[previous.path].dependencies, ...packages[previous.path].optionalDependencies };
    if (!dependencies[name] || resolveDependency(packages, previous.path, name) !== entry.path) return false;
    // A newly added consumer must not inherit a waiver for the Prisma-only chain.
    for (const [path, pkg] of Object.entries(packages)) {
      if (pkg.link) continue;
      const edges = { ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies, ...pkg.devDependencies };
      if (edges[name] && resolveDependency(packages, path, name) === entry.path && path !== previous.path) return false;
    }
  }
  return true;
}

/** Pure policy evaluation. Tool, JSON, schema, and lock mismatches fail closed. */
export function evaluateProductionAudit({ stdout, status, error, signal, lockfile, allowlist }) {
  const blocked = [];
  const waived = [];
  try {
    assert(!error && !signal && (status === 0 || status === 1), 'npm audit execution failed');
    const audit = JSON.parse(stdout);
    assert(object(audit) && !audit.error && audit.auditReportVersion === 2 && object(audit.vulnerabilities), 'Invalid audit report schema');
    assert(object(lockfile) && [2, 3].includes(lockfile.lockfileVersion) && object(lockfile.packages), 'Invalid lockfile schema');
    assert(object(allowlist) && allowlist.schemaVersion === 1 && Array.isArray(allowlist.waivers), 'Invalid allowlist schema');
    for (const waiver of allowlist.waivers) {
      assert(object(waiver) && /^GHSA-[a-z0-9-]+$/.test(waiver.advisoryId) && typeof waiver.package === 'string' &&
        Array.isArray(waiver.chain) && waiver.chain.length >= 2 && waiver.chain.every((entry) => object(entry) &&
          typeof entry.path === 'string' && typeof entry.version === 'string'), 'Invalid waiver schema');
    }
    const counts = audit.metadata?.vulnerabilities;
    assert(object(counts) && [...severities, 'total'].every((key) => Number.isInteger(counts[key]) && counts[key] >= 0), 'Invalid audit counts');
    const findings = audit.vulnerabilities;
    assert(counts.total === Object.keys(findings).length && counts.total === severities.reduce((sum, key) => sum + counts[key], 0), 'Inconsistent audit counts');
    assert(status === (counts.total ? 1 : 0), 'Unexpected npm audit exit status');
    for (const [name, finding] of Object.entries(findings)) {
      assert(object(finding) && finding.name === name && severities.includes(finding.severity), `Invalid finding ${name}`);
      assert(Array.isArray(finding.nodes) && finding.nodes.length > 0 && finding.nodes.every((path) => typeof path === 'string' && typeof lockfile.packages[path]?.version === 'string' && packageName(path) === name), `Invalid lock nodes for ${name}`);
      assert(Array.isArray(finding.via) && finding.via.length > 0, `Invalid advisory sources for ${name}`);
      for (const via of finding.via) {
        assert(typeof via === 'string' ? Object.hasOwn(findings, via) : object(via) && typeof via.url === 'string' && Number.isInteger(via.source) && via.name === name && via.dependency === name && severities.includes(via.severity), `Invalid advisory source for ${name}`);
      }
    }
    const visiting = new Set();
    const results = new Map();
    function accepted(name) {
      if (results.has(name)) return results.get(name);
      assert(!visiting.has(name), `Cyclic advisory sources at ${name}`);
      visiting.add(name);
      const finding = findings[name];
      // Evaluate every source, including mixed parent + direct advisories.
      const decisions = finding.via.map((via) => {
        if (typeof via === 'string') {
          const childAccepted = accepted(via);
          return childAccepted && finding.nodes.every((path) => {
            const pkg = lockfile.packages[path];
            const edges = { ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies, ...pkg.devDependencies };
            return edges[via] && findings[via].nodes.includes(resolveDependency(lockfile.packages, path, via));
          });
        }
        const match = allowlist.waivers.find((waiver) =>
          via.url === `https://github.com/advisories/${waiver.advisoryId}` && waiver.package === name &&
          finding.nodes.every((path) => path === waiver.chain?.at(-1)?.path) && validChain(waiver, lockfile.packages));
        if (match) waived.push(`${name}: ${match.advisoryId} (${finding.nodes.join(', ')})`);
        else blocked.push(`${name}: ${via.url} (${finding.nodes.map((path) => `${path}@${lockfile.packages[path].version}`).join(', ')})`);
        return Boolean(match);
      });
      const result = decisions.every(Boolean);
      if (!result && finding.via.some((via) => typeof via === 'string')) blocked.push(`${name}: propagated advisory is not fully waived`);
      visiting.delete(name);
      results.set(name, result);
      return result;
    }
    for (const name of Object.keys(findings)) accepted(name);
    return { ok: blocked.length === 0, blocked, waived };
  } catch (failure) {
    return { ok: false, blocked: [...blocked, failure.message], waived };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const audit = spawnSync('npm', ['audit', '--omit=dev', '--json'], { cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    const result = evaluateProductionAudit({ ...audit,
      lockfile: JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8')),
      allowlist: JSON.parse(readFileSync(resolve(root, 'scripts/audit-production-allowlist.json'), 'utf8')),
    });
    for (const entry of result.waived) process.stdout.write(`WAIVED ${entry}\n`);
    for (const entry of result.blocked) process.stderr.write(`BLOCKED ${entry}\n`);
    process.stdout.write(`Production audit policy: ${result.ok ? 'PASS' : 'FAIL'}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Production audit policy failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
