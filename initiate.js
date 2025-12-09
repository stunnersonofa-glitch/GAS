// pages/api/mpesa/initiate.js
import prisma from '../../../lib/prisma';
import fetch from 'node-fetch';

// helper to get access token
async function getAccessToken() {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) throw new Error('Missing MPESA consumer credentials');
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const res = await fetch(`${process.env.MPESA_OAUTH_URL || 'https://sandbox.safaricom.co.ke'}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` }
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to obtain access token: ' + JSON.stringify(data));
  return data.access_token;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { orderId, phone } = req.body;
    if (!orderId || !phone) return res.status(400).json({ error: 'Missing orderId or phone' });

    // load order and ensure pending
    const order = await prisma.order.findUnique({ where: { id: orderId }});
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'PENDING' && order.status !== 'PROCESSING') {
      // allow initiating only for pending/processing orders
    }

    // get token
    const token = await getAccessToken();

    // prepare stk push
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0,14);
    const passkey = process.env.MPESA_PASSKEY;
    const businessShortCode = process.env.MPESA_SHORTCODE;
    const password = Buffer.from(businessShortCode + passkey + timestamp).toString('base64');

    const amount = Math.round(order.total || 0);
    const phoneClean = phone.replace(/\D/g, '');
    const callbackUrl = `${process.env.BASE_URL.replace(/\/$/, '')}/api/mpesa/callback`;

    const body = {
      BusinessShortCode: businessShortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phoneClean,
      PartyB: businessShortCode,
      PhoneNumber: phoneClean,
      CallBackURL: callbackUrl,
      AccountReference: orderId,
      TransactionDesc: `Payment for order ${orderId}`
    };

    const stkRes = await fetch(`${process.env.MPESA_STK_PUSH_URL || 'https://sandbox.safaricom.co.ke'}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const stkJson = await stkRes.json();

    // store checkout record (idempotent: update or create)
    let checkout = await prisma.mpesaCheckout.findUnique({ where: { orderId } });
    if (!checkout) {
      checkout = await prisma.mpesaCheckout.create({
        data: {
          orderId,
          phone: phoneClean,
          amount,
          checkoutId: stkJson.CheckoutRequestID ?? stkJson.MerchantRequestID ?? null,
          status: 'PENDING'
        }
      });
    } else {
      await prisma.mpesaCheckout.update({
        where: { id: checkout.id },
        data: {
          checkoutId: stkJson.CheckoutRequestID ?? stkJson.MerchantRequestID ?? checkout.checkoutId,
          phone: phoneClean,
          amount,
          status: 'PENDING'
        }
      });
    }

    return res.status(200).json({ success: true, body: stkJson });
  } catch (err) {
    console.error('initiate mpesa error', err);
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
}
