"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formAction } from "@/lib/action";
import { requireAdmin, requireUser, requireVerifiedUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import {
  createPostSchema,
  disputeSchema,
  kycSchema,
  rejectClaimSchema,
  resolveDisputeSchema,
  reviewKycSchema,
  submitClaimSchema,
  withdrawalSchema,
} from "@/domain/validation";
import { realFiles } from "@/server/services/storage";
import { cancelPost, createPost, retryPayment } from "@/server/services/posts";
import {
  acceptClaim,
  openDispute,
  rejectClaim,
  resolveDispute,
  submitClaim,
} from "@/server/services/claims";
import { reviewKyc, submitKyc } from "@/server/services/kyc";
import { requestWithdrawal } from "@/server/services/withdrawals";

const fields = (form: FormData) => Object.fromEntries(form.entries());

export const createPostAction = formAction(async (form) => {
  const user = await requireVerifiedUser();
  const input = createPostSchema.parse(fields(form));
  const { data } = await (await supabaseServer()).auth.getUser();
  const checkoutUrl = await createPost(user, data.user?.email, input, realFiles(form.getAll("photos")));
  redirect(checkoutUrl);
});

/** Lets the poster retry payment for a post still in pending_payment. */
export const payPostAction = formAction(async (form) => {
  const user = await requireUser();
  const { data } = await (await supabaseServer()).auth.getUser();
  redirect(await retryPayment(user, String(form.get("postId")), data.user?.email));
});

export const cancelPostAction = formAction(async (form) => {
  const user = await requireUser();
  const postId = String(form.get("postId"));
  const { refund } = await cancelPost(user, postId);
  revalidatePath(`/posts/${postId}`);
  return refund > 0 ? `Dibatalkan. Rp${refund.toLocaleString("id-ID")} masuk ke saldo kamu.` : "Dibatalkan.";
});

export const submitClaimAction = formAction(async (form) => {
  const user = await requireVerifiedUser();
  const input = submitClaimSchema.parse(fields(form));
  await submitClaim(user, input, realFiles(form.getAll("proofs")));
  revalidatePath(`/posts/${input.postId}`);
  return "Klaim terkirim. Pemosting akan meninjaunya.";
});

export const acceptClaimAction = formAction(async (form) => {
  const user = await requireUser();
  await acceptClaim(user, String(form.get("claimId")));
  revalidatePath(`/posts/${form.get("postId")}`);
  return "Klaim diterima. Hadiah sudah diteruskan ke pemburu.";
});

export const rejectClaimAction = formAction(async (form) => {
  const user = await requireUser();
  const input = rejectClaimSchema.parse(fields(form));
  await rejectClaim(user, input.claimId, input.reason);
  revalidatePath(`/posts/${form.get("postId")}`);
  return "Klaim ditolak.";
});

export const disputeAction = formAction(async (form) => {
  const user = await requireUser();
  await openDispute(user, disputeSchema.parse(fields(form)));
  revalidatePath("/me");
  return "Sengketa diajukan. Admin akan meninjau.";
});

export const resolveDisputeAction = formAction(async (form) => {
  const admin = await requireAdmin();
  await resolveDispute(admin, resolveDisputeSchema.parse(fields(form)));
  revalidatePath("/admin");
  return "Sengketa diselesaikan.";
});

export const submitKycAction = formAction(async (form) => {
  const user = await requireUser();
  const input = kycSchema.parse(fields(form));
  const [ktp] = realFiles(form.getAll("ktp"));
  const [selfie] = realFiles(form.getAll("selfie"));
  await submitKyc(user, input, ktp, selfie);
  revalidatePath("/kyc");
  return "KYC terkirim, sedang ditinjau.";
});

export const reviewKycAction = formAction(async (form) => {
  const admin = await requireAdmin();
  await reviewKyc(admin, reviewKycSchema.parse(fields(form)));
  revalidatePath("/admin");
  return "Tersimpan.";
});

export const withdrawAction = formAction(async (form) => {
  const user = await requireVerifiedUser();
  await requestWithdrawal(user, withdrawalSchema.parse(fields(form)));
  revalidatePath("/me");
  return "Pencairan diproses.";
});

export async function signOutAction() {
  await (await supabaseServer()).auth.signOut();
  redirect("/");
}
