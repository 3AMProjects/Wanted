import "server-only";
import { and, eq, inArray, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb, type Tx } from "@/db";
import { claims, payments, postMedia, posts, type Profile } from "@/db/schema";
import { cancellationSplit, postingCharge } from "@/domain/fees";
import { addDays, assertCanCancel, OPEN_CLAIM_STATUSES, RuleError } from "@/domain/rules";
import { createPostSchema } from "@/domain/validation";
import { env } from "@/lib/env";
import { paymentExternalId, paymentProvider } from "@/server/payments";
import { feeConfig } from "./config";
import { postJournal } from "./ledger";
import { BUCKETS, uploadFiles } from "./storage";

/** Creates the post in pending_payment and returns the checkout URL for reward + fee. */
export async function createPost(
  user: Profile,
  email: string | undefined,
  input: z.infer<typeof createPostSchema>,
  photos: File[],
) {
  if (user.kycStatus !== "verified") throw new RuleError("Selesaikan KYC dulu.");
  if (input.reward < env().MIN_REWARD) {
    throw new RuleError(`Hadiah minimal Rp${env().MIN_REWARD.toLocaleString("id-ID")}.`);
  }
  if (photos.length === 0) throw new RuleError("Tambahkan minimal satu foto.");

  const charge = postingCharge(input.reward, feeConfig());
  const postId = randomUUID();
  const paths = await uploadFiles(BUCKETS.postMedia, postId, photos, { max: 6 });
  const provider = paymentProvider();
  const db = getDb();

  const paymentId = await db.transaction(async (tx) => {
    await tx.insert(posts).values({
      id: postId,
      posterId: user.id,
      ...input,
      reward: charge.reward,
      postingFee: charge.fee,
    });
    await tx
      .insert(postMedia)
      .values(paths.map((path, sortOrder) => ({ postId, path, sortOrder })));
    const [payment] = await tx
      .insert(payments)
      .values({ postId, payerId: user.id, provider: provider.name, amount: charge.total })
      .returning({ id: payments.id });
    return payment.id;
  });

  return startCheckout(paymentId, charge.total, input.title, email);
}

export async function retryPayment(user: Profile, postId: string, email: string | undefined) {
  const db = getDb();
  const [post] = await db.select().from(posts).where(eq(posts.id, postId));
  if (!post || post.posterId !== user.id) throw new RuleError("Bukan postingan kamu.");
  if (post.status !== "pending_payment") throw new RuleError("Postingan ini sudah dibayar.");
  const [payment] = await db
    .insert(payments)
    .values({
      postId,
      payerId: user.id,
      provider: paymentProvider().name,
      amount: post.reward + post.postingFee,
    })
    .returning({ id: payments.id, amount: payments.amount });
  return startCheckout(payment.id, payment.amount, post.title, email);
}

/** Creates (or recreates, after expiry) a gateway checkout for a payment row. */
export async function startCheckout(
  paymentId: string,
  amount: number,
  title: string,
  email: string | undefined,
) {
  const [payment] = await getDb().select().from(payments).where(eq(payments.id, paymentId));
  const appUrl = env().APP_URL;
  const checkout = await paymentProvider().createCheckout({
    externalId: paymentExternalId(paymentId),
    amount,
    description: `Wanted: ${title}`,
    payerEmail: email,
    successUrl: `${appUrl}/posts/${payment.postId}?paid=1`,
    failureUrl: `${appUrl}/posts/${payment.postId}`,
  });
  await getDb()
    .update(payments)
    .set({ providerRef: checkout.providerRef, checkoutUrl: checkout.checkoutUrl })
    .where(eq(payments.id, paymentId));
  return checkout.checkoutUrl;
}

/** Idempotent: a repeated "paid" webhook is a no-op. */
export async function markPaymentPaid(paymentId: string, paidAmount: number) {
  await getDb().transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for("update");
    if (!payment || payment.status === "paid") return;
    if (paidAmount !== payment.amount) {
      throw new Error(`Paid amount ${paidAmount} != expected ${payment.amount} for ${paymentId}`);
    }

    const [post] = await tx.select().from(posts).where(eq(posts.id, payment.postId)).for("update");
    const now = new Date();
    await tx.update(payments).set({ status: "paid", paidAt: now }).where(eq(payments.id, paymentId));

    await postJournal(tx, "Posting paid", [
      { account: "external", amount: -payment.amount },
      { account: "escrow", postId: post.id, amount: post.reward },
      { account: "platform", postId: post.id, amount: post.postingFee },
    ]);

    if (post.status === "pending_payment") {
      await tx
        .update(posts)
        .set({ status: "active", expiresAt: addDays(now, env().POST_DURATION_DAYS) })
        .where(eq(posts.id, post.id));
    } else {
      // Paid after the post was abandoned: keep the money as balance so it is never lost.
      await postJournal(tx, "Late payment returned to balance", [
        { account: "escrow", postId: post.id, amount: -post.reward },
        { account: "platform", postId: post.id, amount: -post.postingFee },
        { account: "user", userId: post.posterId, amount: payment.amount },
      ]);
    }
  });
}

export async function markPaymentExpired(paymentId: string) {
  await getDb().transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for("update");
    if (!payment || payment.status !== "pending") return;
    await tx.update(payments).set({ status: "expired" }).where(eq(payments.id, paymentId));
  });
}

/** Releases escrow back to the poster's balance, minus the cancel fee. */
async function closeWithRefund(tx: Tx, postId: string, status: "cancelled" | "expired") {
  const [post] = await tx.select().from(posts).where(eq(posts.id, postId)).for("update");
  const open = await tx
    .select({ status: claims.status })
    .from(claims)
    .where(eq(claims.postId, postId));
  assertCanCancel(post, open);

  const split = cancellationSplit(post.reward, feeConfig());
  await postJournal(tx, status === "cancelled" ? "Post cancelled" : "Post expired", [
    { account: "escrow", postId, amount: -post.reward },
    { account: "platform", postId, amount: split.fee },
    { account: "user", userId: post.posterId, postId, amount: split.refund },
  ]);
  await tx.update(posts).set({ status, closedAt: new Date() }).where(eq(posts.id, postId));
  return split;
}

export async function cancelPost(user: Profile, postId: string) {
  return getDb().transaction(async (tx) => {
    const [post] = await tx.select().from(posts).where(eq(posts.id, postId));
    if (!post || post.posterId !== user.id) throw new RuleError("Bukan postingan kamu.");
    if (post.status === "pending_payment") {
      // Nothing was paid yet, so there is nothing to refund or charge.
      await tx.update(posts).set({ status: "cancelled", closedAt: new Date() }).where(eq(posts.id, postId));
      return { fee: 0, refund: 0 };
    }
    return closeWithRefund(tx, postId, "cancelled");
  });
}

/** Expires active posts past their deadline that have no open claims. */
export async function expireDuePosts(now = new Date()) {
  const db = getDb();
  const due = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.status, "active"), lte(posts.expiresAt, now)));

  let expired = 0;
  for (const { id } of due) {
    const hasOpen = await db
      .select({ id: claims.id })
      .from(claims)
      .where(and(eq(claims.postId, id), inArray(claims.status, [...OPEN_CLAIM_STATUSES])))
      .limit(1);
    if (hasOpen.length > 0) continue; // wait until the claim is settled
    await db.transaction((tx) => closeWithRefund(tx, id, "expired"));
    expired++;
  }
  return expired;
}
