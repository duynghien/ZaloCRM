import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useKiotviet } from '../src/composables/use-kiotviet';
import { api } from '../src/api/index';

describe('KiotViet Settings & Catalog Composable', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('gets public config without exposing secret', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      data: {
        clientId: 'client-abc',
        retailer: 'myshop',
        branchId: '123',
        autoSync: true,
        soldById: '1',
        paymentAccountId: '2',
        secretConfigured: true,
        configRevision: 5,
        catalogReady: true,
        lastSuccessfulSyncAt: '2026-09-21T10:00:00.000Z',
      },
    });

    const { getPublicConfig } = useKiotviet();
    const config = await getPublicConfig();

    expect(config.clientId).toBe('client-abc');
    expect(config.secretConfigured).toBe(true);
    expect(config.configRevision).toBe(5);
    expect((config as any).clientSecret).toBeUndefined();
    expect(api.get).toHaveBeenCalledWith('/kiotviet/config/public');
  });

  it('tests connection with draft credentials', async () => {
    vi.spyOn(api, 'post').mockResolvedValueOnce({
      data: { success: true, message: 'Connected' },
    });

    const { testConnection } = useKiotviet();
    const res = await testConnection({
      clientId: 'c1',
      clientSecret: 's1',
      retailer: 'shop1',
    });

    expect(res.success).toBe(true);
    expect(api.post).toHaveBeenCalledWith('/kiotviet/test-connection', {
      clientId: 'c1',
      clientSecret: 's1',
      retailer: 'shop1',
    });
  });

  it('saves config with expectedRevision fence', async () => {
    vi.spyOn(api, 'put').mockResolvedValueOnce({
      data: { success: true, config: { configRevision: 6 } },
    });

    const { saveConfig } = useKiotviet();
    const res = await saveConfig(
      {
        clientId: 'c1',
        retailer: 'shop1',
        branchId: '123',
        autoSync: true,
      },
      5
    );

    expect(res.success).toBe(true);
    expect(api.put).toHaveBeenCalledWith(
      '/kiotviet/config',
      {
        clientId: 'c1',
        retailer: 'shop1',
        branchId: '123',
        autoSync: true,
      },
      {
        params: { expectedRevision: 5 },
      }
    );
  });

  it('triggers catalog sync and retrieves catalog status', async () => {
    vi.spyOn(api, 'post').mockResolvedValueOnce({
      data: { message: 'Sync queued', full: false },
    });
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      data: {
        catalogReady: true,
        totalProducts: 150,
        activeProducts: 140,
        syncInProgress: false,
        lastSuccessfulAt: '2026-09-21T11:00:00.000Z',
      },
    });

    const { triggerCatalogSync, getCatalogStatus } = useKiotviet();
    const triggerRes = await triggerCatalogSync(false);
    expect(triggerRes.message).toBe('Sync queued');

    const status = await getCatalogStatus();
    expect(status.totalProducts).toBe(150);
    expect(status.catalogReady).toBe(true);
  });
});
