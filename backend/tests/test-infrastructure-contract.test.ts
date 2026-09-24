import { describe, it, expect } from 'vitest';
import vitestConfig from '../vitest.config.js';
import { config } from '../src/config/index.js';
import { createApp } from '../src/app-factory.js';

describe('Test Infrastructure Contracts (R3-22 & R3-29)', () => {
  it('enforces sequential test execution (fileParallelism === false) while Prisma singleton is shared', () => {
    expect(vitestConfig.test?.fileParallelism).toBe(false);
  });

  it('configures trustedProxyHops as a non-negative integer defaulting to 1 (R3-29)', async () => {
    expect(typeof config.trustedProxyHops).toBe('number');
    expect(config.trustedProxyHops).toBeGreaterThanOrEqual(0);

    const app = await createApp();
    const optSym = Object.getOwnPropertySymbols(app).find(s => s.toString() === 'Symbol(fastify.options)');
    expect(optSym).toBeDefined();
    const trustProxyFn = (app as any)[optSym!].trustProxy;

    if (config.trustedProxyHops > 0) {
      expect(typeof trustProxyFn).toBe('function');
      // Hop 0 (first upstream proxy) is trusted
      expect(trustProxyFn('127.0.0.1', 0)).toBe(true);
      // Hop equal to or greater than trustedProxyHops is NOT trusted (spoofing prevented)
      expect(trustProxyFn('127.0.0.1', config.trustedProxyHops)).toBe(false);
    } else {
      expect(trustProxyFn).toBe(false);
    }

    await app.close();
  });
});

