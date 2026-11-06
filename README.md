# SplitSnap

Scan a restaurant bill, let everyone claim what they ate on their own phone, and collect each person's share over UPI.

## How it works

1. The host scans the bill or types it in, sets how many people are splitting, and sends a link.
2. Guests open the link with no signup and tap what they had. Everyone sees claims update live.
3. Items can be counted (2 of 6 rotis), shared (3 people, 2 plates), or the whole bill can be split equally.
4. When everyone has joined and every item is claimed, each person pays by UPI link, QR code or cash.
5. The host confirms each payment. UPI can't report a person-to-person payment back to the app, so this step is manual.

SplitSnap also works from the home screen on iPhone and Android.

## Tech

- **Next.js** (App Router) and **TypeScript**, hosted on **Vercel**
- **Supabase**: Postgres, anonymous auth, Realtime
- **Cloudflare Workers AI** with the open Qwen 3.8 vision model to read bills

## Design notes

- **Money is integer paise.** Largest-remainder rounding makes shares add up exactly to the bill. See `lib/split.ts`.
- **All writes go through database functions.** Tables only have read policies, so row-level security limits each person to their own bills, and rules like locking a bill after payment hold however a client calls the API. See `supabase/migrations`.
- **Tapping feels instant.** Claims update on screen first and save in order behind it, and a reload after the last save corrects anything the server refused. See `hooks/useBill.ts`.
- **Live updates watch one row.** Each change bumps a version on the bill, so clients only need one Realtime subscription, backed by polling.
- **Bill photos aren't stored.** They're validated, read and discarded. Bills are deleted after 30 days by a scheduled job.

## Project structure

```
app/                  Routes, layout, styles and the bill-scanning API
components/           UI, with the bill screens in components/bill
hooks/useBill.ts      Bill data, live updates and instant claims
lib/                  Split maths, UPI links, QR and receipt images, with tests
supabase/migrations/  Database schema and functions, in order
```

## Running locally

You need Node 22 and free Supabase and Cloudflare accounts.

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and fill it in.
3. Apply `supabase/migrations` in filename order, using the Supabase SQL Editor or `supabase db push`.
4. In Supabase, turn on anonymous sign-ins under Authentication.
5. Run `npm run dev`.

## Checks

```
npm test            Unit tests
npm run typecheck   TypeScript
npm run lint        ESLint
npm run build       Production build
```
