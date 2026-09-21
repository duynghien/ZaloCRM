/**
 * Shared types and contracts for KiotViet integration.
 */

export interface KiotvietConfig {
  clientId: string;
  clientSecret: string;
  retailer: string;
  branchId: string;
  autoSync: boolean;
  soldById: string | null;
  paymentAccountId: string | null;
  configRevision: number;
}

export interface KiotvietConfigInput {
  clientId?: string;
  clientSecret?: string;
  retailer?: string;
  branchId?: string;
  autoSync?: boolean;
  soldById?: string | null;
  paymentAccountId?: string | null;
  clearSecret?: boolean;
}

export interface KiotvietPublicConfigDto {
  clientId: string;
  retailer: string;
  branchId: string;
  autoSync: boolean;
  soldById: string | null;
  paymentAccountId: string | null;
  secretConfigured: boolean;
  configRevision: number;
  catalogReady: boolean;
  lastSuccessfulSyncAt: string | null;
}

export type KiotvietCatalogStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed';
export type KiotvietCatalogRunMode = 'full' | 'incremental';

export interface KiotvietCatalogStatusDto {
  runId: string | null;
  status: KiotvietCatalogStatus;
  totalProducts: number;
  processed: number;
  lastSuccessfulAt: string | null;
  error: string | null;
}

export type KiotvietInvoiceJobState =
  | 'queued'
  | 'preparing'
  | 'dispatching'
  | 'succeeded'
  | 'failed'
  | 'uncertain';

export type KiotvietOrderSyncStatus =
  | 'not_synced'
  | 'pending'
  | 'synced'
  | 'failed'
  | 'uncertain';

export type KiotvietReconciliationStatus = 'matched' | 'different' | 'remote_cancelled';

export interface KiotvietSnapshotItem {
  kiotvietProductId: string;
  productCode: string;
  productName: string;
  unit: string | null;
  quantity: number;
  price: number;
  discountMode: string;
  discountInput: number;
  discountAmount: number;
  subtotal: number;
  note: string | null;
}

export interface KiotvietInvoiceSnapshot {
  orderId: string;
  orderCode: string;
  orgId: string;
  retailer: string;
  branchId: string;
  kiotvietCustomerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  items: KiotvietSnapshotItem[];
  totalAmount: number;
  paidAmount: number | null;
  paymentMethod: string | null;
  paymentAccountId: string | null;
  configRevision: number;
}

export interface KiotvietProductDto {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  price: number;
  onHand: number | null;
}

export interface KiotvietCustomerSearchResult {
  id: string;
  code: string;
  name: string;
  phone?: string;
  address?: string;
}
