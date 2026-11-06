# SCOTS: Smart Canteen Ordering & Token System

SCOTS is a web app that helps a college canteen take orders, give out tokens and manage the kitchen queue. Customers order from their phone, staff manage orders on a dashboard, and an admin controls the menu, rules and reports.

> **This is a demo.** It is built to show how the system works, not to run a real canteen. Payments are fake, data is stored in the browser and a small JSON file, and there is no real email or SMS. See [Demo vs Real Implementation](#demo-vs-real-implementation) for details.

## Why this project exists

This started as a college Software Engineering project. The task was to write a Software Requirements Specification (SRS) for a system, I choose this. After finishing the SRS, I thought: instead of leaving it only on paper, why not build a simple website that shows the main ideas working?

So there are two parts in this repository:

1. **The SRS (in the `docs` folder).** A full specification written for a **real, large-scale implementation**. It describes a Flutter mobile app, a React dashboard, PostgreSQL, the Razorpay payment gateway, Firebase push notifications, backups, security rules and performance targets.
2. **This website.** A **simple, free and fast example** built with plain HTML, CSS and JavaScript plus a tiny Node.js server. It follows the SRS rules and behaviour, but uses simple tools so anyone can understand and run it in two minutes.

**The features and rules in this demo can be applied to a real production system.** Only the tools underneath are simplified. The order flow, queue logic, cancellation rules, No-Show policy and admin settings are the same ideas the SRS describes.

## What the system does

There are three types of users:

| Role | What they do |
| --- | --- |
| **Customer** | Browse the menu, order, pay, track the order, collect food with a token, cancel orders |
| **Canteen Staff** | See the kitchen queue, move orders forward, take walk-in orders, record cash, print token receipts |
| **Canteen Admin** | Manage menu, slots and policy settings, review refunds and dues, view reports and the audit log |

### Main features

**Ordering**
- Digital menu with search, categories, prices, photos, ingredients and prep time.
- Cart and Buy Now. Items marked Sold Out cannot be ordered.
- **Immediate Order:** food is prepared as soon as possible. At checkout the customer sees a predicted Ready time (Checkout ETA) and confirms it before paying. If that time moves by more than 2 minutes, the customer must confirm again.
- **Scheduled Order:** the customer picks a 15-minute pickup window later the same day. It must start at least 30 minutes from now and is paid by UPI only.
- **Token and locked ETA:** every order gets a token number and a Token ETA that never changes after the order is placed.
- Prep-time limit for Immediate Orders (default 12 minutes). Bigger carts must be reduced or scheduled.

**Kitchen queue**
- Orders move forward only: Received, Preparing, Ready, Collected.
- Every status change asks staff for confirmation ("Mark order #104 as Ready?").
- Scheduled Orders stay hidden until their release time, then join the active queue.
- If a Scheduled Order starts late, the customer gets a revised ETA. If the delay is longer than the grace period, the customer can cancel for a full refund.
- Public Token Display screen shows tokens that are Ready and the next 5 in the queue.

**Payments (mock)**
- UPI payment through a fake gateway (about 90% success to show retry).
- Cash-at-Pickup for Immediate Orders. Staff must record full cash before marking Collected.
- Refund and forfeiture records are saved as transactions.

**Walk-in (Offline) orders**
- Staff can enter an order for a customer at the counter, record Cash or UPI, see the ETA and print a token receipt using the browser print dialog.

**Cancellation, No-Show and dues**
- Customer can cancel before Ready. Received: full refund. Preparing: a late-cancellation penalty applies (default 100%).
- Cancelling 2 Received orders in one day pauses ordering for 24 hours.
- If a Ready order is not collected in 20 minutes, it expires and a No-Show is logged. Prepaid money is forfeited by the configured percentage. Unpaid cash orders become a **Pending Due**, which blocks new orders until cleared.
- No-Shows are counted over a 30-day window. 2 No-Shows means UPI only. 3 means the account is suspended until the admin reviews it.
- If an item is marked Sold Out, all Received orders containing it are cancelled and refunded automatically.

**Admin**
- Menu management and slot capacity.
- **Policy settings page:** all rules (cook count, window length, Max Slack, prep limit, penalties, expiry, lookback and more) are editable and validated. Changes apply to new orders only and are saved in the audit log.
- Refunds and Pending Dues review.
- Audit log with filters.
- Sales reports, user management, appeals and demo controls.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | HTML, CSS, vanilla JavaScript |
| Backend | Node.js HTTP server (REST API + Server-Sent Events) |
| Storage | Browser `localStorage` + `server-data/data.json` |
| Payments | Mock UPI gateway (no real money) |
| Notifications | In-app notification history + optional Web Push |
| Hosting | Render free Web Service, or any Node host |

Everything is free and has only one npm dependency (`web-push`).

## Run locally

You need Node.js 18 or newer.

```bash
npm install
npm start
```

Open `http://localhost:3000`.

Use the demo login buttons on the login page, or these accounts:

| Role | Email | Password |
| --- | --- | --- |
| Customer | `student@example.com` | `Student@123` |
| Staff | `staff@example.com` | `Staff@123` |
| Admin | `admin@example.com` | `Admin@123` |

## Demo scenarios

1. **Immediate order:** log in as Customer, press Buy Now, choose Immediate, confirm the Checkout ETA, pay with mock UPI and see the token.
2. **Scheduled order:** choose Scheduled, pick a window. Only UPI is allowed. Staff will see the order only after its release time.
3. **Kitchen flow:** log in as Staff, move an order through Preparing, Ready and Collected. Watch the Token Display update.
4. **Cancel:** open an order in Orders and press Cancel. Try it at Received and at Preparing to see the refund and penalty difference.
5. **Walk-in order:** as Staff press "+ Walk-in Order", record payment and print the token.
6. **No-Show:** as Admin open Overview, Demo Controls. Turn on DEMO_MODE (1-minute expiry) or create test No-Shows to see UPI-only and suspension.
7. **Policy change:** as Admin open Policy and change a value. Place a new order to see it apply.
8. **Sold Out:** as Admin mark an item Sold Out. Received orders with that item are cancelled and refunded.
9. **Simulated time:** Admin can set the clock (for example 5:55 PM) to test closing-time rules.

## Project structure

```
index.html, menu.html, cart.html, checkout.html   Customer pages
orders.html, order-success.html, profile.html
login.html, register.html, help.html
token-display.html                                Public token screen
staff/                                            Staff dashboard
admin/                                            Admin pages (menu, slots, policy, audit, ...)
js/                                               App logic (queue, slots, checkout, auth, ...)
css/                                              Styles
assets/                                           Images and icons
server.js                                         Node server (API, live updates, push)
server-data/data.json                             Server storage for the demo
docs/                                             SRS document (real-implementation spec)
```

## Demo vs Real Implementation

The SRS describes a production design. This demo keeps the same behaviour but replaces heavy parts with simple ones.

| Area | This demo | Real implementation (from the SRS) |
| --- | --- | --- |
| Customer app | Responsive website | Flutter mobile app (Android and iOS) |
| Dashboards | Plain JavaScript pages | React dashboards |
| Database | Browser storage + JSON file | PostgreSQL with transactions and backups |
| Payments | Mock UPI | Razorpay with signature (HMAC) and status verification |
| Notifications | In-app and Web Push | Firebase Cloud Messaging and Apple Push |
| Accounts | Simple demo login | Email verification, password reset links, hashed passwords |
| Concurrency | Single server, simple logic | Atomic database operations for capacity and status changes |
| Queue scheduling | Simplified gap-fit queue | Full cook-assignment and Max Slack scheduler |

**Not built in the demo:** email verification, password reset, real payment verification, database backups and recovery, and load testing for 150 concurrent users.

**What carries over to production:** the order types, ETA rules, Time Window capacity, cancellation and refund rules, No-Show escalation, Pending Dues, audit logging and the admin policy settings. These are business rules, so they can be moved to a production backend without changing the idea.

## Limitations

- Data in the browser is not shared between users. Only orders, appeals, notifications and settings sync through the server.
- No real security. Passwords are stored in plain text for the demo. Do not use real data.
- Not tested for large traffic.

## About

Built as a learning project to turn a written SRS into something that can be clicked and tried. Feedback and ideas are welcome.
