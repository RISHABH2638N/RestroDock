# RestroDock · Waiter confirmation update

This cumulative version replaces the PIN prompt in the development checkout UI with **first-order waiter confirmation**. Use **Staff → Order review** to confirm the customer at the table. The Chef sees that order only after approval. Manager risk limits remain enforced. [Workflow, setup and limits](docs/waiter-confirmation/README.md).

# RestroDock · Day 16 table service

Cumulative **v0.13.0** adds order review and intake controls to the opt-in development checkout pilot for verified QR table guests. It saves orders and current menu snapshots atomically and returns a confirmation reference. The cumulative build includes table and section administration, printable QR cards, registration, role workspaces, the branded landing, and persistent restaurant setup and menu management. Next.js + React + TypeScript client, Express + TypeScript server, PostgreSQL/Neon + Prisma, Socket.IO scaffold. Separate client/ and server/. **No Docker requirement.** Existing restaurant POS remains the official invoice/payment owner.

The Restaurant Admin sidebar opens each task directly. On phones, open **Workspace menu**. See [admin portal verification](docs/day12-admin/VERIFICATION.md).

The Day 12 API hotfix gives table and menu management writes more time to return the saved state. If a response is interrupted, use **Refresh saved tables** or **Reload saved values** to confirm the state before retrying. See [hotfix verification](docs/day12-hotfix/VERIFICATION.md).

## Start with two commands

Use Node.js **24 LTS**. Extract into a fresh folder, open a terminal in restrodock/ containing the root package.json, client/ and server/, then configure your private server/.env. Run:

```sh
npm ci
npm run dev
```

No cd server, manual setup, Prisma generation, migration or seed command is needed for normal development. npm ci creates missing env files from safe examples while preserving existing values, generates Prisma and builds contracts. npm run dev applies committed additive migrations if a database is configured, performs guarded first-admin provisioning, then starts both apps. No demo dataset is automatically seeded.

Frontend landing page: **http://localhost:3000**. API: **http://127.0.0.1:4000**. Choose **Log in** on the landing page, then **Restaurant Admin** or **Platform Admin**. Direct entries: `/sign-in?portal=restaurant` and `/sign-in?portal=platform`; staff use `/sign-in`. Blank database settings allow the public landing to render; readiness is 503 and account sign-in is unavailable. Existing developer connection tools are retained at `/workspace` only in development with platform access, absent from normal role navigation, and return 404 in production.

After login, the verified identity determines your navigation and default destination:

| Assigned access | Workspace and delivered functionality |
| --- | --- |
| Platform Admin | `/super-admin`: tenant directory/provisioning, plan metadata, administrator invitations, registration requests and onboarding review |
| Restaurant Admin | `/restaurant`: only assigned restaurants/branches; profile, hours, settings, menu/media, staff management/invitations, tables/QR and entry pilots |
| Chef | `/staff`: assigned kitchen role and branch; live preparation remains planned |
| Worker / waiter | `/staff`: assigned table-service role and branch; entry-pilot sessions/PIN; live pickup/served controls remain planned |
| Cashier | `/staff`: assigned billing-handoff role and branch; entry-pilot table closure; settlement/POS-reference controls remain planned |
| Manager | `/staff`: assigned operations role and branch; entry-pilot sessions/PIN; live order-exception controls remain planned |

Unrelated workspace links and page clients are not mounted. API checks remain authoritative on every request; hiding a menu is not the security boundary. A platform account with no explicit restaurant membership never gains tenant access. Multiple explicitly assigned roles may expose multiple workspaces. An inactive staff branch explains the user's own role without calling active operational context. Logout clears the shared role shell and page. Days9+10 add a sixth additive migration, QR dependencies and explicitly scoped guest entry; no external provider key is needed. A separate server privacy key is generated for development; QR dependencies are included.

The login entry only changes presentation. The existing API verifies your account; its returned identity determines `/super-admin`, `/restaurant` or `/staff`. It does not grant roles or tenant access. Public registration requires Platform Admin approval before a first-time administrator can sign in. No fake demo account or open redirect exists. Previously provisioned credentials remain unchanged. The old first-admin setup diagnostics remain supported.

The landing menu is a clearly labelled local illustration. QR menus read only reviewed, published tenant records after explicit entry publication. The landing illustration is read-only. The separately enabled development checkout pilot is described below. The public pricing section displays RestroDock plan prices. The application flow remains the entry point for restaurants. Search indexing remains disabled until a reviewed public deployment.

Essential server/.env fields:

```dotenv
NODE_ENV=development
DATABASE_URL="postgresql://USER:PASSWORD@YOUR-ENDPOINT-pooler.REGION.aws.neon.tech/neondb?sslmode=verify-full"
DIRECT_URL="postgresql://USER:PASSWORD@YOUR-ENDPOINT.REGION.aws.neon.tech/neondb?sslmode=verify-full"
BOOTSTRAP_ADMIN_EMAIL="your-private-operator-email@example.com"
BOOTSTRAP_ADMIN_PASSWORD="replace-with-your-own-unique-long-passphrase"
```

These are placeholders. Supply your own rotated credentials. Use a dedicated Neon development branch/database. URL-encode special characters in connection-string passwords; preserve required URL parameters. The pooled runtime and direct migration URLs must address the same database. The private bootstrap password must have 15–128 characters; quote it in .env, especially with #. Previously pasted secrets were not used or included.

Bootstrap creates the first operator once on a fresh database. It never resets an initialized account or promotes a different email on restart. Remove both bootstrap variables after initial provisioning. If it fails, v0.6.1's safe error codes remain supported; see docs/fixes/bootstrap/README.md. The earlier operator-reported hosted failure was not independently confirmed resolved. A successful DIRECT_URL migration does not prove runtime DATABASE_URL connectivity.

Use client/.env.example defaults for the same-origin runtime API proxy. API_PROXY_URL defaults to http://127.0.0.1:4000; keep NEXT_PUBLIC_API_URL blank. Staff authentication and uploads use same-origin /api; never put database secrets in NEXT_PUBLIC variables. If changing the API port, update API_PROXY_URL too. To use frontend port 5173, set server CLIENT_ORIGIN=http://localhost:5173 and run npm run dev -- --port 5173. Default remains 3000. Keep the browser hostname consistent with CLIENT_ORIGIN.

## Day 8.3: register → review → administrator access

1. Open `/register` from the landing page. A first-time applicant submits restaurant/contact details and chooses a password (15–128 characters).
2. Save the private tracking link shown after a successful submission. The request starts PENDING. No user, restaurant or login session exists yet. The link is the status credential; do not share it. It is not emailed automatically.
3. Platform Admin opens `/super-admin/registrations`, checks the applicant and restaurant ownership through an independent contact, then approves or rejects. Approval requires explicit ownership confirmation, a unique slug and plan metadata; rejection requires an applicant-visible reason.
4. Approval atomically creates the restaurant, initial branch and active Restaurant Admin account/access. The applicant's saved status changes to APPROVED and the chosen email/password can sign in. The directory shows the newly provisioned restaurant.
5. Restaurant setup and menus are available. **Approval does not activate guest service:** tenant remains DRAFT, branch inactive and ordering paused. The separately published table-entry pilot is described below. The development checkout pilot is separate from activation. Live restaurant ordering and kitchen service remain later work.

Rejected applicants see the reason through their private link and may submit a corrected request. Pending requests expire after seven days, lazily on registration/status/review access, and may be resubmitted. Terminal/expired requests discard the pending password hash. Existing accounts cannot use this first-time flow; use the existing invitation workflow without resetting credentials. An email address and phone are self-declared until the operator verifies them; no email delivery or automated address verification is provided. Lost private links require contacting the platform team; no automated recovery is implemented.

## Days9+10: tables → QR → staff session → guest entry

1. Sign in as Restaurant Admin. Open **Tables & secure entry** from your workspace (`/restaurant/tables`), select your assigned branch, then add table labels, sections and seats. Archived tables preserve history and labels.
2. Issue a QR for each table. Save the real PNG or print its card immediately. The raw QR link appears once and is not retrievable from the database. To replace lost cards, refresh saved tables and rotate, then replace every old physical card. Rotation/revocation closes that entry-pilot session and revokes guests.
3. Explicitly **Publish table entry** after reviewing the public menu. This publishes reviewed/PUBLISHED menu records through QR links. It does not activate ordering, payments or the restaurant tenant.
4. Restaurant Admin, assigned Manager or Worker opens the table (1/2/4-hour presets). Share the temporary six-digit PIN with seated guests. It is displayed once. PIN expiry follows saved Safety & POS settings (default15 minutes), capped by dining expiry. Lost/expired/locked PIN: refresh and rotate.
5. Guest scans `/q#OPAQUE_TOKEN`, sees the correct table and published read-only menu, enters PIN/name/mobile and acknowledges privacy. No account is created. Valid verification yields a private HttpOnly cookie for up to two hours, capped by table expiry.
6. Assigned staff uses `/staff/tables`. Cashier may inspect/close entry pilots; Chef and platform-only accounts cannot use table service. Closing/rotating/unpublishing revokes guests and clears their contact data. Closure never confirms a payment.

Five incorrect PIN attempts persist in the database and lock the challenge until staff rotates. QR photographs alone cannot mint guest access. A person sharing a current PIN can still cooperate remotely; physical presence and complete fake-order prevention are not proven. Day 11 guests can search and filter the published menu, then verify the staff PIN to build a cart with portions, add-ons, quantities and preparation notes. Refreshing the same tab restores a nonempty draft only for its verified guest session. Estimates come from the current published menu, and unavailable selections remain visible for review while excluded from the estimate. The restaurant’s POS provides the final bill. See [Day 11 verification](docs/day11/VERIFICATION.md).

### Try Day 12 checkout locally

Set `CHECKOUT_PILOT_ENABLED=true` in `server/.env` for a disposable development database, then restart with `npm run dev`. Close and reopen the table so it uses a checkout pilot session. Open the QR at `http://localhost:3000` or the configured HTTPS origin. Verify the staff PIN, add items, and choose **Submit order**. The receipt shows the recorded estimate and order reference. If a response is interrupted, **Retry same submission** uses the original key, selections and estimate. A definite price or availability rejection requires a menu refresh and an explicit new submission.

New pilot orders await review. Closing or expiring a pilot session cancels pending orders and orders approved for a future kitchen queue. Rejections and decision audit records are preserved. The production configuration rejects the pilot. Restaurant activation, kitchen dispatch and payments are separate workflows. See [Day 12 verification](docs/day12/VERIFICATION.md).

Keep the generated `GUEST_PII_KEY` in your private server/.env and back it up. Development startup generates it if absent; preserve it across restarts. Production must supply a stable random64-hex key. It protects mobile encryption and PIN pepper; changing it requires controlled closure/cleanup of existing sessions. No key-rotation adapter, SMS/OTP verification or periodic cleanup worker is included. Contact erasure on expiry is lazy; see docs/day910/ARCHITECTURE.md.

QR links use CLIENT_ORIGIN. localhost cards work on that computer only. For physical phone testing, configure a reachable development origin and bind the frontend for that address; the backend can stay on loopback behind its proxy; keep API_PROXY_URL server-only, exact Origin/CSRF and HTTPS for real deployment. Printed cards must be reissued if the public origin changes. Physical phone/camera/print acceptance has not been performed.

## Day 13 · Review orders and pause new submissions

1. Enable `CHECKOUT_PILOT_ENABLED=true` in the private `server/.env` of a development test setup, then run `npm run dev`. Reopen any table session created before the flag was enabled.
2. Submit a verified guest order through its published QR. In Restaurant Admin or Manager, open **Order review**, select the same branch and choose **Refresh orders**.
3. Check the items and any risk labels. To approve, confirm that you verified the order with the table. To reject, choose a reason. Each saved decision is recorded in the branch audit.
4. Use **Pause new orders** to stop new pilot submissions for that branch. Staff can still review saved orders. Use **Resume new orders** when ready.

Checkout enforces configured quantity and estimate limits, rolling table and branch rate limits, and the existing guest/session caps. All new orders enter manual review. Approval records an order for a later kitchen queue. The development pilot has no kitchen dispatch, payment or customer status tracking. See [Day 13 scope and verification](docs/day13/VERIFICATION.md).

## Use the delivered workflow

1. Sign in as your private platform operator. In /super-admin, create a DRAFT restaurant, initial branch, plan metadata and administrator invitation. No live service starts and no charge is collected.
2. Deliver the one-use invitation privately to its intended recipient. No email is sent automatically. Invitation acceptance creates credentials for a new account; an existing account must prove its current password. It is not a password-reset flow.
3. Sign in as Restaurant Admin, open /restaurant and select an assigned restaurant/branch. The sidebar opens each section directly. On phones, use **Workspace menu**.
4. Save Profile, weekly Hours and Safety & POS. Overnight hours require explicit “closes next day”. Incomplete profile/all-closed hours can remain drafts, but cannot be submitted as completed configuration. Logo is optional.
5. Open **Manage staff** to review assignments and invite Chef, Worker and Cashier accounts to this branch. Each must accept, then reload saved values in **Profile** to refresh setup progress. Removal affects only that non-admin branch assignment and preserves the user and other branches.
6. Open **Setup progress** in **Profile** and submit configuration when all required checks pass. Because Platform Admin approval already happened during onboarding, this submission automatically moves the tenant to **TRIAL** and activates the branch for staff. This activates staff access only; it does not toggle guest ordering. Guest checkout still follows the separate table QR, staff session, PIN and checkout-pilot controls. No second platform approval is required.
7. Open Menu. Create categories/items; enter prices in rupees, portions/variants and optional add-ons; choose VEG/NON_VEG/EGG classification and availability. Save DRAFT or explicitly PUBLISHED state. Open **Menu preview** to review published records. **Tables & QR** opens the existing table workspace. **Analytics** is a placeholder for a future release.
8. Upload a logo/item photo using a still JPEG/PNG/WebP up to 2 MiB. Save item edits before a photo action. Images are decoded, resized and re-encoded as private WebP. Unsupported/spoofed/oversized inputs fail rather than reporting success.
9. Optional JSON import creates unavailable drafts only. Choose a category and paste 1–20 rows with name, priceMinor (integer paise), foodType and optional description. Edit/save each draft, explicitly confirm its review, then publish in a separate save. No CSV/XLSX/OCR import is claimed.

Saved forms use optimistic versions. If another change wins, reload saved values before retrying; refreshing discards unsaved edits. Item/category removal is archival; restore by editing the state or clearing Archived. A category with unarchived items cannot be archived. Archived records count toward the bounded limits.

Older pre-Day8 menu rows remain preserved but become DRAFT/UNSPECIFIED; classify and publish them deliberately. No real restaurant's menu is fabricated or auto-published.

## Media and safeguards

Uploads are authenticated/branch-scoped with exact Origin and session-bound CSRF. Only the two exact media PUT paths get a 2 MiB body allowance; normal requests stay at 16 KiB. Actual type/decoding, animation, dimensions, processed size and photo quota are checked. No arbitrary URL or original filename is accepted. Source metadata is stripped and output is bounded to 1200×1200 and 300 KiB. Private reads require authorization too.

The supplied media store uses bounded PostgreSQL bytea: one logo and up to 50 item photos per branch. It persists without additional provider keys or local upload directories, at the cost of database/backup size and egress. Assess object storage/CDN migration, processing isolation and ingress/shared limits before production scale. No cloud-storage adapter, antivirus or capacity certification is claimed.

Day 12 checkout applies the branch quantity and value limits. The guest-assistance preference remains configuration for a later workflow. Setting them does not prove fake-order prevention works. Existing POS owns official invoicing, taxes and payment reconciliation; displayed menu amounts are INR estimates. No guest account or restaurant marketing website is created.

## Verification and limits

```sh
npm run verify:report
```

The recorder clears operator database/bootstrap credentials and runs disposable tests: schema/lint/types, API/policy, React/JSDOM, SQL, actual Prisma/CLI, production builds/HTTP, real npm run dev startup/restart with cookie/CSRF/media/menu flows and dependency audit. Day 12 results and logs are in [docs/day12/VERIFICATION.md](docs/day12/VERIFICATION.md) and docs/day12/verification/. Earlier evidence remains under its original milestone. qa-results/ contains new local reports. No Docker, hosted DB credential or local PostgreSQL service is required for these tests.

Day 8.3 additionally tests public pending submission, private status, platform review, approval/rejection, identity/slug rollback, competing decisions and actual approved login through the Next proxy. New browser observations and capture limitations are in docs/day83/BROWSER_NOTES.md. That milestone’s visual review had limited desktop evidence.

The database test engine is PGlite PostgreSQL WASM over loopback TCP with the actual Prisma pg adapter. It does not prove hosted Neon TLS/pooling, native PostgreSQL concurrency or capacity. Linux was exercised; Ubuntu/Windows CI is defined but no remote Windows run was performed. The refined desktop landing was visually inspected; browser menu filtering, password visibility and anonymous sign-in recovery were observed. A Next development-host block was corrected with the exact terminal.local hostname in development only; API Origin/CSRF restrictions remain unchanged. One client-router login transition did not complete in the preview; direct navigation worked. No credentials were entered there. That landing and role review left authenticated role journeys, mobile, keyboard/assistive-technology and hallway acceptance open. See docs/day82/BROWSER_NOTES.md. Source/JSDOM/HTTP checks are not complete browser approval.

The Day2 /design studio remains explicitly synthetic and development-only with ENABLE_UX_PREVIEW=true. All design routes are 404 in production. It is independent from persisted administrator data. Its earlier browser interaction issue remains unresolved.

Next work starts with Day 14 real-time delivery, followed by kitchen operations, manual POS handoff and analytics. MFA/recovery, retention/cleanup, production ingress and full UAT remain release gates. No production rollout is claimed.

Details: docs/day910/CHANGELOG.md, ARCHITECTURE.md, API.md, UX.md, UI_REVIEW.md; historical docs/day82/BROWSER_NOTES.md; docs/day78/ARCHITECTURE.md, UX.md, UI_REVIEW.md; docs/API.md and docs/UAT_RELEASE_GATES.md. Production migration/start is a separate reviewed workflow; deploying the API must retain server/prisma/migrations beside server/dist for readiness.

## Day 14 · Live order review

From the project root, run `npm ci` and `npm run dev` with your private development environment configured. Set `CHECKOUT_PILOT_ENABLED=true` in `server/.env`. Use the exact configured client origin and ensure `API_PROXY_URL` points to the Express origin if you changed its port. Close and reopen older table sessions before testing checkout.

Open **Order review** as an assigned Restaurant Admin or Manager. Submit a pilot order from a verified QR table session. The board should refresh when a branch notification arrives. Disconnecting the socket switches the visible board to HTTP polling every 10 seconds, and reconnecting fetches the current board. Manual refresh remains available.

PostgreSQL and the scoped REST endpoint remain authoritative. Socket.IO sends only a versioned change signal after a successful write. Rooms are resolved from the database and access is checked again before delivery. The pilot is single instance and development only. Day 14 adds no database migration. Day 15 extends these updates to Kitchen tickets.

## Day 15 · Kitchen and pickup

Run `npm ci` and `npm run dev` from the root with your private development environment and `CHECKOUT_PILOT_ENABLED=true`. Startup applies the additive kitchen migration. Approve a QR pilot order in **Order review**, then open **Kitchen tickets** with staff assigned to the same branch.

- Chef accepts or rejects new tickets, starts preparation and marks tickets ready. Rejection requires a reason.
- Worker sees ready tickets and marks them served after delivery. Manager can handle either workflow.
- The saved order is the KOT. It includes the table, ordered items, options and preparation notes. The queue flags orders waiting 15 minutes from approval. Served and rejected tickets are visible for an hour.
- Once preparation enters service, the entry pilot cannot close the table as an ordinary QR session. Service and billing closure are later milestones. Served means delivered to the table.


## Day 16 · Table service

From the project root run `npm ci` and `npm run dev` with your private environment files. For the development checkout pilot, set `CHECKOUT_PILOT_ENABLED=true` in `server/.env` and open a fresh table session. Enable assistance under **Safety & POS → Branch preferences** before testing guest help requests.

- Open Tables & QR (Restaurant Admin) or Tables & secure entry (staff) to see orders and pending help requests for a table's current session. Use **Refresh saved tables** to check for updates. Restaurant Admins, Managers and Workers can clear a request after responding.
- A verified guest can request help and add more items for a separate order in the same session. Each new order goes through the existing price, limits and review checks. For corrections before kitchen acceptance, use review or kitchen rejection and place a corrected order. Accepted orders cannot be edited in place.
- Table closure still revokes guest access and cancels pending pilot orders. Once kitchen service begins, the table remains protected for the later POS handoff and closure workflow.

## Day 16.1 · Reserved table checkout

Use the existing table QR. In **Hours**, save the weekly schedule and choose **15 minutes** or **30 minutes** for the last seating cutoff. Open a new table session during seating hours with `CHECKOUT_PILOT_ENABLED=true` in `server/.env`. The cutoff uses the branch time zone and supports overnight hours. Sessions already opened can continue ordering until they expire or are closed. Turning the cutoff off uses the earlier pilot flow for new sessions.

1. Staff open the table and share its six-digit code with the seated guest.
2. The guest scans, builds a cart and chooses **Place order**. The code dialog verifies that browser and submits the cart. Chef and Worker workspaces show the new order immediately as **Awaiting verification**; staff can see the incoming ticket, but preparation stays locked until a Restaurant Admin or Manager verifies it. If the cart is rejected, the verified browser can correct it and retry.
3. The same browser can place additional orders while the session is active. Staff can rotate the code to transfer access if the guest changes browsers. Rotation revokes prior access.
4. After all remaining orders are served and payment is confirmed in the POS, enter its bill reference and choose **Confirm POS payment and close** on the table board. This records staff confirmation, revokes guest access and releases the table. Empty sessions can still be closed normally.

From the project root, run `npm ci` and `npm run dev` with your private environment. Startup applies the additive migration.


## Day 16.2 · Automatic branch activation

After an already-approved restaurant completes its required setup checks, **Submit configuration** atomically records the submission, moves an eligible tenant from DRAFT to TRIAL, and activates its branch for staff access. The platform administrator does not need to approve it again. A suspended tenant cannot auto-activate; platform suspension disables and pauses branches. Guest ordering remains independently gated and is not enabled by branch activation.

## Day 16.3 · Immediate kitchen visibility

When a customer order commits, the server emits a tenant-and-branch-scoped Socket.IO invalidation. Connected Chef and Worker workspaces refresh the persisted kitchen queue immediately; reconnect and HTTP polling remain as catch-up paths. A new order appears as **Awaiting verification** with no preparation actions. An assigned Restaurant Admin or Manager must still verify it on **Order review** before the Chef can accept and prepare it. Workers see incoming orders and continue to serve only ready tickets. This keeps the existing fake-order review control while removing the misleading empty kitchen queue.

The live update is available only when the local development checkout pilot is enabled. Production ordering and multi-instance durable event delivery are not certified by this change.

## Day 16.4 · Order approval thresholds

Configure optional approval thresholds for estimated order value and total item quantity in **Safety & POS**. Ordinary orders go directly to the Chef. Orders over either threshold or flagged for repeated carts or bursts require staff approval. See [Day 16.4 setup](docs/day16.4/README.md).

## Day 17 · Order tracking and table release

Use the project root with your private client and server environment files configured.

```sh
npm ci
npm run dev
```

1. For the checkout pilot, set `CHECKOUT_PILOT_ENABLED=true` in `server/.env`. For reserved service, save a last seating cutoff under **Hours** and open a fresh table session during seating hours.
2. Scan the existing table QR, submit an order, and select **Track your order**. The tracker checks the guest's latest orders roughly every 15 seconds while the tab is visible. Approval, rejection and cancellation are shown as separate states.
3. Use the same branch's **Kitchen tickets** workspace to move an order through preparation and service. Flagged orders still go through **Order review**.
4. Once the reserved table's orders are served or resolved, record payment in the restaurant POS. On **Tables**, enter the bill reference and select **Confirm payment and release table**. Staff can then open a new session with a new code for the same printed QR.

Day 17 adds no database migration. Guest tracking requires a current verified table session. Closing or settling the table ends guest access to live status. The estimates in RestroDock are separate from the final bill issued by the restaurant POS.

## Day 18.1 · Waiter-issued table PIN

With `CHECKOUT_PILOT_ENABLED=true` in `server/.env`, a guest can scan the table QR and browse the menu/build a cart before the waiter opens the table. At checkout, the guest enters their name, mobile number and the PIN issued by staff. In the staff **Manage tables** page, a waiter selects the correct table and chooses **Start table session & generate PIN**; share that one-time PIN with the guest. PIN verification reserves the session to that browser, so that guest can place follow-up orders there. A different device sees that the table already has an active guest session. After the orders are served or resolved, the assigned waiter or cashier confirms external POS payment to release the table as in Day 18.

No schema migration is added. The pilot feature flag must be enabled and the table must have an active QR. Existing sessions created before enabling the flag must be closed and opened again. Unverified carts are kept only in the current browser's session storage; they are not server orders until PIN verification and checkout succeed.

## Day 17.1 · Restaurant Admin redesign

Open **Restaurant workspace** to see today's service. The dashboard summarizes the selected branch's current table sessions and links to its table or review queue. **Tables & QR** groups tables by section and shows actions for the selected table. **Menu** puts categories, items and the editor side by side on larger screens, with a shortcut to the published guest preview. Setup remains under **Profile**, **Hours**, and **Safety & POS**.

Use your existing private environment files and run `npm ci` followed by `npm run dev` from the project root. Day 17.1 adds no database migration.

## Day 18 · Cashier and settlement

Run `npm ci` and `npm run dev` from the project root with your existing private environment files. Startup applies the additive cashier migration. Use a checkout pilot branch to test the flow.

1. The guest selects **Request bill** under **Your orders**, or authorized staff request it from the table. New orders pause for that session.
2. Open **Tables & QR** or the cashier's **Tables** workspace and choose **Bill requested**. Use the item summary to create the final invoice in the existing POS. The summary shows estimates and is not a tax invoice.
3. Once all billable orders are served and the POS payment is complete, record its invoice reference, choose Cash or UPI, and confirm. The table is released and guest access is revoked.
4. A manager or restaurant admin can reopen unpaid ordering. An approved reopening after settlement starts a separate session and issues a fresh PIN. The original settlement and audit trail remain intact.

### Test on a PC and phone together

In `server/.env`, use your PC's LAN address as the canonical origin and add localhost as the second development origin:

```env
CLIENT_ORIGIN=http://192.168.31.16:3000
DEV_CLIENT_ORIGIN=http://localhost:3000
```

Stop the previous dev server and run `npm run dev -- --hostname 0.0.0.0`. Check the API startup log for both origins. If it reports old values, remove any shell overrides for these settings, or open a fresh terminal before restarting. Keep `API_PROXY_URL=http://127.0.0.1:4000` in `client/.env` if your backend uses port 4000. Sign in separately on each origin. Use LAN-generated QR links on the phone.

## Day 18.2 · Platform billing mode

In **Platform Admin → Restaurant directory**, open a restaurant, choose **External POS** or **RestroDock Billing**, and select **Save billing mode**. The setting applies to all branches of that restaurant. Existing and new restaurants default to External POS. The server checks Platform Admin permissions, rejects updates from an outdated restaurant record, and logs successful changes.

Day 18.2 originally stored the billing preference only. Customers can still request a bill through the existing checkout flow in either mode. See Day 25 below for the current RestroDock receipt workflow.

The additive migration runs through the existing development startup. From the project root, run `npm ci`, configure your private environment files, and run `npm run dev`.

## Day 20.2 · Analytics drill-downs

Open **Restaurant Admin → Analytics**, choose a branch and date range, and expand **Explore this period**. The three reports use the same filters and appear in **Export CSV**.

- **Orders & estimated value** compares the selected period with the immediately preceding period of equal calendar length. Daily totals and hourly order buckets use the branch time zone. Order counts include all submitted orders. Estimated values and averages exclude orders awaiting review, rejected orders and cancellations, based on current status.
- **Menu performance** shows the 50 items with the most units ordered and category totals across all eligible items. Expand an item to see the number of orders containing it. Item labels and categories use the current menu. Values use saved line prices, including the selected portion and add-ons.
- **Kitchen performance** shows the median and 90th percentile from Preparing to Ready, using orders placed in the selected period. It shows the number of tickets with both timestamps and displays **Unavailable** when there are none. The hourly table shows order arrivals, including tickets awaiting review.

POS confirmation stays visible in the overview. Confirmed payment amounts remain unavailable because settlement confirmations do not supply those amounts to this report.

Day 20.2 adds no database migration. From the extracted project root, run `npm ci`, restore your private `client/.env` and `server/.env`, then run `npm run dev`. For the automated checks, run `npm run verify`.

## Day 21 · Public landing and pricing

Open the home page and select **Pricing**. Monthly rates are ₹999 for Starter, ₹1,499 for Growth, and ₹1,999 for Pro. With yearly billing, the equivalent monthly rates are ₹799, ₹1,299, and ₹1,799, with annual charges of ₹9,588, ₹15,588, and ₹21,588. Both billing-period options link to the existing restaurant application. Subscription checkout, plan limits and tenant lifecycle enforcement remain separate roadmap work. This release adds no migrations.

### Day 21 · Platform subscription records

In **Platform Admin → Restaurant directory**, open a restaurant to view branch, table and active staff counts, assign its plan, and record subscription status and term end. The restaurant access controls handle suspension and return to draft independently. Subscription records support manual tracking, while automatic expiry enforcement, usage limits and payment collection are pending. This update uses the existing subscription fields and requires no migration.

### Day 21.1 · Plan access and manual renewal

Starter and Growth support one active outlet. Pro supports three. Growth and Pro include detailed analytics and custom manager approval thresholds. All plans retain checkout safety controls and the existing POS handoff. Existing trials and unassigned restaurants retain their pilot access.

In **Restaurant Admin → Profile**, review the assigned plan, active outlet usage and renewal status. In **Platform Admin → Restaurant directory**, open a restaurant, set the subscription status to Active, enter a future term end date and save. The date takes effect at 00:00 UTC. An expired or suspended subscription blocks new tables and new outlet activations. Existing tables can continue ordering and settle normally, subject to the ordinary safety and session rules. The separate restaurant suspension control still revokes operational access immediately.

The outlet limit applies to activating provisioned outlets and to plan changes. This release adds no new outlet provisioning screen. Existing subscription fields support these rules without a new migration. Start from the project root with `npm ci` and `npm run dev` after restoring your environment files.

### Day 23 · Guest order tracking

After submitting an order, open **Track your order** to see orders from this table session. Each receipt shows the kitchen status, reference, progress and estimated amount. The order tracker and bill request support English and Hindi. Status refreshes every 15 seconds while the tab is visible. Confirm **Request bill** to notify staff and pause new orders. The restaurant issues the final bill through its existing POS.

This update adds no migrations. Restore your environment files, then run `npm ci` and `npm run dev`.

### Public landing and login update

The public navigation opens `/sign-in` directly. Staff, Restaurant Admin and Platform Admin each have a sign-in section on that page. The server still decides workspace access from the signed-in account. The landing page includes an FAQ, and the footer links to the Terms & Conditions and Privacy drafts. Confirm the legal entity, support contact, data retention and commercial terms before publishing those drafts for production. No migrations are required.

### Enterprise landing refresh

The public site uses the slate and emerald palette, with a sample guest-to-kitchen-to-cashier workflow. **View Demo** opens the illustrated product walkthrough and **Request a Free Trial** opens the existing application for review. The FAQ, pricing, policy pages and dedicated three-role sign-in remain available.

## Day 24 · POS handoff format

Manual POS settlement now stores a versioned JSON snapshot with the served orders,
INR amounts in paise, and a key scoped to tenant, branch, session and handoff revision.
Existing settlement snapshots retain their original shape. No schema migration is required.
The snapshot contains order estimates. The restaurant's POS owns the official invoice.

The server-side adapter interface is reserved for a future provider. Before enabling
one, verify vendor API access, item and tax mappings, durable idempotency, and receipt
lookup in a vendor sandbox. Persist the exact payload before sending. Reuse it and its
key for a retry, apply bounded backoff to retryable failures, and reconcile ambiguous
outcomes before another send. Adapter delivery must never create a kitchen order or
change local payment state. Day 24 does not register a provider or start a delivery worker.

## Day 25 · Billing receipts and recovery

Platform Admin can enable **RestroDock Billing** per restaurant. In the staff
**Billing queue**, review the table total, collect Cash or UPI, and confirm
payment to issue the itemized receipt and release the table. Recent receipts
for available tables appear in the same queue. External POS mode uses the
restaurant's existing invoice reference and settlement workflow.

See [Day 25 operations](docs/DAY25-OPERATIONS.md) for monitoring, backup
scheduling, a restore drill, and service recovery. No schema migration is
required for Day 25.

## Day 26 · Service end-to-end tests

After installing dependencies, run `npm run test:e2e`. The suite starts Next
and Express on loopback with a disposable PGlite database and synthetic
accounts. It follows table QR/PIN entry, order tracking, live kitchen updates,
staff service, both billing modes, safe retries, and denial of staff access to
a second tenant. It uses the actual API and database through the Next proxy.

The Ubuntu CI job also drives the guest and cashier pages in Chromium. It
installs Playwright in the runner's temporary directory and requires the
browser run to pass. Windows CI runs the HTTP and Socket.IO service journey.
To require Chromium locally, install Playwright 1.57.0 and Chromium, set
`RESTRODOCK_BROWSER_MODULE` to the absolute path to Playwright's `index.mjs`,
and set `RESTRODOCK_REQUIRE_BROWSER=1` before running the same command.
The default local command uses HTTP and Socket.IO. CI retains the service log
in its verification artifact.

## Keep me signed in

Select **Keep me signed in on this device** when signing in to a restaurant
or staff account on a personal browser. This creates a session with a fixed
30-day expiry. Sign out to revoke that browser's session. Unchecked sign-ins
and Platform Admin sign-ins use a browser-session cookie and expire after
30 minutes idle or 12 hours total. Platform Admin is determined by the
server. The additive migration keeps older sessions on the standard policy.

## Password recovery via Brevo

Authenticate your sending domain in Brevo, register a sender, and set
`BREVO_API_KEY` and `BREVO_SENDER_EMAIL` in `server/.env`. Use a dedicated
RestroDock API key. Set `CLIENT_ORIGIN` to the public HTTPS origin in production.
Users open **Forgot password?** from sign-in. A link expires after 20 minutes
and works once. Resetting a password revokes existing sessions. Recovery
is optional until both mail settings are configured. Check server logs
for `password_reset_delivery_failed` if the message does not arrive.

## Platform Analytics

Sign in as Platform Admin and open **Platform Analytics** in the sidebar. The current snapshot includes every restaurant and branch, and counts configured tables without archived tables. An active QR code means a non-revoked code on a configured table. The attention list separately checks whether active branches have published table entry and at least one such code.

The 7-, 30-, and 90-day activity periods use UTC calendar days, including the current day. Orders are recorded RestroDock orders of all statuses. Application decisions are counted by review date, so their totals can include applications received before the selected period. Upcoming term ends cover the next 30 days. A plan assignment or term end does not indicate a payment.

Select a plan, status, or attention item to filter the restaurant table. Expand a restaurant to load branch counts and open its existing management view. The API uses the existing Platform Admin authorization and returns counts and operational identifiers, without guest details. This feature uses the existing schema.

### Chef and Waiter voice announcements

In the checkout pilot, open the assigned Chef queue or Waiter workspace. Select a Hindi voice supplied by the device and tap **Enable sound**. The test phrase lets staff confirm the voice and volume. Available voices, including female voices, depend on the browser and device. Select a female Hindi voice if installed. Menu item names are spoken as entered in the menu.

The Chef hears orders entering the kitchen queue, including orders just approved by a manager. The Waiter hears orders marked ready and new guest assistance requests for the selected outlet. Guest assistance must be enabled in the branch settings. Sound starts off when you open or reload a workspace or switch outlets. Alerts are live only, so staff can use the boards to catch up after a disconnect.
#   R e s t r o D o c k  
 