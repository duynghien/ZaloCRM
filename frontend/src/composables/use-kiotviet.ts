/**
 * Composable for KiotViet Integration
 *
 * Provides API access to KiotViet endpoints:
 * - Product search with abort controller
 * - Customer search and creation
 * - Configuration & connection test
 * - Catalog sync trigger & status
 * - Branch, seller, and payment account lookup
 */

import { ref } from 'vue';
import { api } from '@/api/index';

export interface KiotvietProductDto {
  id: string;
  kiotvietId: string;
  code: string;
  name: string;
  fullName: string;
  unit: string | null;
  price: number;
  cost: number;
  onHand: number;
  reserved: number;
  isActive: boolean;
  allowsSale: boolean;
  productType: string;
  hasSerial: boolean;
  hasBatch: boolean;
  branchId: string;
}

export interface KiotvietCustomerDto {
  id: string;
  code: string;
  name: string;
  contactNumber: string | null;
  address?: string | null;
  branchId?: string | null;
}

export interface KiotvietPublicConfigDto {
  clientId: string;
  retailer: string;
  branchId: string | null;
  autoSync: boolean;
  soldById: string | null;
  paymentAccountId: string | null;
  secretConfigured: boolean;
  configRevision: number;
  catalogReady: boolean;
  lastSuccessfulSyncAt: string | null;
}

export interface KiotvietCatalogStatusDto {
  catalogReady: boolean;
  lastSyncAt: string | null;
  lastSuccessfulAt: string | null;
  lastError: string | null;
  totalProducts: number;
  activeProducts: number;
  syncInProgress: boolean;
  syncLeaseExpiresAt: string | null;
}

export function useKiotviet() {
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Active abort controller for product search
  let productSearchController: AbortController | null = null;

  async function searchProducts(query: string, branchId?: string, limit = 20): Promise<KiotvietProductDto[]> {
    if (productSearchController) {
      productSearchController.abort();
    }
    productSearchController = new AbortController();

    try {
      const res = await api.get('/kiotviet/products', {
        params: { query: query.trim(), branchId, limit },
        signal: productSearchController.signal,
      });
      return res.data.products || [];
    } catch (err: any) {
      if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') {
        return [];
      }
      console.error('Failed to search KiotViet products:', err);
      throw err;
    } finally {
      productSearchController = null;
    }
  }

  async function searchCustomers(phone: string): Promise<KiotvietCustomerDto[]> {
    try {
      const res = await api.get('/kiotviet/customers/search', {
        params: { phone: phone.trim() },
      });
      return res.data.customers || [];
    } catch (err: any) {
      console.error('Failed to search KiotViet customers:', err);
      throw err;
    }
  }

  async function createCustomer(payload: {
    name: string;
    contactNumber: string;
    branchId: number;
    address?: string;
  }): Promise<KiotvietCustomerDto> {
    try {
      const res = await api.post('/kiotviet/customers', payload);
      return res.data.customer;
    } catch (err: any) {
      console.error('Failed to create KiotViet customer:', err);
      throw err;
    }
  }

  async function getPublicConfig(): Promise<KiotvietPublicConfigDto> {
    const res = await api.get('/kiotviet/config/public');
    return res.data;
  }

  async function getConfig(): Promise<any> {
    const res = await api.get('/kiotviet/config');
    return res.data;
  }

  async function saveConfig(payload: any, expectedRevision?: number): Promise<any> {
    const res = await api.put('/kiotviet/config', payload, {
      params: expectedRevision !== undefined ? { expectedRevision } : undefined,
    });
    return res.data;
  }

  async function testConnection(payload: {
    clientId: string;
    clientSecret?: string;
    retailer: string;
  }): Promise<{ success: boolean; message: string }> {
    const res = await api.post('/kiotviet/test-connection', payload);
    return res.data;
  }

  async function getBranches(): Promise<Array<{ id: number; name: string }>> {
    const res = await api.get('/kiotviet/branches');
    return res.data.branches || [];
  }

  async function getSellers(): Promise<Array<{ id: number; name: string; userName?: string }>> {
    const res = await api.get('/kiotviet/sellers');
    return res.data.sellers || [];
  }

  async function getPaymentAccounts(): Promise<Array<{ id: number; name: string; accountNumber?: string }>> {
    const res = await api.get('/kiotviet/payment-accounts');
    return res.data.paymentAccounts || [];
  }

  async function triggerCatalogSync(full = false): Promise<{ message: string; full: boolean }> {
    const res = await api.post('/kiotviet/catalog-sync', { full });
    return res.data;
  }

  async function getCatalogStatus(): Promise<KiotvietCatalogStatusDto> {
    const res = await api.get('/kiotviet/catalog-status');
    return res.data;
  }

  return {
    loading,
    error,
    searchProducts,
    searchCustomers,
    createCustomer,
    getPublicConfig,
    getConfig,
    saveConfig,
    testConnection,
    getBranches,
    getSellers,
    getPaymentAccounts,
    triggerCatalogSync,
    getCatalogStatus,
  };
}
