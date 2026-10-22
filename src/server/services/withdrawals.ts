import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { profiles, withdrawals, type Profile } from "@/db/schema";
import { withdrawalSplit } from "@/domain/fees";
import { RuleError } from "@/domain/rules";
import { withdrawalSchema } from "@/domain/validation";
import { env } from "@/lib/env";
import { paymentProvider, withdrawalExternalId } from "@/server/payments";
import { feeConfig } from "./config";
import { postJournal, userBalance } from "./ledger";

export async function requestWithdrawal(user: Profile, input: z.infer<typeof withdrawalSchema>) {
  if (user.kycStatus !== "verified") throw new RuleError("Selesaikan KYC dulu.");
  if (input.amount < env().MIN_WITHDRAWAL) {
    throw new RuleError(`Penarikan minimal Rp${env().MIN_WITHDRAWAL.toLocaleString("id-ID")}.`);
  }
  const split = withdrawalSplit(input.amount, feeConfig());
  const provider = paymentProvider();

  const withdrawal = await getDb().transaction(async (tx) => {
    // Serialise withdrawals per user so two requests can't spend the same balance.
    await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, user.id)).for("update");
    const balance = await userBalance(tx, user.id);
    if (balance < input.amount) throw new RuleError("Saldo tidak cukup.");

    const [w] = await tx
      .insert(withdrawals)
      .values({ userId: user.id, ...input, fee: split.fee, net: split.net, provider: provider.name })
      .returning();
    await postJournal(tx, "Withdrawal requested", [
      { account: "user", userId: user.id, amount: -input.amount },
      { account: "platform", amount: split.fee },
      { account: "payout_pending", userId: user.id, amount: split.net },
    ]);
    return w;
  });

  try {
    const { providerRef } = await provider.createPayout({
      externalId: withdrawalExternalId(withdrawal.id),
      amount: split.net,
      bankCode: input.bankCode,
      accountNumber: input.accountNumber,
      accountHolderName: input.accountHolderName,
      description: "Pencairan hadiah Wanted",
    });
    await getDb()
      .update(withdrawals)
      .set({ status: "processing", providerRef })
      .where(eq(withdrawals.id, withdrawal.id));
    if (provider.name === "mock") await markPayoutCompleted(withdrawal.id);
  } catch (err) {
    await markPayoutFailed(withdrawal.id, err instanceof Error ? err.message : String(err));
    throw new RuleError("Pencairan gagal diproses. Saldo sudah dikembalikan.");
  }
  return withdrawal.id;
}

export async function markPayoutCompleted(withdrawalId: string) {
  await getDb().transaction(async (tx) => {
    const [w] = await tx.select().from(withdrawals).where(eq(withdrawals.id, withdrawalId)).for("update");
    if (!w || w.status === "completed" || w.status === "failed") return;
    await postJournal(tx, "Withdrawal completed", [
      { account: "payout_pending", userId: w.userId, amount: -w.net },
      { account: "external", amount: w.net },
    ]);
    await tx
      .update(withdrawals)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(withdrawals.id, w.id));
  });
}

/** Reverses the withdrawal journal, fee included, so the user gets their full balance back. */
export async function markPayoutFailed(withdrawalId: string, reason: string) {
  await getDb().transaction(async (tx) => {
    const [w] = await tx.select().from(withdrawals).where(eq(withdrawals.id, withdrawalId)).for("update");
    if (!w || w.status === "completed" || w.status === "failed") return;
    await postJournal(tx, "Withdrawal failed", [
      { account: "payout_pending", userId: w.userId, amount: -w.net },
      { account: "platform", amount: -w.fee },
      { account: "user", userId: w.userId, amount: w.amount },
    ]);
    await tx
      .update(withdrawals)
      .set({ status: "failed", failureReason: reason })
      .where(eq(withdrawals.id, w.id));
  });
}
