# Wanted

Bounty board for finding lost animals and vehicles. A poster sets a reward and
prepays it (plus a platform fee) into escrow; a hunter submits information and
proof; the poster accepts or rejects, and an admin steps in only on disputes.

## Stack

Next.js 15 (App Router) + TypeScript, Supabase (Auth, Postgres, Storage),
Drizzle ORM + Zod, Tailwind. Payments sit behind `PaymentProvider`
(`src/server/payments`) with a `mock` provider for development and a Xendit
provider (Invoices for prepayment, Disbursements for withdrawals).

## Business rules

| Rule | Where |
| --- | --- |
| Categories: animal, vehicle | `src/db/schema.ts` |
| Poster pays reward + `POSTING_FEE_BPS` up front | `src/domain/fees.ts`, `services/posts.ts` |
| KYC (KTP + selfie, admin review) required to post, claim and withdraw | `services/kyc.ts`, `lib/auth.ts` |
| One NIK can only be verified on one account | `submitKyc` |
| Hunter claim needs info + photo/video proof; proof is private | `services/claims.ts`, `proofs` bucket |
| Poster has `CLAIM_REVIEW_DAYS` to review; silence escalates to admin | `sweepClaims` |
| Rejected hunter has `DISPUTE_WINDOW_DAYS` to dispute; admin decides | `openDispute`, `resolveDispute` |
| No cancel while any claim is pending, rejected-but-disputable, or disputed | `src/domain/rules.ts` |
| Cancel: `CANCEL_FEE_BPS` (20%) of reward kept, rest to poster balance; posting fee not refunded | `cancellationSplit` |
| Posts expire after `POST_DURATION_DAYS` with the same split as cancel | `expireDuePosts` |
| Withdrawal: `WITHDRAWAL_FEE_BPS` deducted from the payout | `withdrawalSplit` |

Money is tracked in an append-only double-entry ledger (`ledger_entries`);
balances are sums of entries, and every journal must sum to zero.

All data access goes through the server with a privileged connection. RLS is
enabled on every table with no policies, so the public Supabase API exposes
nothing. Post photos are in a public bucket; proofs and KYC documents are in
private buckets and served through 10-minute signed URLs after an
authorisation check.

## Running locally

```bash
cp .env.example .env.local   # fill in Supabase keys and secrets
npm install
npm run db:migrate           # uses DIRECT_DATABASE_URL
npm run dev
```

With `PAYMENT_PROVIDER=mock`, checkout goes to `/dev/mock-pay` and
withdrawals complete instantly. Mock is refused when `VERCEL_ENV=production`.

To make yourself admin:
`update profiles set role = 'admin' where id = '<your auth user id>';`

Cron: `vercel.json` calls `/api/cron/sweep` daily with
`Authorization: Bearer $CRON_SECRET`. Xendit webhooks go to
`/api/webhooks/payments` (set the callback token in `XENDIT_CALLBACK_TOKEN`).

## Tests

```bash
npm test                                      # unit tests
TEST_DATABASE_URL=postgres://... npm test     # + end-to-end money flow on a migrated DB
```

Outside Supabase, create stub `auth.users (id uuid, email text)` and
`storage.buckets (id text, name text, public boolean, file_size_limit bigint)`
tables before migrating.

## Known gaps before launch

- Uploads go through server actions; Vercel caps request bodies at 4.5 MB.
  Switch to direct-to-storage signed uploads.
- The Xendit provider is untested against a real account.
- No notifications (email/WhatsApp) yet for new claims, deadlines or decisions.
- Refunds land in the poster's balance, so withdrawing them also pays the
  withdrawal fee.
