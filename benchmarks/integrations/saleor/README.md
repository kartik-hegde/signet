# Saleor real-application demo

This integration adds five page-registered WebMCP tools to Saleor's current
production storefront and protects the consequential order operation with Signett.
It runs against a full local Saleor Core, Postgres, worker, dashboard, cache, and
mail stack—not a benchmark fixture.

## Source layout

The application is deliberately **not vendored** into Signett. The ignored `.external`
directory contains two forks pinned in [`manifest.json`](./manifest.json):

```text
signett/
├── benchmarks/integrations/saleor/ # manifest, task, oracle, patches
└── .external/
    ├── saleor-storefront-signett/    # integration fork
    └── saleor-platform-signett/      # unmodified local Saleor stack
```

This keeps Saleor's history and license intact, makes the integration a reviewable
patch rather than a copied application, and keeps benchmark state/reset logic out
of the product repository. The storefront is FSL-1.1-ALv2 and Saleor Platform is
BSD-3-Clause; their licenses remain in their respective forks.

## What the agent can do

The checkout page registers normal reusable application capabilities:

- `inspect_checkout`
- `set_checkout_contact`
- `list_delivery_options`
- `select_delivery_option`
- `place_order`

The mutation tools call the same Saleor server actions, GraphQL API, checkout
transport, and payment code as the human UI. `place_order` adds:

1. live checkout context and authorization;
2. exact total/currency validation before payment;
3. an app-owned shopper approval dialog;
4. browser-profile idempotency with cross-tab Web Locks;
5. a typed operation journal for ambiguous outcomes;
6. authoritative order recovery and paid-order verification; and
7. privacy-safe lifecycle events rendered in the demo panel.

Browser idempotency is a presentation-layer control, not a replacement for Saleor's
server security or order semantics. A production multi-device deployment should put
the logical operation key in a transactional backend store.

## Run it

From `saleor-platform-signett`:

```sh
/Applications/Docker.app/Contents/Resources/bin/docker compose up -d
/Applications/Docker.app/Contents/Resources/bin/docker compose run --rm api python3 manage.py migrate
/Applications/Docker.app/Contents/Resources/bin/docker compose run --rm api python3 manage.py populatedb --createsuperuser
```

The seed creates `admin@example.com` / `admin`. Then configure
`saleor-storefront-signett/.env.local` from `.env.signett.example`, install with the
pinned pnpm version, and start the storefront:

```sh
npx --yes pnpm@10.28.1 install --frozen-lockfile
npx --yes pnpm@10.28.1 run generate:all
node node_modules/next/dist/bin/next dev
```

Open `http://localhost:3000/en/default-channel`, add a product, and enter checkout.
The black **Protected by Signett** panel confirms the five live registrations.

Run the health/revision check and independent database oracle from the benchmark:

```sh
npm run saleor:preflight
npm run saleor:oracle -- --email proof@example.com
```

## Demo script

1. Let the agent inspect the checkout and set a fake local customer/address.
2. Let it calculate and select free delivery.
3. Click **Arm lost-response proof**.
4. Ask the agent to place the order. The shopper must approve the exact total.
5. Saleor commits the paid order; the page intentionally throws away that response.
6. Signett uses the correlation record to re-read Saleor, then reports `recovered`,
   `verified`, and `succeeded`.
7. Retry the identical operation ID. Signett reports `replayed` without requesting a
   second approval; the Postgres oracle still reports exactly one order.

The deterministic fault is one-shot and occurs only after Saleor returns an order ID.
It does not stub GraphQL, the payment mutation, checkout completion, or verification.

## Reset and teardown

The authoritative full reset is the official seeded platform lifecycle:

```sh
/Applications/Docker.app/Contents/Resources/bin/docker compose down --volumes --remove-orphans
/Applications/Docker.app/Contents/Resources/bin/docker compose up -d db cache
/Applications/Docker.app/Contents/Resources/bin/docker compose run --rm api python3 manage.py migrate
/Applications/Docker.app/Contents/Resources/bin/docker compose run --rm api python3 manage.py populatedb --createsuperuser
/Applications/Docker.app/Contents/Resources/bin/docker compose up -d
```

This deletes only the named Compose project's local containers and volumes. Clear the
browser profile between benchmark trials so IndexedDB and session correlation begin
empty. Teardown is `docker compose down`; add `--volumes` only when a data reset is
intended.
