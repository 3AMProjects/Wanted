import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { resolveDisputeAction, reviewKycAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { getDb } from "@/db";
import { claimMedia, claims, disputes, kycSubmissions, posts } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { dateTime, rupiah } from "@/lib/format";
import { signedUrls } from "@/server/services/storage";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdmin();
  const db = getDb();
  const [kycQueue, openDisputes] = await Promise.all([
    db.select().from(kycSubmissions).where(eq(kycSubmissions.status, "pending")).orderBy(asc(kycSubmissions.createdAt)),
    db
      .select({ dispute: disputes, claim: claims, post: posts })
      .from(disputes)
      .innerJoin(claims, eq(claims.id, disputes.claimId))
      .innerJoin(posts, eq(posts.id, claims.postId))
      .where(eq(disputes.status, "open"))
      .orderBy(asc(disputes.createdAt)),
  ]);

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h1 className="text-xl font-bold">Sengketa terbuka ({openDisputes.length})</h1>
        {openDisputes.map(({ dispute, claim, post }) => (
          <DisputeCard key={dispute.id} dispute={dispute} claim={claim} post={post} />
        ))}
      </section>

      <section className="space-y-4">
        <h1 className="text-xl font-bold">Antrean KYC ({kycQueue.length})</h1>
        {kycQueue.map((k) => (
          <KycCard key={k.id} submission={k} />
        ))}
      </section>
    </div>
  );
}

async function DisputeCard({
  dispute,
  claim,
  post,
}: {
  dispute: typeof disputes.$inferSelect;
  claim: typeof claims.$inferSelect;
  post: typeof posts.$inferSelect;
}) {
  const media = await getDb().select().from(claimMedia).where(eq(claimMedia.claimId, claim.id));
  const urls = await signedUrls("proofs", media.map((m) => m.path));
  return (
    <div className="space-y-2 rounded-lg border bg-white p-4 text-sm">
      <p>
        <Link href={`/posts/${post.id}`} className="font-semibold underline">
          {post.title}
        </Link>{" "}
        · {rupiah(post.reward)} · dibuka {dateTime(dispute.createdAt)}
      </p>
      <p>
        <b>Alasan sengketa:</b> {dispute.reason}
      </p>
      {claim.rejectReason && (
        <p>
          <b>Alasan pemosting menolak:</b> {claim.rejectReason}
        </p>
      )}
      <p className="whitespace-pre-wrap">
        <b>Info pemburu:</b> {claim.message}
      </p>
      <p>
        <b>Lokasi:</b> {claim.foundLocation}
      </p>
      <div className="flex gap-2">
        {urls.map((u, i) => (
          <a key={i} href={u} target="_blank" rel="noreferrer" className="underline">
            Bukti {i + 1}
          </a>
        ))}
      </div>
      <ActionForm action={resolveDisputeAction} submitLabel="Putuskan">
        <input type="hidden" name="disputeId" value={dispute.id} />
        <select name="outcome" required>
          <option value="hunter_wins">Pemburu menang: bayar hadiah</option>
          <option value="poster_wins">Pemosting menang: tolak klaim</option>
        </select>
        <textarea name="note" required minLength={5} rows={2} placeholder="Catatan keputusan" />
      </ActionForm>
    </div>
  );
}

async function KycCard({ submission }: { submission: typeof kycSubmissions.$inferSelect }) {
  const [ktp, selfie] = await signedUrls("kyc", [submission.ktpPath, submission.selfiePath]);
  return (
    <div className="space-y-2 rounded-lg border bg-white p-4 text-sm">
      <p>
        <b>{submission.fullName}</b> · NIK {submission.nikMasked} · {dateTime(submission.createdAt)}
      </p>
      <div className="flex gap-3">
        <a href={ktp} target="_blank" rel="noreferrer" className="underline">
          Foto KTP
        </a>
        <a href={selfie} target="_blank" rel="noreferrer" className="underline">
          Selfie
        </a>
      </div>
      <ActionForm action={reviewKycAction} submitLabel="Simpan">
        <input type="hidden" name="submissionId" value={submission.id} />
        <select name="decision" required>
          <option value="verified">Setujui</option>
          <option value="rejected">Tolak</option>
        </select>
        <input name="note" placeholder="Catatan (opsional)" />
      </ActionForm>
    </div>
  );
}
