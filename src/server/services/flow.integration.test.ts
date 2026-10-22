/**
 * End-to-end money flow against a real Postgres. Runs only when
 * TEST_DATABASE_URL points at a database migrated with `npm run db:migrate`
 * (plus stub `auth.users` / `storage.buckets` tables outside Supabase).
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;

vi.mock("./storage", () => ({
  BUCKETS: { postMedia: "post-media", proofs: "proofs", kyc: "kyc" },
  uploadFiles: async (_b: string, prefix: string, files: File[]) => files.map((_, i) => `${prefix}/${i}`),
  realFiles: (f: unknown[]) => f,
  publicUrl: (p: string) => p,
  signedUrls: async (_b: string, p: string[]) => p,
}));

describe.skipIf(!url)("money flow", async () => {
  Object.assign(process.env, {
    DATABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    CRON_SECRET: "x".repeat(16),
    NIK_HASH_SECRET: "y".repeat(16),
    PAYMENT_PROVIDER: "mock",
  });

  const { getDb } = await import("@/db");
  const schema = await import("@/db/schema");
  const posts = await import("./posts");
  const claims = await import("./claims");
  const withdrawals = await import("./withdrawals");
  const { userBalance, escrowBalance } = await import("./ledger");
  const { RuleError } = await import("@/domain/rules");

  const db = getDb();
  const photo = [new File(["x"], "a.jpg", { type: "image/jpeg" })];

  async function makeUser(role: "user" | "admin" = "user") {
    const id = randomUUID();
    await db.execute(sql`insert into auth.users (id, email) values (${id}, ${`${id}@test.dev`})`);
    const [p] = await db
      .update(schema.profiles)
      .set({ kycStatus: "verified", role })
      .where(eq(schema.profiles.id, id))
      .returning();
    return p;
  }

  async function paidPost(poster: Awaited<ReturnType<typeof makeUser>>, reward = 1_000_000) {
    const checkoutUrl = await posts.createPost(
      poster,
      undefined,
      {
        category: "animal",
        title: "Kucing oren hilang",
        description: "Kucing oren jantan, kalung merah, sangat jinak.",
        lastSeenLocation: "Tebet",
        reward,
      },
      photo,
    );
    const paymentId = new URL(checkoutUrl).searchParams.get("externalId")!.replace("pay_", "");
    await posts.markPaymentPaid(paymentId, reward + Math.ceil(reward * 0.05));
    await posts.markPaymentPaid(paymentId, reward + Math.ceil(reward * 0.05)); // duplicate webhook
    const [post] = await db.select().from(schema.posts).where(eq(schema.posts.posterId, poster.id));
    return { post, paymentId };
  }

  const claimInput = (postId: string) => ({
    postId,
    message: "Saya melihatnya di dekat pasar pagi tadi, ada di kardus.",
    foundLocation: "Pasar Tebet",
  });

  let poster: Awaited<ReturnType<typeof makeUser>>;
  let hunter: typeof poster;
  let admin: typeof poster;

  beforeAll(async () => {
    poster = await makeUser();
    hunter = await makeUser();
    admin = await makeUser("admin");
  });

  it("escrows the reward on payment, idempotently", async () => {
    const { post } = await paidPost(poster);
    expect(post.status).toBe("active");
    expect(await escrowBalance(db, post.id)).toBe(1_000_000);
  });

  it("blocks cancel while a claim is open, then pays the hunter after a dispute", async () => {
    const [post] = await db.select().from(schema.posts).where(eq(schema.posts.posterId, poster.id));
    const claimId = await claims.submitClaim(hunter, claimInput(post.id), photo);

    await expect(posts.cancelPost(poster, post.id)).rejects.toBeInstanceOf(RuleError);
    await expect(claims.submitClaim(poster, claimInput(post.id), photo)).rejects.toBeInstanceOf(RuleError);

    await claims.rejectClaim(poster, claimId, "Itu bukan kucing saya.");
    // Still blocked: the hunter can dispute the rejection.
    await expect(posts.cancelPost(poster, post.id)).rejects.toBeInstanceOf(RuleError);

    await claims.openDispute(hunter, { claimId, reason: "Fotonya jelas kucing yang sama." });
    const [dispute] = await db.select().from(schema.disputes).where(eq(schema.disputes.claimId, claimId));
    await claims.resolveDispute(admin, { disputeId: dispute.id, outcome: "hunter_wins", note: "Cocok." });

    expect(await userBalance(db, hunter.id)).toBe(1_000_000);
    expect(await escrowBalance(db, post.id)).toBe(0);
    const [after] = await db.select().from(schema.posts).where(eq(schema.posts.id, post.id));
    expect(after.status).toBe("fulfilled");
  });

  it("charges the withdrawal fee and refuses to overspend under concurrency", async () => {
    const input = { amount: 1_000_000, bankCode: "BCA", accountNumber: "1234567890", accountHolderName: "Hunter" };
    const results = await Promise.allSettled([
      withdrawals.requestWithdrawal(hunter, input),
      withdrawals.requestWithdrawal(hunter, input),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await userBalance(db, hunter.id)).toBe(0);
    const [w] = await db.select().from(schema.withdrawals).where(eq(schema.withdrawals.userId, hunter.id));
    expect(w).toMatchObject({ status: "completed", fee: 25_000, net: 975_000 });
  });

  it("refunds 80% of the reward on cancel", async () => {
    const other = await makeUser();
    const { post } = await paidPost(other, 500_000);
    const split = await posts.cancelPost(other, post.id);
    expect(split).toEqual({ fee: 100_000, refund: 400_000 });
    expect(await userBalance(db, other.id)).toBe(400_000);
  });

  it("escalates claims the poster ignores, and expires posts with no open claims", async () => {
    const other = await makeUser();
    const { post } = await paidPost(other);
    const claimId = await claims.submitClaim(hunter, claimInput(post.id), photo);

    const later = new Date(Date.now() + 365 * 86_400_000);
    expect((await claims.sweepClaims(later)).escalated).toBeGreaterThanOrEqual(1);
    const [c] = await db.select().from(schema.claims).where(eq(schema.claims.id, claimId));
    expect(c.status).toBe("disputed");

    // Open dispute holds the post open past its expiry.
    await posts.expireDuePosts(later);
    let [p] = await db.select().from(schema.posts).where(eq(schema.posts.id, post.id));
    expect(p.status).toBe("active");

    const [d] = await db.select().from(schema.disputes).where(eq(schema.disputes.claimId, claimId));
    await claims.resolveDispute(admin, { disputeId: d.id, outcome: "poster_wins", note: "Bukti kurang." });
    await posts.expireDuePosts(later);
    [p] = await db.select().from(schema.posts).where(eq(schema.posts.id, post.id));
    expect(p.status).toBe("expired");
  });

  it("keeps every journal balanced", async () => {
    const rows = await db.execute<{ journal_id: string }>(
      sql`select journal_id from ledger_entries group by journal_id having sum(amount) <> 0`,
    );
    expect(rows.length).toBe(0);
    await expect(db.execute(sql`delete from ledger_entries`)).rejects.toThrow();
  });
});
