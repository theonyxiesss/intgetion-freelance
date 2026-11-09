# intgetion-freelance

The freelance marketplace of the INTGETION platform as a standalone service:
seller storefronts, services with packages and drafts, requests and orders
with timers, crypto payments straight to the freelancer's proven address
(with escrow details), the order room, reviews both ways, client tasks with
proposals and invites, complaints with the three-report hold, and the
assistant's freelance tools. Not connected to the platform yet; it is
integrated later through a separate branch and PR. The pages and components
(`src/modules/freelance/ui`) stay in the platform.

- Package `@intgetion/freelance`, HTTP service on port `4130`.
- Depends on `@intgetion/kit` v0.3.1 and `@intgetion/billing` v0.2.0
  (`./engine`: chains, transfer checks, payment status, escrow), by git tag.
- Owns the 14 `freelance_*` tables (migration `0001_freelance.sql`, the final
  state of platform migrations 0050, 0055, 0056, 0062, 0069, 0071, 0072,
  0073 and 0084, with the `app_rw` grants; tracker
  `freelance_schema_migrations`). `./db` exports their definitions for
  read-only use by other modules.

## Ports

Freelance reads and writes only its own tables. Everything else goes through
`src/ports.ts` (`src/platform.ts` keeps the old function names on top of them):

- candidates: profile check, storefront names; contacts: own contacts;
  companies: membership and companies of a person; taxonomy: skills;
  users: proven payout wallet; billing: sanctions, checkout switch, payer wallet;
- notifications: notices and the login email;
- moderation: `enqueueModeration(input, tx)` inside the freelance
  transaction, `fileReport`, and the open-report count behind the hold;
- platform: audit, rate limits, mail to platform owners, the Telegram bot.

Moderation decisions come back through `POST /v1/moderation/services/:id` and
`POST /v1/moderation/client-tasks/:id` `{decision: "publish"|"reject", note}`
(or `decideServiceModeration` / `decideTaskModeration` in-process).

## HTTP

Every route except `/health` needs `authorization: Bearer $FREELANCE_SERVICE_TOKEN`.
The platform signs the person in and passes them in `x-user-id` (and the
address in `x-client-ip`). Money in minor units travels as strings.

| Method | Path | Does |
| --- | --- | --- |
| POST | `/v1/tasks/run-timers` | cron: order timers, payment rechecks, expired tasks |
| GET | `/v1/services/by-slug/:slug` | published service |
| GET | `/v1/services/:id/reviews` | public reviews |
| GET | `/v1/open-tasks?category=` | open client tasks |
| POST | `/v1/seller` | `{accepting}` |
| GET/PATCH/POST | `/v1/service-draft` | read, patch, `{action: confirm\|reset}` |
| POST | `/v1/services` | create a service |
| PUT | `/v1/services/:id` | update |
| POST | `/v1/services/:id/submit`, `/pause` | send to review, pause |
| POST | `/v1/services/:id/report`, `/v1/orders/:id/report` | complaint |
| POST | `/v1/requests` | order request |
| GET | `/v1/orders/:id` | the order for a party |
| POST | `/v1/orders/:id/transition` | move the order |
| GET/POST | `/v1/orders/:id/messages` | order room |
| POST | `/v1/orders/:id/payment` | start a payment |
| GET | `/v1/payments/:id` | refresh a payment |
| POST | `/v1/payments/:id/confirm` | `{txHash}` |
| POST | `/v1/reviews`, `/v1/client-reviews` | reviews |
| POST | `/v1/client-tasks` | post a task |
| GET | `/v1/client-tasks/:id/proposals` | proposals for the owner |
| POST | `/v1/client-tasks/:id/close`, `/invite` | close, invite a freelancer |
| POST | `/v1/proposals` | send a proposal |
| POST | `/v1/proposals/:id` | `{action: accept\|decline\|withdraw}` |

Errors: `{error: {code, message, details}}`. The catalog search and the
assistant tools are used in-process by the platform for now.

Over HTTP every port goes to one platform callback,
`POST /api/internal/freelance/:op`, answering `{result}` or `{error}`.

## Run

```bash
cp .env.example .env
npm ci
npm run migrate
npm start
```

## Tests

Unit tests run without a database. Integration tests run when `DATABASE_URL`
is set, on a database prepared as in CI: `test/sql/pre/*.sql`, then
`npm run migrate`. Other modules are in-memory fakes (`src/test-support.ts`);
payments use a fake chain reader, no live transfer happens.
