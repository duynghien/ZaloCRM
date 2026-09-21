import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useKiotviet } from '../src/composables/use-kiotviet';
import { api } from '../src/api/index';

describe('OrderItems & useKiotviet Composable', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('searches products with branchId and limit', async () => {
    const mockProducts = [
      {
        id: 'p-1',
        kiotvietId: '1001',
        code: 'SP001',
        name: 'Sản phẩm 1',
        fullName: 'Sản phẩm 1 đầy đủ',
        unit: 'Cái',
        price: 50000,
        cost: 30000,
        onHand: 15,
        reserved: 0,
        isActive: true,
        allowsSale: true,
        productType: 'normal',
        hasSerial: false,
        hasBatch: false,
        branchId: '123',
      },
    ];

    vi.spyOn(api, 'get').mockResolvedValueOnce({
      data: { products: mockProducts },
    });

    const { searchProducts } = useKiotviet();
    const results = await searchProducts('SP001', '123', 20);

    expect(results).toHaveLength(1);
    expect(results[0].code).toBe('SP001');
    expect(api.get).toHaveBeenCalledWith('/kiotviet/products', {
      params: { query: 'SP001', branchId: '123', limit: 20 },
      signal: expect.any(AbortSignal),
    });
  });

  it('searches customers by phone', async () => {
    const mockCustomers = [
      { id: '10', code: 'KH001', name: 'Nguyen Van A', contactNumber: '0901234567' },
    ];

    vi.spyOn(api, 'get').mockResolvedValueOnce({
      data: { customers: mockCustomers },
    });

    const { searchCustomers } = useKiotviet();
    const results = await searchCustomers('0901234567');

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Nguyen Van A');
    expect(api.get).toHaveBeenCalledWith('/kiotviet/customers/search', {
      params: { phone: '0901234567' },
    });
  });

  it('creates customer with name, phone, and branchId', async () => {
    const newCust = {
      id: '20',
      code: 'KH002',
      name: 'Tran Thi B',
      contactNumber: '0909999999',
      branchId: '123',
    };

    vi.spyOn(api, 'post').mockResolvedValueOnce({
      data: { customer: newCust },
    });

    const { createCustomer } = useKiotviet();
    const result = await createCustomer({
      name: 'Tran Thi B',
      contactNumber: '0909999999',
      branchId: 123,
    });

    expect(result.id).toBe('20');
    expect(api.post).toHaveBeenCalledWith('/kiotviet/customers', {
      name: 'Tran Thi B',
      contactNumber: '0909999999',
      branchId: 123,
    });
  });
});
