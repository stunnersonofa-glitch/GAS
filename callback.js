// pages/api/mpesa/callback.js
import prisma from '../../../lib/prisma';
import { parseMpesaCallback, isValidMpesaCallback } from '../../../lib/mpesa';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const body = req.body;
  try {
    // first log raw body for initial debugging (remove or lower in prod)
    console.info('mpesa callback raw body:', JSON.stringify(body).slice(0, 2000));

    const callback = parseMpesaCallback(body);

    if (!isValidMpesaCallback(callback)) {
      console.warn('Invalid M-Pesa callback payload', callback);
      return res.status(400).json({ error: 'Invalid callback payload' });
    }

    const result = await processMpesaCallback(callback);
    // Daraja expects 200 quickly; return minimal payload
    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('mpesa callback handler error', err);
    // Still return 200 to avoid retries from Daraja in production,
    // but during development you may prefer 500 for visibility.
    try { return res.status(200).json({ success: false, error: err.message }); } catch(e){ return res.status(500).end(); }
  }
}

export async function processMpesaCallback(callback) {
  const {
    CheckoutRequestID,
    MerchantRequestID,
    ResultCode,
    ResultDesc,
    Amount,
    MpesaReceiptNumber,
    PhoneNumber,
    AccountReference
  } = callback;

  const orderId = String(AccountReference ?? '');

  return await prisma.$transaction(async (tx) => {
    const checkout = await tx.mpesaCheckout.findFirst({
      where: {
        OR: [
          { orderId },
          { checkoutId: CheckoutRequestID },
          { checkoutId: MerchantRequestID }
        ]
      }
    });

    if (!checkout) {
      const audit = await tx.mpesaCheckout.create({
        data: {
          orderId: orderId || null,
          checkoutId: CheckoutRequestID ?? MerchantRequestID ?? null,
          phone: PhoneNumber ?? null,
          amount: Amount ?? null,
          status: ResultCode === 0 ? 'SUCCESS' : 'FAILED',
          rawPayload: JSON.stringify(callback)
        }
      });
      return { note: 'Checkout not found - created audit record', audit };
    }

    if (checkout.status === 'SUCCESS') {
      return { note: 'Already processed as SUCCESS', checkoutId: checkout.id };
    }

    if (checkout.amount && Amount && Math.round(checkout.amount) !== Math.round(Amount)) {
      const updated = await tx.mpesaCheckout.update({
        where: { id: checkout.id },
        data: {
          status: 'FAILED',
          checkoutId: CheckoutRequestID ?? checkout.checkoutId,
          rawPayload: JSON.stringify(callback),
          updatedAt: new Date()
        }
      });
      await tx.order.updateMany({
        where: { id: checkout.orderId },
        data: { status: 'PENDING' }
      });
      return { note: 'Amount mismatch - flagged for manual review', updated };
    }

    if (Number(ResultCode) === 0) {
      const updatedCheckout = await tx.mpesaCheckout.update({
        where: { id: checkout.id },
        data: {
          status: 'SUCCESS',
          checkoutId: CheckoutRequestID ?? checkout.checkoutId,
          mpesaReceipt: MpesaReceiptNumber ?? checkout.mpesaReceipt,
          phone: PhoneNumber ?? checkout.phone,
          rawPayload: JSON.stringify(callback),
          updatedAt: new Date()
        }
      });

      const updatedOrder = await tx.order.update({
        where: { id: checkout.orderId },
        data: { status: 'PROCESSING', updatedAt: new Date() }
      });

      if (tx.payment) {
        await tx.payment.create({
          data: {
            orderId: checkout.orderId,
            amount: Amount,
            provider: 'MPESA',
            providerReference: MpesaReceiptNumber ?? CheckoutRequestID,
            status: 'SUCCESS',
            createdAt: new Date()
          }
        });
      }

      return { checkout: updatedCheckout, order: updatedOrder };
    } else {
      const updatedCheckout = await tx.mpesaCheckout.update({
        where: { id: checkout.id },
        data: {
          status: 'FAILED',
          checkoutId: CheckoutRequestID ?? checkout.checkoutId,
          rawPayload: JSON.stringify(callback),
          updatedAt: new Date()
        }
      });

      await tx.order.updateMany({
        where: { id: checkout.orderId },
        data: { status: 'PENDING' }
      });

      return { note: 'Payment failed', checkout: updatedCheckout, resultDesc: ResultDesc };
    }
  });
}
