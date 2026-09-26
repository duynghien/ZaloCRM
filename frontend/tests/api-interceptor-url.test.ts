import { describe, it, expect, vi } from 'vitest';
import { api } from '../src/api/index';

describe('Axios Request Interceptor URL Normalization', () => {
  it('normalizes URLs to prevent duplicate /api/v1 prefixes', async () => {
    let capturedConfig: any = null;

    const fakeAdapter = vi.fn().mockImplementation(async (cfg) => {
      capturedConfig = cfg;
      return {
        data: { success: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: cfg,
      };
    });

    // 1. Standard relative URL
    await api.get('/conversation-tags', { adapter: fakeAdapter });
    expect(capturedConfig.url).toBe('/conversation-tags');

    // 2. Accidental /api/v1 prefix
    await api.get('/api/v1/conversation-tags', { adapter: fakeAdapter });
    expect(capturedConfig.url).toBe('/conversation-tags');

    // 3. Accidental api/v1 prefix without leading slash
    await api.post('api/v1/conversation-tags', { name: 'test' }, { adapter: fakeAdapter });
    expect(capturedConfig.url).toBe('/conversation-tags');

    // 4. Duplicate /api/v1/api/v1 prefix
    await api.get('/api/v1/api/v1/conversation-tags', { adapter: fakeAdapter });
    expect(capturedConfig.url).toBe('/conversation-tags');

    // 5. Quick replies with /api/v1 prefix
    await api.get('/api/v1/quick-replies', { adapter: fakeAdapter });
    expect(capturedConfig.url).toBe('/quick-replies');
  });
});
