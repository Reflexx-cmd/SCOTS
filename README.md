# SCOTS — Smart Canteen Ordering & Token System (demo)

Free, lightweight demo of a campus canteen ordering platform, aligned to SRS v2.3. Not for production use.

## Tech stack
| Layer | Technology |
| --- | --- |
| Frontend | HTML, CSS, vanilla JavaScript |
| Backend | Node.js HTTP server (REST + Server-Sent Events) |
| State | Browser `localStorage` + `server-data/data.json` |
| Payments | Mock UPI gateway (no real money) |
| Notifications | In-app history + optional Web Push |
| Hosting | Render free Web Service (or any Node host) |

## Run
```bash
npm install
npm start      # http://localhost:3000
```
Use the demo login buttons (Customer, Staff, Admin). Demo emails use `example.com`. Render free storage is ephemeral, so data resets on restart.

## SRS v2.3 features implemented
- Immediate and Scheduled orders. Scheduled is UPI-only and needs a 30-minute lead time. Cash-at-Pickup is for Immediate Orders only.
- Checkout ETA with reconfirmation when it moves more than 2 minutes. Locked Token ETA after placement.
- Immediate prep limit (default 12 min), Time Window capacity N × W × share (default 20 prep-min).
- Scheduled Orders stay hidden from the kitchen until their Promised Release Time. Delay notification, and 100% refund cancel past Delay Grace.
- Customer cancellation with refund or penalty, rapid-cancel 24-hour block, Pending Due, No-Show forfeiture.
- No-Show policy with 30-day lookback: 2 = UPI only, 3 = suspended until Admin review.
- Sold Out marks cancel and refund Received orders.
- Staff: confirmation box on status change, cash recorded before Collected, Walk-in (Offline) Order with printable token receipt.
- Admin: menu, slots, Policy settings (all Appendix B.5 values), Refunds & Dues, Audit log with actor, users, appeals, reports.
- Token display: Now Serving plus Next 5 in queue.

## Simplifications (demo only)
No email verification or reset link, no Razorpay HMAC, no FCM/APNs, no database backups. The Max Slack push-back scheduler is simplified to a gap-fit queue.

## Demo scenarios
1. **Immediate order**: Customer → menu → Buy Now → choose Immediate → confirm Checkout ETA → mock UPI → token.
2. **Scheduled order**: choose Scheduled, pick a window (UPI only), staff sees it only after release time.
3. **Cancel**: Orders → open an order → Cancel order (Received = full refund, Preparing = penalty).
4. **Walk-in order**: Staff → + Walk-in Order → Take payment & print token.
5. **No-show**: Admin → Overview → DEMO CONTROLS (Create Test No-show, DEMO_MODE, simulated clock).
6. **Policy**: Admin → Policy → edit values (new orders only).
7. **Sold Out**: Admin → Menu → Sold Out cancels Received orders with that item.
