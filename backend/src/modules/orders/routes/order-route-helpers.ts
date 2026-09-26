/**
 * order-route-helpers.ts — Shared validation, payload parsing, and transaction retry helpers for orders.
 */
import {
  objectInput,
  identifierInput,
  stringInput,
  enumInput,
  RequestValidationError,
} from '../../../shared/http/request-schemas.js';
import { boundedFiniteNumber } from '../../../shared/http/request-bounds.js';

export const orderStatuses = ['new', 'confirmed', 'paid', 'shipped', 'completed', 'cancelled'] as const;

export const orderBody = (value: unknown, create: boolean) => {
  const body = objectInput(value);
  const allowed = create
    ? [
        'contactId',
        'conversationId',
        'totalAmount',
        'status',
        'notes',
        'items',
        'paidAmount',
        'paymentMethod',
        'paymentAccountId',
        'kiotvietCustomerId',
        'expectedRevision',
      ]
    : [
        'totalAmount',
        'status',
        'notes',
        'items',
        'paidAmount',
        'paymentMethod',
        'paymentAccountId',
        'kiotvietCustomerId',
        'expectedRevision',
      ];

  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new RequestValidationError('Invalid order field');
  }
  if (create) identifierInput(body.contactId);
  if (body.conversationId !== undefined && body.conversationId !== null) {
    identifierInput(body.conversationId);
  }
  if (body.totalAmount !== undefined && body.totalAmount !== null) {
    if (boundedFiniteNumber(body.totalAmount, 0, 100_000_000_000) === undefined) {
      throw new RequestValidationError('totalAmount must be a finite amount between 0 and 100000000000');
    }
  }
  if (body.notes !== undefined) stringInput(body.notes, 10_000, true);
  if (body.status !== undefined) enumInput(body.status, orderStatuses as unknown as string[]);
  return body;
};

export async function retryOrderTransaction<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error: any) {
      if (attempt >= 3 || !['P2034', '40001', '40P01'].includes(error?.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}
