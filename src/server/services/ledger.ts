import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { ledgerEntries } from "@/db/schema";

type Entry = {
  account: (typeof ledgerEntries.$inferInsert)["account"];
  amount: number;
  userId?: string;
  postId?: string;
};

/** Writes one balanced journal. Throws if the entries don't sum to zero. */
export async function postJournal(tx: Tx, memo: string, entries: Entry[]) {
  const sum = entries.reduce((s, e) => s + e.amount, 0);
  if (sum !== 0) throw new Error(`Unbalanced journal "${memo}": ${sum}`);
  const journalId = randomUUID();
  await tx.insert(ledgerEntries).values(
    entries
      .filter((e) => e.amount !== 0)
      .map((e) => ({ ...e, journalId, memo })),
  );
  return journalId;
}

export async function userBalance(tx: Pick<Tx, "select">, userId: string) {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.account, "user"), eq(ledgerEntries.userId, userId)));
  return Number(row.total);
}

export async function escrowBalance(tx: Pick<Tx, "select">, postId: string) {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.account, "escrow"), eq(ledgerEntries.postId, postId)));
  return Number(row.total);
}
