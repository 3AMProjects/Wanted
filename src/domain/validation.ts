import { z } from "zod";

const optionalNumber = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.coerce.number().optional(),
);
const optionalDate = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.coerce.date().optional(),
);

export const createPostSchema = z.object({
  category: z.enum(["animal", "vehicle"]),
  title: z.string().trim().min(5).max(120),
  description: z.string().trim().min(20).max(5000),
  lastSeenLocation: z.string().trim().min(3).max(300),
  lastSeenLat: optionalNumber.pipe(z.number().min(-90).max(90).optional()),
  lastSeenLng: optionalNumber.pipe(z.number().min(-180).max(180).optional()),
  lastSeenAt: optionalDate,
  reward: z.coerce.number().int().positive(),
});

export const submitClaimSchema = z.object({
  postId: z.uuid(),
  message: z.string().trim().min(20).max(5000),
  foundLocation: z.string().trim().min(3).max(300),
  foundLat: optionalNumber.pipe(z.number().min(-90).max(90).optional()),
  foundLng: optionalNumber.pipe(z.number().min(-180).max(180).optional()),
});

export const rejectClaimSchema = z.object({
  claimId: z.uuid(),
  reason: z.string().trim().min(10).max(2000),
});

export const disputeSchema = z.object({
  claimId: z.uuid(),
  reason: z.string().trim().min(10).max(2000),
});

export const resolveDisputeSchema = z.object({
  disputeId: z.uuid(),
  outcome: z.enum(["hunter_wins", "poster_wins"]),
  note: z.string().trim().min(5).max(2000),
});

export const kycSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  nik: z.string().regex(/^\d{16}$/, "NIK harus 16 digit"),
});

export const reviewKycSchema = z.object({
  submissionId: z.uuid(),
  decision: z.enum(["verified", "rejected"]),
  note: z.string().trim().max(500).optional(),
});

export const withdrawalSchema = z.object({
  amount: z.coerce.number().int().positive(),
  bankCode: z.string().trim().min(2).max(20),
  accountNumber: z.string().regex(/^\d{5,20}$/),
  accountHolderName: z.string().trim().min(3).max(120),
});

export function maskNik(nik: string) {
  return `${nik.slice(0, 4)}********${nik.slice(-4)}`;
}
