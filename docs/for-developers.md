# Local and internals

Production deploy is in the [README](../README.md). This is the laptop
path and how claims / votes actually work.

## Laptop

Requires Node 20+. No Docker.

```bash
cp .env.example .env
# AUTH_SECRET, ADMIN_EMAILS. LUMA_API_KEY only for a real Luma event.
npm install
npm run db:start
npm run db:setup
npm run db:migrate
npm run db:seed
npm run dev          # http://localhost:3002
```

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

No Luma key yet? `npm run db:fake` fills the database with made-up nights
and prints a sign-in link for each role.

Without `RESEND_API_KEY`, sign-in links print in the `next dev` terminal.
Production will not take that branch. It throws. Each fork owns its
own Resend account; see Mail in the [README](../README.md).

With `npm run db:start`, `SHADOW_DATABASE_URL` must be on its own port,
the next one up from `DATABASE_URL`. On the same port, `prisma migrate dev`
fails with P3005 every time. On your own Postgres, a second database on the
same server is fine.

## Environment

`DATABASE_URL`
Render, or `npm run db:start`.

`SHADOW_DATABASE_URL`
Laptop only.

`AUTH_SECRET`
Render generates it. Do not rotate it on a live build night.

`ADMIN_EMAILS`
You.

`LUMA_API_KEY`
Only to import or sync a real event. From that event's calendar.

`APP_URL`
The public site. Render falls back to `RENDER_EXTERNAL_URL`.

`RESEND_API_KEY`, `EMAIL_FROM`
This deploy's Resend. Production throws if the key is missing. `EMAIL_FROM` must be a verified domain on that account.

`APP_NAME`, `APP_TAGLINE`, `FOOTER_CREDIT`
Optional copy.

On a **free** Render instance, pre-deploy does not run. Put
`&& npm run release` on the end of `buildCommand` or the database stays
empty.

## How a claim works

1. Guest opens the event, types the Luma-ticket email, follows the link.
2. Stamp looks them up on Luma and keeps a local roster (200 req/min budget).
3. Fail closed: not on the list, not approved, or not checked in.
4. `FOR UPDATE SKIP LOCKED` assigns one unused code. Unique on
   `(event, sponsor, attendee)` so a second tap returns the same code.

## How a vote works

Projects are typed in at `/admin/e/[slug]/vote`. Open by hand. One vote
per stamped guest, movable until close. Auto-close is six hours after
open, measured from that press, not from Luma’s `endAt`.

## Tests

```bash
npm test          # unit
npm run test:e2e  # browser, against its own database and a fake Luma
npm run test:all
npm run stress    # concurrency, against the dev server on port 3002
```

`npm run test:e2e` creates `ambassadors_test` on the same Postgres as
`DATABASE_URL`, starts a fake Luma on port 3199, and the app on port
3100. It does not touch the database `npm run dev` is using.

## Screenshots and walkthrough

```bash
npx tsx preview.ts
npx tsx docs/capture-screenshots.ts   # stills first. The walkthrough resets the fixture.
npx tsx docs/record-walkthrough.ts    # docs/images/walkthrough.webm
npx tsx preview.ts --clean
```

Needs Playwright and `npm run dev`.
