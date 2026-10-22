import "server-only";
import { createHmac } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { kycSubmissions, profiles, type Profile } from "@/db/schema";
import { RuleError } from "@/domain/rules";
import { kycSchema, maskNik, reviewKycSchema } from "@/domain/validation";
import { env } from "@/lib/env";
import { BUCKETS, uploadFiles } from "./storage";

const hashNik = (nik: string) => createHmac("sha256", env().NIK_HASH_SECRET).update(nik).digest("hex");

/**
 * Manual KYC: the user uploads a KTP photo and a selfie holding it, and an admin
 * reviews them. Swap for an e-KYC vendor (e.g. Dukcapil-backed) later without
 * changing callers.
 */
export async function submitKyc(
  user: Profile,
  input: z.infer<typeof kycSchema>,
  ktp: File | undefined,
  selfie: File | undefined,
) {
  if (user.kycStatus === "verified") throw new RuleError("KYC kamu sudah terverifikasi.");
  if (user.kycStatus === "pending") throw new RuleError("KYC kamu sedang ditinjau.");
  if (!ktp || !selfie) throw new RuleError("Foto KTP dan selfie wajib diunggah.");

  const nikHash = hashNik(input.nik);
  const taken = await getDb()
    .select({ id: kycSubmissions.id })
    .from(kycSubmissions)
    .where(
      and(
        eq(kycSubmissions.nikHash, nikHash),
        eq(kycSubmissions.status, "verified"),
        ne(kycSubmissions.userId, user.id),
      ),
    )
    .limit(1);
  if (taken.length > 0) throw new RuleError("NIK ini sudah terdaftar di akun lain.");

  const [ktpPath] = await uploadFiles(BUCKETS.kyc, `${user.id}/ktp`, [ktp], { max: 1 });
  const [selfiePath] = await uploadFiles(BUCKETS.kyc, `${user.id}/selfie`, [selfie], { max: 1 });

  await getDb().transaction(async (tx) => {
    await tx.insert(kycSubmissions).values({
      userId: user.id,
      fullName: input.fullName,
      nikMasked: maskNik(input.nik),
      nikHash,
      ktpPath,
      selfiePath,
    });
    await tx.update(profiles).set({ kycStatus: "pending" }).where(eq(profiles.id, user.id));
  });
}

export async function reviewKyc(admin: Profile, input: z.infer<typeof reviewKycSchema>) {
  if (admin.role !== "admin") throw new RuleError("Khusus admin.");
  await getDb().transaction(async (tx) => {
    const [sub] = await tx
      .update(kycSubmissions)
      .set({
        status: input.decision,
        reviewNote: input.note,
        reviewedBy: admin.id,
        reviewedAt: new Date(),
      })
      .where(and(eq(kycSubmissions.id, input.submissionId), eq(kycSubmissions.status, "pending")))
      .returning();
    if (!sub) throw new RuleError("Pengajuan sudah ditinjau.");
    await tx
      .update(profiles)
      .set({ kycStatus: input.decision })
      .where(eq(profiles.id, sub.userId));
  });
}
