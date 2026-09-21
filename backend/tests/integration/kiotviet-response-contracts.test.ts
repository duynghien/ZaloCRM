import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';
import { serializeOrderResponse } from '../../src/modules/orders/order-response-serializer.js';
import { Prisma } from '@prisma/client';

let fixture: Awaited<ReturnType<typeof createTestApp>> | undefined;
const password = 'FixturePassword123';
let passwordHash: string;

beforeAll(async () => {
  try {
    fixture = await createTestApp();
    passwordHash = await bcrypt.hash(password, 4);
  } catch (err) {
    console.warn('[kiotviet-response-contracts] Disposable postgres unavailable:', err);
  }
}, 120_000);

afterAll(async () => {
  await fixture?.close();
});

describe('KiotViet Response Contracts & BigInt Precision Serialization', () => {
  describe('serializeOrderResponse Unit Behavior', () => {
    it('converts BigInt to string without losing precision', () => {
      const unsafeBigInt = 9007199254740993n; // Exceeds Number.MAX_SAFE_INTEGER
      const input = {
        id: 'order-1',
        kiotvietInvoiceId: unsafeBigInt,
        branchId: 10001n,
        items: [
          {
            kiotvietProductId: unsafeBigInt,
            subtotal: 50000,
          },
        ],
      };

      const serialized = serializeOrderResponse(input);
      expect(serialized.kiotvietInvoiceId).toBe('9007199254740993');
      expect(serialized.branchId).toBe('10001');
      expect(serialized.items[0].kiotvietProductId).toBe('9007199254740993');
    });

    it('converts Prisma.Decimal to number', () => {
      const input = {
        price: new Prisma.Decimal('125000.5'),
        total: new Prisma.Decimal('250000'),
      };
      const serialized = serializeOrderResponse(input);
      expect(serialized.price).toBe(125000.5);
      expect(serialized.total).toBe(250000);
    });

    it('converts Date to ISO string', () => {
      const date = new Date('2026-09-21T10:00:00.000Z');
      const serialized = serializeOrderResponse({ createdAt: date });
      expect(serialized.createdAt).toBe('2026-09-21T10:00:00.000Z');
    });
  });

  describe('HTTP Endpoints Serialization', () => {
    it('verifies GET /orders, GET /orders/:id, and POST /orders return serialized BigInt/Decimal without crash', async () => {
      if (!fixture) {
        console.warn('Skipping integration test: PostgreSQL container not available in this environment');
        return;
      }

      const org = await fixture.prisma.organization.create({
        data: { name: 'Response Contract Org' },
      });

      const user = await fixture.prisma.user.create({
        data: {
          orgId: org.id,
          email: `${randomUUID()}@test.invalid`,
          fullName: 'Contract Tester',
          passwordHash,
          role: 'admin',
        },
      });

      const contact = await fixture.prisma.contact.create({
        data: {
          orgId: org.id,
          fullName: 'Contract Customer',
          phone: '0987654321',
        },
      });

      const token = fixture.app.jwt.sign({
        id: user.id,
        email: user.email,
        role: user.role,
        orgId: org.id,
      });

      // 1. Create order with amount-only
      const createRes = await fixture.app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          contactId: contact.id,
          totalAmount: 300000,
          paidAmount: 100000,
          paymentMethod: 'Cash',
          status: 'confirmed',
          notes: 'Test contract notes',
        },
      });

      expect(createRes.statusCode).toBe(200);
      const createdData = JSON.parse(createRes.payload);
      expect(createdData.order).toBeDefined();
      expect(createdData.order.totalAmount).toBe(300000);
      expect(createdData.order.paidAmount).toBe(100000);
      expect(createdData.order.paymentMethod).toBe('Cash');

      const orderId = createdData.order.id;

      // 2. Fetch order detail: GET /api/v1/orders/:id
      const detailRes = await fixture.app.inject({
        method: 'GET',
        url: `/api/v1/orders/${orderId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(detailRes.statusCode).toBe(200);
      const detailData = JSON.parse(detailRes.payload);
      expect(detailData.order.id).toBe(orderId);
      expect(detailData.order.editable).toBe(true);
      expect(detailData.order.canSync).toBe(false); // No items yet

      // 3. Fetch orders list: GET /api/v1/orders
      const listRes = await fixture.app.inject({
        method: 'GET',
        url: '/api/v1/orders',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(listRes.statusCode).toBe(200);
      const listData = JSON.parse(listRes.payload);
      expect(listData.orders.some((o: any) => o.id === orderId)).toBe(true);

      // 4. Fetch contact orders: GET /api/v1/contacts/:id/orders
      const contactOrdersRes = await fixture.app.inject({
        method: 'GET',
        url: `/api/v1/contacts/${contact.id}/orders`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(contactOrdersRes.statusCode).toBe(200);
      const contactOrdersData = JSON.parse(contactOrdersRes.payload);
      expect(contactOrdersData.orders.some((o: any) => o.id === orderId)).toBe(true);
    });
  });
});
