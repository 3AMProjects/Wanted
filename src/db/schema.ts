import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// All money columns are whole Rupiah stored as bigint. IDR has no minor unit
// in practice, and integers keep fee math exact.
const money = (name: string) => bigint(name, { mode: "number" });
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const userRole = pgEnum("user_role", ["user", "admin"]);
export const kycStatus = pgEnum("kyc_status", [
  "none",
  "pending",
  "verified",
  "rejected",
]);
export const postCategory = pgEnum("post_category", ["animal", "vehicle"]);
export const postStatus = pgEnum("post_status", [
  "pending_payment",
  "active",
  "fulfilled",
  "cancelled",
  "expired",
]);
export const claimStatus = pgEnum("claim_status", [
  "pending", // waiting for the poster
  "accepted", // reward released to the hunter
  "rejected", // poster rejected; hunter may still dispute within the window
  "disputed", // admin decides
  "dismissed", // final: rejected and not disputed, or admin ruled for the poster
  "closed", // post was fulfilled/cancelled through another path
]);
export const disputeStatus = pgEnum("dispute_status", ["open", "resolved"]);
export const disputeOutcome = pgEnum("dispute_outcome", [
  "hunter_wins",
  "poster_wins",
]);
export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "paid",
  "expired",
  "failed",
]);
export const withdrawalStatus = pgEnum("withdrawal_status", [
  "requested",
  "processing",
  "completed",
  "failed",
]);
export const ledgerAccount = pgEnum("ledger_account", [
  "external", // money outside the platform (payment gateway / banks)
  "escrow", // rewards held for a specific post
  "platform", // platform revenue (fees)
  "user", // a user's withdrawable balance
  "payout_pending", // withdrawals sent to the gateway but not yet settled
]);

/** One row per auth.users row; created by a trigger (see drizzle/0001_supabase.sql). */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name").notNull().default(""),
  role: userRole("role").notNull().default("user"),
  kycStatus: kycStatus("kyc_status").notNull().default("none"),
  createdAt: createdAt(),
});

export const kycSubmissions = pgTable(
  "kyc_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    fullName: text("full_name").notNull(),
    // NIK is stored masked; the KTP photo in the private bucket is the source of truth.
    nikMasked: text("nik_masked").notNull(),
    // HMAC of the NIK, so one identity can't back several accounts.
    nikHash: text("nik_hash").notNull(),
    ktpPath: text("ktp_path").notNull(),
    selfiePath: text("selfie_path").notNull(),
    status: kycStatus("status").notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedBy: uuid("reviewed_by").references(() => profiles.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("kyc_status_idx").on(t.status), index("kyc_nik_hash_idx").on(t.nikHash)],
);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    posterId: uuid("poster_id")
      .notNull()
      .references(() => profiles.id),
    category: postCategory("category").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    lastSeenLocation: text("last_seen_location").notNull(),
    lastSeenLat: doublePrecision("last_seen_lat"),
    lastSeenLng: doublePrecision("last_seen_lng"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    reward: money("reward").notNull(),
    postingFee: money("posting_fee").notNull(),
    status: postStatus("status").notNull().default("pending_payment"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("posts_status_idx").on(t.status, t.createdAt),
    index("posts_poster_idx").on(t.posterId),
    check("posts_reward_positive", sql`${t.reward} > 0`),
    check("posts_fee_nonnegative", sql`${t.postingFee} >= 0`),
  ],
);

export const postMedia = pgTable("post_media", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id")
    .notNull()
    .references(() => posts.id, { onDelete: "cascade" }),
  path: text("path").notNull(), // public bucket "post-media"
  sortOrder: integer("sort_order").notNull().default(0),
});

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id),
    hunterId: uuid("hunter_id")
      .notNull()
      .references(() => profiles.id),
    message: text("message").notNull(),
    foundLocation: text("found_location").notNull(),
    foundLat: doublePrecision("found_lat"),
    foundLng: doublePrecision("found_lng"),
    status: claimStatus("status").notNull().default("pending"),
    reviewDeadline: timestamp("review_deadline", {
      withTimezone: true,
    }).notNull(),
    rejectReason: text("reject_reason"),
    disputeDeadline: timestamp("dispute_deadline", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("claims_post_idx").on(t.postId, t.status),
    index("claims_hunter_idx").on(t.hunterId),
    // A hunter gets one open claim per post at a time.
    uniqueIndex("claims_one_open_per_hunter")
      .on(t.postId, t.hunterId)
      .where(sql`${t.status} in ('pending', 'rejected', 'disputed')`),
  ],
);

/** Proof files live in the private "proofs" bucket; served only via signed URLs. */
export const claimMedia = pgTable("claim_media", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: uuid("claim_id")
    .notNull()
    .references(() => claims.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
});

export const disputes = pgTable(
  "disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id),
    // null when the system escalated a claim the poster never reviewed
    openedBy: uuid("opened_by").references(() => profiles.id),
    reason: text("reason").notNull(),
    status: disputeStatus("status").notNull().default("open"),
    outcome: disputeOutcome("outcome"),
    resolutionNote: text("resolution_note"),
    resolvedBy: uuid("resolved_by").references(() => profiles.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("disputes_one_per_claim").on(t.claimId),
    index("disputes_status_idx").on(t.status),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id),
    payerId: uuid("payer_id")
      .notNull()
      .references(() => profiles.id),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref"),
    checkoutUrl: text("checkout_url"),
    amount: money("amount").notNull(),
    status: paymentStatus("status").notNull().default("pending"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("payments_provider_ref").on(t.provider, t.providerRef)],
);

export const withdrawals = pgTable("withdrawals", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id),
  amount: money("amount").notNull(),
  fee: money("fee").notNull(),
  net: money("net").notNull(),
  bankCode: text("bank_code").notNull(),
  accountNumber: text("account_number").notNull(),
  accountHolderName: text("account_holder_name").notNull(),
  provider: text("provider").notNull(),
  providerRef: text("provider_ref"),
  status: withdrawalStatus("status").notNull().default("requested"),
  failureReason: text("failure_reason"),
  createdAt: createdAt(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/**
 * Double-entry ledger. Every journal's entries sum to zero; a user's balance is
 * the sum of their "user" entries. Rows are append-only.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    journalId: uuid("journal_id").notNull(),
    account: ledgerAccount("account").notNull(),
    userId: uuid("user_id").references(() => profiles.id),
    postId: uuid("post_id").references(() => posts.id),
    amount: money("amount").notNull(),
    memo: text("memo").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("ledger_user_idx").on(t.account, t.userId),
    index("ledger_post_idx").on(t.account, t.postId),
    index("ledger_journal_idx").on(t.journalId),
  ],
);

export type Profile = typeof profiles.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Claim = typeof claims.$inferSelect;
