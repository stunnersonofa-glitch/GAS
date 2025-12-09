# M-Pesa Integration Bundle

Files included:
- pages/api/mpesa/initiate.js  -> initiate STK push (server)
- pages/api/mpesa/callback.js  -> callback handler (server)
- lib/mpesa.js                 -> parsing + validation helpers
- lib/prisma.js                -> prisma client wrapper
- prisma/schema.prisma         -> recommended Prisma schema (adjust to your existing schema)
- __tests__/mpesa-callback.test.js -> Jest tests for callback logic
- .env.example                 -> env vars example

## Quick setup
1. Copy files into your Next.js project (keep paths or adjust imports).
2. Run `npm install @prisma/client prisma node-fetch` and dev deps `jest node-mocks-http` if needed.
3. Adjust `prisma/schema.prisma` to match your existing models (especially mpesaCheckout, order, payment).
4. Migrate DB and generate client:
   - `npx prisma migrate dev --name mpesa_init`
   - `npx prisma generate`
5. Configure Daraja callback URL to: `https://yourdomain.com/api/mpesa/callback`
6. Use `/api/mpesa/initiate` to start STK push (POST body: { orderId, phone }).
7. Monitor logs and DB records to confirm flow.

## Notes & hardening
- Log raw callback payload for the first few tests to verify shape.
- Validate Amount and AccountReference strictly in production.
- Store CheckoutRequestID returned by initiate and match it in callback.
- Consider rate-limiting and alerting on reconciliation failures.

## Need help adapting?
- If your Prisma schema differs paste it here and I'll adapt the code to match.
- If you want a zip specifically configured for your repo layout, say so and include repo structure.
