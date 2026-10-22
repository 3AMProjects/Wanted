import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { disputeAction, withdrawAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { getDb } from "@/db";
import { claims, posts, withdrawals } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { CLAIM_STATUS_LABEL, dateTime, POST_STATUS_LABEL, rupiah } from "@/lib/format";
import { userBalance } from "@/server/services/ledger";

export const dynamic = "force-dynamic";

const KYC_LABEL = {
  none: "Belum diajukan",
  pending: "Sedang ditinjau",
  verified: "Terverifikasi",
  rejected: "Ditolak, silakan ajukan ulang",
} as const;

export default async function MePage() {
  const user = await requireUser();
  const db = getDb();
  const [balance, myPosts, myClaims, myWithdrawals] = await Promise.all([
    userBalance(db, user.id),
    db.select().from(posts).where(eq(posts.posterId, user.id)).orderBy(desc(posts.createdAt)),
    db
      .select({ claim: claims, postTitle: posts.title })
      .from(claims)
      .innerJoin(posts, eq(posts.id, claims.postId))
      .where(eq(claims.hunterId, user.id))
      .orderBy(desc(claims.createdAt)),
    db.select().from(withdrawals).where(eq(withdrawals.userId, user.id)).orderBy(desc(withdrawals.createdAt)),
  ]);
  const now = new Date();

  return (
    <div className="space-y-8">
      <section className="space-y-1">
        <p className="text-sm text-neutral-500">
          KYC: {KYC_LABEL[user.kycStatus]}
          {user.kycStatus !== "verified" && user.kycStatus !== "pending" && (
            <>
              {" · "}
              <Link href="/kyc" className="underline">
                Verifikasi sekarang
              </Link>
            </>
          )}
        </p>
        <p className="text-sm text-neutral-500">Saldo</p>
        <p className="text-3xl font-bold">{rupiah(balance)}</p>
      </section>

      {user.kycStatus === "verified" && balance > 0 && (
        <section className="max-w-md rounded-lg border bg-white p-4">
          <h2 className="mb-3 font-semibold">Cairkan saldo</h2>
          <ActionForm action={withdrawAction} submitLabel="Cairkan">
            <label>
              Jumlah (Rp)
              <input name="amount" type="number" min={env().MIN_WITHDRAWAL} max={balance} required />
            </label>
            <label>
              Kode bank (mis. BCA, BNI, MANDIRI)
              <input name="bankCode" required />
            </label>
            <label>
              Nomor rekening
              <input name="accountNumber" inputMode="numeric" required />
            </label>
            <label>
              Nama pemilik rekening
              <input name="accountHolderName" required />
            </label>
            <p className="text-xs text-neutral-500">
              Biaya pencairan {env().WITHDRAWAL_FEE_BPS / 100}% dipotong dari jumlah yang dicairkan.
            </p>
          </ActionForm>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">Postingan saya</h2>
        {myPosts.length === 0 && <p className="text-sm text-neutral-500">Belum ada.</p>}
        <ul className="space-y-1 text-sm">
          {myPosts.map((p) => (
            <li key={p.id}>
              <Link href={`/posts/${p.id}`} className="underline">
                {p.title}
              </Link>{" "}
              · {rupiah(p.reward)} · {POST_STATUS_LABEL[p.status]}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Klaim saya</h2>
        {myClaims.length === 0 && <p className="text-sm text-neutral-500">Belum ada.</p>}
        {myClaims.map(({ claim, postTitle }) => (
          <div key={claim.id} className="space-y-2 rounded border bg-white p-3 text-sm">
            <p>
              <Link href={`/posts/${claim.postId}`} className="underline">
                {postTitle}
              </Link>{" "}
              · {CLAIM_STATUS_LABEL[claim.status]}
            </p>
            {claim.rejectReason && <p>Alasan ditolak: {claim.rejectReason}</p>}
            {claim.status === "rejected" && claim.disputeDeadline && claim.disputeDeadline > now && (
              <ActionForm action={disputeAction} submitLabel="Ajukan sengketa">
                <input type="hidden" name="claimId" value={claim.id} />
                <textarea
                  name="reason"
                  required
                  minLength={10}
                  rows={2}
                  placeholder={`Kenapa penolakan ini tidak adil? (sebelum ${dateTime(claim.disputeDeadline)})`}
                />
              </ActionForm>
            )}
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Riwayat pencairan</h2>
        {myWithdrawals.length === 0 && <p className="text-sm text-neutral-500">Belum ada.</p>}
        <ul className="space-y-1 text-sm">
          {myWithdrawals.map((w) => (
            <li key={w.id}>
              {dateTime(w.createdAt)} · {rupiah(w.amount)} (diterima {rupiah(w.net)}) · {w.status}
              {w.failureReason && ` · ${w.failureReason}`}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
