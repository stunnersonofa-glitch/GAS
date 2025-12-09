// __tests__/mpesa-callback.test.js
import { processMpesaCallback } from '../pages/api/mpesa/callback';
import prisma from '../lib/prisma';

jest.mock('../lib/prisma', () => ({
  $transaction: jest.fn(),
  mpesaCheckout: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  },
  order: {
    update: jest.fn(),
    updateMany: jest.fn()
  },
  payment: {
    create: jest.fn()
  }
}));

describe('processMpesaCallback', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('creates audit record if no checkout found', async () => {
    prisma.$transaction.mockImplementation(async (fn) => {
      return fn({
        mpesaCheckout: {
          findFirst: async () => null,
          create: async (data) => ({ id: 'audit1', ...data })
        },
        order: {
          updateMany: async () => ({ count: 0 })
        }
      });
    });

    const cb = {
      CheckoutRequestID: 'C1',
      MerchantRequestID: 'M1',
      ResultCode: 0,
      ResultDesc: 'OK',
      Amount: 500,
      MpesaReceiptNumber: 'R123',
      PhoneNumber: '254712345678',
      AccountReference: 'order-unknown'
    };

    const res = await processMpesaCallback(cb);
    expect(res.note).toMatch(/Checkout not found/);
    expect(res.audit).toBeDefined();
    expect(res.audit.checkoutId).toEqual('C1');
  });

  test('updates checkout and order on success', async () => {
    const mockCheckout = { id: 'c1', orderId: 'ord1', amount: 500, status: 'PENDING', checkoutId: 'C1' };
    prisma.$transaction.mockImplementation(async (fn) => {
      return fn({
        mpesaCheckout: {
          findFirst: async () => mockCheckout,
          update: async (args) => ({ ...mockCheckout, ...args.data, id: mockCheckout.id })
        },
        order: {
          update: async (args) => ({ id: 'ord1', status: 'PROCESSING' })
        },
        payment: {
          create: async (data) => ({ id: 'pay1', ...data })
        }
      });
    });

    const cb = {
      CheckoutRequestID: 'C1',
      MerchantRequestID: 'M1',
      ResultCode: 0,
      ResultDesc: 'OK',
      Amount: 500,
      MpesaReceiptNumber: 'R123',
      PhoneNumber: '254712345678',
      AccountReference: 'ord1'
    };

    const r = await processMpesaCallback(cb);
    expect(r.checkout).toBeDefined();
    expect(r.order).toBeDefined();
    expect(r.order.status).toBe('PROCESSING');
  });

  test('flags amount mismatch as failed', async () => {
    const mockCheckout = { id: 'c2', orderId: 'ord2', amount: 1000, status: 'PENDING', checkoutId: 'C2' };
    prisma.$transaction.mockImplementation(async (fn) => {
      return fn({
        mpesaCheckout: {
          findFirst: async () => mockCheckout,
          update: async (args) => ({ ...mockCheckout, ...args.data, id: mockCheckout.id })
        },
        order: {
          updateMany: async () => ({ count: 1 })
        }
      });
    });

    const cb = {
      CheckoutRequestID: 'C2',
      ResultCode: 0,
      Amount: 500,
      MpesaReceiptNumber: 'R999',
      PhoneNumber: '254712300000',
      AccountReference: 'ord2'
    };

    const out = await processMpesaCallback(cb);
    expect(out.note).toMatch(/Amount mismatch/);
  });

  test('idempotent when already success', async () => {
    const mockCheckout = { id: 'c3', orderId: 'ord3', amount: 200, status: 'SUCCESS', checkoutId: 'C3' };

    prisma.$transaction.mockImplementation(async (fn) => {
      return fn({
        mpesaCheckout: {
          findFirst: async () => mockCheckout
        },
      });
    });

    const cb = {
      CheckoutRequestID: 'C3',
      ResultCode: 0,
      Amount: 200,
      MpesaReceiptNumber: 'R222',
      PhoneNumber: '254700000001',
      AccountReference: 'ord3'
    };

    const res = await processMpesaCallback(cb);
    expect(res.note).toMatch(/Already processed/);
  });
});
