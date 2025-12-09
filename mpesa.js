// lib/mpesa.js
export function parseMpesaCallback(body) {
  const stk = body?.Body?.stkCallback ?? body?.Body?.Result ?? body;
  if (!stk) throw new Error('Invalid mpesa callback shape');

  const payload = stk.stkCallback ?? stk;
  const callbackMetadataItems = payload?.CallbackMetadata?.Item ?? payload?.CallbackMetadata?.Items ?? [];
  const map = {};
  (callbackMetadataItems || []).forEach((it) => {
    if (it?.Name && it?.Value !== undefined) map[it.Name] = it.Value;
  });

  return {
    CheckoutRequestID: payload.CheckoutRequestID ?? payload.CheckoutRequestID ?? null,
    MerchantRequestID: payload.MerchantRequestID ?? null,
    ResultCode: payload.ResultCode ?? (payload.Result === 'Success' ? 0 : 1),
    ResultDesc: payload.ResultDesc ?? payload.Result ?? null,
    Amount: map.Amount ?? payload.Amount ?? null,
    MpesaReceiptNumber: map.MpesaReceiptNumber ?? map.ReceiptNumber ?? null,
    PhoneNumber: map.PhoneNumber ?? map.Phone ?? null,
    AccountReference: map.AccountReference ?? payload.AccountReference ?? payload.Reference ?? null
  };
}

export function isValidMpesaCallback(cb) {
  if (!cb) return false;
  if (!cb.CheckoutRequestID && !cb.MerchantRequestID) return false;
  if (cb.ResultCode === undefined || cb.ResultCode === null) return false;
  return true;
}
