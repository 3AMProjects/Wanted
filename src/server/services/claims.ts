import "server-only";
import { and, eq, inArray, lte, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb, type Tx } from "@/db";
import { claimMedia, claims, disputes, posts, type Profile } from "@/db/schema";
import {
  addDays,
  assertCanClaim,
  assertCanDispute,
  assertCanReview,
  OPEN_CLAIM_STATUSES,
  RuleError,
} from "@/domain/rules";
import { disputeSchema, resolveDisputeSchema, submitClaimSchema } from "@/domain/validation";
import { env } from "@/lib/env";
import { postJournal } from "./ledger";
import { BUCKETS, uploadFiles } from "./storage";

export async function submitClaim(
  user: Profile,
  input: z.infer<typeof submitClaimSchema>,
  proofs: File[],
) {
  if (user.kycStatus !== "verified") throw new RuleError("Selesaikan KYC dulu.");
  if (proofs.length === 0) throw new RuleError("Bukti foto/video wajib dilampirkan.");

  const db = getDb();
  const [post] = await db.select().from(posts).where(eq(posts.id, input.postId));
  if (!post) throw new RuleError("Postingan tidak ditemukan.");
  assertCanClaim(post, user.id, new Date());

  const claimId = randomUUID();
  const paths = await uploadFiles(BUCKETS.proofs, `${post.id}/${claimId}`, proofs, {
    max: 6,
    allowVideo: true,
  });

  await db.transaction(async (tx) => {
    // Lock the post so a concurrent cancel can't slip past this claim.
    const [locked] = await tx.select().from(posts).where(eq(posts.id, post.id)).for("update");
    const now = new Date();
    assertCanClaim(locked, user.id, now);
    await tx.insert(claims).values({
      id: claimId,
      postId: post.id,
      hunterId: user.id,
      message: input.message,
      foundLocation: input.foundLocation,
      foundLat: input.foundLat,
      foundLng: input.foundLng,
      reviewDeadline: addDays(now, env().CLAIM_REVIEW_DAYS),
    });
    await tx.insert(claimMedia).values(paths.map((path) => ({ claimId, path })));
  });
  return claimId;
}

/** Moves the escrowed reward to the claim's hunter and closes the post. */
async function settleToHunter(tx: Tx, claimId: string, memo: string) {
  const [claim] = await tx.select().from(claims).where(eq(claims.id, claimId));
  const [post] = await tx.select().from(posts).where(eq(posts.id, claim.postId)).for("update");
  if (post.status !== "active") throw new RuleError("Postingan tidak aktif.");
  const now = new Date();

  await postJournal(tx, memo, [
    { account: "escrow", postId: post.id, amount: -post.reward },
    { account: "user", userId: claim.hunterId, postId: post.id, amount: post.reward },
  ]);
  await tx.update(claims).set({ status: "accepted", decidedAt: now }).where(eq(claims.id, claimId));
  await tx.update(posts).set({ status: "fulfilled", closedAt: now }).where(eq(posts.id, post.id));

  // Any other open claims on this post are now moot.
  const others = await tx
    .update(claims)
    .set({ status: "closed", decidedAt: now })
    .where(
      and(
        eq(claims.postId, post.id),
        ne(claims.id, claimId),
        inArray(claims.status, [...OPEN_CLAIM_STATUSES]),
      ),
    )
    .returning({ id: claims.id });
  if (others.length > 0) {
    await tx
      .update(disputes)
      .set({
        status: "resolved",
        outcome: "poster_wins",
        resolutionNote: "Postingan sudah diselesaikan lewat klaim lain.",
        resolvedAt: now,
      })
      .where(and(inArray(disputes.claimId, others.map((o) => o.id)), eq(disputes.status, "open")));
  }
}

async function loadForReview(tx: Tx, user: Profile, claimId: string) {
  const [claim] = await tx.select().from(claims).where(eq(claims.id, claimId)).for("update");
  if (!claim) throw new RuleError("Klaim tidak ditemukan.");
  const [post] = await tx.select().from(posts).where(eq(posts.id, claim.postId));
  assertCanReview(post, claim, user.id);
  return { claim, post };
}

export async function acceptClaim(user: Profile, claimId: string) {
  await getDb().transaction(async (tx) => {
    await loadForReview(tx, user, claimId);
    await settleToHunter(tx, claimId, "Claim accepted by poster");
  });
}

export async function rejectClaim(user: Profile, claimId: string, reason: string) {
  await getDb().transaction(async (tx) => {
    await loadForReview(tx, user, claimId);
    const now = new Date();
    await tx
      .update(claims)
      .set({
        status: "rejected",
        rejectReason: reason,
        decidedAt: now,
        disputeDeadline: addDays(now, env().DISPUTE_WINDOW_DAYS),
      })
      .where(eq(claims.id, claimId));
  });
}

export async function openDispute(user: Profile, input: z.infer<typeof disputeSchema>) {
  await getDb().transaction(async (tx) => {
    const [claim] = await tx.select().from(claims).where(eq(claims.id, input.claimId)).for("update");
    if (!claim) throw new RuleError("Klaim tidak ditemukan.");
    assertCanDispute(claim, user.id, new Date());
    await tx.update(claims).set({ status: "disputed" }).where(eq(claims.id, claim.id));
    await tx.insert(disputes).values({ claimId: claim.id, openedBy: user.id, reason: input.reason });
  });
}

export async function resolveDispute(admin: Profile, input: z.infer<typeof resolveDisputeSchema>) {
  if (admin.role !== "admin") throw new RuleError("Khusus admin.");
  await getDb().transaction(async (tx) => {
    const [dispute] = await tx
      .select()
      .from(disputes)
      .where(eq(disputes.id, input.disputeId))
      .for("update");
    if (!dispute || dispute.status !== "open") throw new RuleError("Sengketa sudah selesai.");

    if (input.outcome === "hunter_wins") {
      await settleToHunter(tx, dispute.claimId, "Dispute resolved for hunter");
    } else {
      await tx
        .update(claims)
        .set({ status: "dismissed", decidedAt: new Date() })
        .where(eq(claims.id, dispute.claimId));
    }
    await tx
      .update(disputes)
      .set({
        status: "resolved",
        outcome: input.outcome,
        resolutionNote: input.note,
        resolvedBy: admin.id,
        resolvedAt: new Date(),
      })
      .where(eq(disputes.id, dispute.id));
  });
}

/**
 * Periodic housekeeping:
 * - pending claims the poster ignored past the review deadline go to admin;
 * - rejected claims the hunter didn't dispute in time become final.
 */
export async function sweepClaims(now = new Date()) {
  const db = getDb();
  const escalated = await db.transaction(async (tx) => {
    const overdue = await tx
      .update(claims)
      .set({ status: "disputed" })
      .where(and(eq(claims.status, "pending"), lte(claims.reviewDeadline, now)))
      .returning({ id: claims.id });
    if (overdue.length > 0) {
      await tx.insert(disputes).values(
        overdue.map((c) => ({
          claimId: c.id,
          reason: "Pemosting tidak meninjau klaim sebelum batas waktu.",
        })),
      );
    }
    return overdue.length;
  });

  const finalised = await db
    .update(claims)
    .set({ status: "dismissed" })
    .where(and(eq(claims.status, "rejected"), lte(claims.disputeDeadline, now)))
    .returning({ id: claims.id });

  return { escalated, finalised: finalised.length };
}
