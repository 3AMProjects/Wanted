import { and, asc, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import {
  acceptClaimAction,
  cancelPostAction,
  payPostAction,
  rejectClaimAction,
  submitClaimAction,
} from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { getDb } from "@/db";
import { claimMedia, claims, postMedia, posts, type Claim } from "@/db/schema";
import { cancellationSplit } from "@/domain/fees";
import { currentUser } from "@/lib/auth";
import { CATEGORY_LABEL, CLAIM_STATUS_LABEL, dateTime, POST_STATUS_LABEL, rupiah } from "@/lib/format";
import { feeConfig } from "@/server/services/config";
import { publicUrl, signedUrls } from "@/server/services/storage";

export const dynamic = "force-dynamic";

export default async function PostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { id } = await params;
  const { paid } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const db = getDb();
  const [post] = await db.select().from(posts).where(eq(posts.id, id));
  if (!post) notFound();
  const user = await currentUser();
  const isPoster = user?.id === post.posterId;
  // Unpaid posts are only visible to their owner.
  if (post.status === "pending_payment" && !isPoster) notFound();

  const photos = await db
    .select()
    .from(postMedia)
    .where(eq(postMedia.postId, id))
    .orderBy(asc(postMedia.sortOrder));

  // Proof is private: the poster sees every claim, a hunter only their own.
  const visibleClaims = user
    ? await db
        .select()
        .from(claims)
        .where(isPoster ? eq(claims.postId, id) : and(eq(claims.postId, id), eq(claims.hunterId, user.id)))
        .orderBy(desc(claims.createdAt))
    : [];

  return (
    <div className="space-y-6">
      {paid && post.status === "pending_payment" && (
        <p className="rounded bg-yellow-50 p-3 text-sm">
          Pembayaran sedang dikonfirmasi. Muat ulang halaman ini sebentar lagi.
        </p>
      )}

      <section className="space-y-2">
        <p className="text-sm text-neutral-500">
          {CATEGORY_LABEL[post.category]} · {POST_STATUS_LABEL[post.status]}
          {post.expiresAt && post.status === "active" && ` · berakhir ${dateTime(post.expiresAt)}`}
        </p>
        <h1 className="text-2xl font-bold">{post.title}</h1>
        <p className="text-2xl font-bold text-green-700">{rupiah(post.reward)}</p>
        <div className="flex gap-2 overflow-x-auto">
          {photos.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={p.id} src={publicUrl(p.path)} alt="" className="h-48 rounded object-cover" />
          ))}
        </div>
        <p className="whitespace-pre-wrap">{post.description}</p>
        <p className="text-sm">
          <b>Terakhir terlihat:</b> {post.lastSeenLocation}
          {post.lastSeenAt && ` (${dateTime(post.lastSeenAt)})`}
          {post.lastSeenLat != null && post.lastSeenLng != null && (
            <>
              {" · "}
              <a
                className="underline"
                target="_blank"
                rel="noreferrer"
                href={`https://www.google.com/maps?q=${post.lastSeenLat},${post.lastSeenLng}`}
              >
                peta
              </a>
            </>
          )}
        </p>
      </section>

      {isPoster && <PosterPanel post={post} claims={visibleClaims} />}
      {!isPoster && user && post.status === "active" && (
        <ClaimForm postId={post.id} verified={user.kycStatus === "verified"} />
      )}
      {!isPoster && visibleClaims.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold">Klaim kamu</h2>
          {visibleClaims.map((c) => (
            <ClaimCard key={c.id} claim={c} />
          ))}
        </section>
      )}
      {!user && post.status === "active" && (
        <p className="text-sm">
          <a href="/login" className="underline">
            Masuk
          </a>{" "}
          untuk mengirim informasi dan mengklaim hadiah.
        </p>
      )}
    </div>
  );
}

function PosterPanel({ post, claims: list }: { post: typeof posts.$inferSelect; claims: Claim[] }) {
  const split = cancellationSplit(post.reward, feeConfig());
  return (
    <section className="space-y-4 rounded-lg border bg-white p-4">
      <h2 className="font-semibold">Kelola postingan</h2>
      {post.status === "pending_payment" && (
        <ActionForm action={payPostAction} submitLabel={`Bayar ${rupiah(post.reward + post.postingFee)}`}>
          <input type="hidden" name="postId" value={post.id} />
        </ActionForm>
      )}
      {(post.status === "active" || post.status === "pending_payment") && (
        <ActionForm action={cancelPostAction} submitLabel="Batalkan postingan" danger>
          <input type="hidden" name="postId" value={post.id} />
          {post.status === "active" && (
            <p className="text-sm text-neutral-600">
              Biaya pembatalan {rupiah(split.fee)}; {rupiah(split.refund)} kembali ke saldo kamu. Tidak bisa
              dibatalkan selama masih ada klaim yang belum selesai.
            </p>
          )}
        </ActionForm>
      )}

      <h3 className="font-semibold">Klaim masuk ({list.length})</h3>
      {list.length === 0 && <p className="text-sm text-neutral-500">Belum ada klaim.</p>}
      {list.map((c) => (
          <ClaimCard key={c.id} claim={c}>
            {c.status === "pending" && post.status === "active" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <ActionForm action={acceptClaimAction} submitLabel="Terima & bayar hadiah">
                  <input type="hidden" name="claimId" value={c.id} />
                  <input type="hidden" name="postId" value={post.id} />
                </ActionForm>
                <ActionForm action={rejectClaimAction} submitLabel="Tolak" danger>
                  <input type="hidden" name="claimId" value={c.id} />
                  <input type="hidden" name="postId" value={post.id} />
                  <textarea name="reason" required minLength={10} placeholder="Alasan penolakan" rows={2} />
                </ActionForm>
              </div>
            )}
          </ClaimCard>
      ))}
    </section>
  );
}

async function ClaimCard({ claim, children }: { claim: Claim; children?: React.ReactNode }) {
  const media = await getDb().select().from(claimMedia).where(eq(claimMedia.claimId, claim.id));
  const urls = await signedUrls("proofs", media.map((m) => m.path));
  return (
    <div className="space-y-2 rounded border p-3 text-sm">
      <p className="text-neutral-500">
        {CLAIM_STATUS_LABEL[claim.status]} · {dateTime(claim.createdAt)}
        {claim.status === "pending" && ` · tinjau sebelum ${dateTime(claim.reviewDeadline)}`}
      </p>
      <p className="whitespace-pre-wrap">{claim.message}</p>
      <p>
        <b>Lokasi:</b> {claim.foundLocation}
      </p>
      {claim.rejectReason && (
        <p>
          <b>Alasan ditolak:</b> {claim.rejectReason}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {urls.map((u, i) => (
          <a key={i} href={u} target="_blank" rel="noreferrer" className="underline">
            Bukti {i + 1}
          </a>
        ))}
      </div>
      {children}
    </div>
  );
}

function ClaimForm({ postId, verified }: { postId: string; verified: boolean }) {
  if (!verified) {
    return (
      <p className="text-sm">
        Kamu perlu{" "}
        <a href="/kyc" className="underline">
          verifikasi KYC
        </a>{" "}
        sebelum bisa mengirim klaim.
      </p>
    );
  }
  return (
    <section className="rounded-lg border bg-white p-4">
      <h2 className="mb-3 font-semibold">Saya menemukannya</h2>
      <ActionForm action={submitClaimAction} submitLabel="Kirim klaim">
        <input type="hidden" name="postId" value={postId} />
        <label>
          Informasi (di mana, kapan, kondisi)
          <textarea name="message" required minLength={20} rows={4} />
        </label>
        <label>
          Lokasi ditemukan
          <input name="foundLocation" required />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label>
            Latitude (opsional)
            <input name="foundLat" inputMode="decimal" />
          </label>
          <label>
            Longitude (opsional)
            <input name="foundLng" inputMode="decimal" />
          </label>
        </div>
        <label>
          Bukti foto/video (wajib, maks. 6)
          <input
            name="proofs"
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
            multiple
            required
          />
        </label>
        <p className="text-xs text-neutral-500">
          Bukti hanya bisa dilihat pemosting, dan admin jika terjadi sengketa.
        </p>
      </ActionForm>
    </section>
  );
}
