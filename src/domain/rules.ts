import type { Claim, Post } from "@/db/schema";

export class RuleError extends Error {}

/** Claims that still hold the post open: the poster cannot cancel and it cannot expire. */
export const OPEN_CLAIM_STATUSES = ["pending", "rejected", "disputed"] as const;

export function isOpenClaim(c: Pick<Claim, "status">) {
  return (OPEN_CLAIM_STATUSES as readonly string[]).includes(c.status);
}

export function assertCanCancel(
  post: Pick<Post, "status">,
  claims: Pick<Claim, "status">[],
) {
  if (post.status !== "active") throw new RuleError("Postingan tidak aktif.");
  if (claims.some(isOpenClaim)) {
    throw new RuleError(
      "Tidak bisa cancel selama masih ada klaim yang belum selesai.",
    );
  }
}

export function assertCanClaim(
  post: Pick<Post, "status" | "posterId" | "expiresAt">,
  hunterId: string,
  now: Date,
) {
  if (post.status !== "active") throw new RuleError("Postingan tidak aktif.");
  if (post.expiresAt && post.expiresAt <= now) {
    throw new RuleError("Postingan sudah kedaluwarsa.");
  }
  if (post.posterId === hunterId) {
    throw new RuleError("Tidak bisa mengklaim postingan sendiri.");
  }
}

export function assertCanReview(
  post: Pick<Post, "status" | "posterId">,
  claim: Pick<Claim, "status" | "postId">,
  userId: string,
) {
  if (post.posterId !== userId) throw new RuleError("Bukan postingan kamu.");
  if (post.status !== "active") throw new RuleError("Postingan tidak aktif.");
  if (claim.status !== "pending") throw new RuleError("Klaim sudah diproses.");
}

export function assertCanDispute(
  claim: Pick<Claim, "status" | "hunterId" | "disputeDeadline">,
  userId: string,
  now: Date,
) {
  if (claim.hunterId !== userId) throw new RuleError("Bukan klaim kamu.");
  if (claim.status !== "rejected") {
    throw new RuleError("Hanya klaim yang ditolak yang bisa disengketakan.");
  }
  if (!claim.disputeDeadline || claim.disputeDeadline <= now) {
    throw new RuleError("Batas waktu sengketa sudah lewat.");
  }
}

export function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 86_400_000);
}
