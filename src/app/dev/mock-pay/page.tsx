import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { payments } from "@/db/schema";
import { env } from "@/lib/env";
import { rupiah } from "@/lib/format";
import { idFromExternalId } from "@/server/payments";
import { markPaymentPaid } from "@/server/services/posts";

export const dynamic = "force-dynamic";

/** Fake hosted checkout used when PAYMENT_PROVIDER=mock. */
export default async function MockPayPage({
  searchParams,
}: {
  searchParams: Promise<{ externalId?: string }>;
}) {
  if (env().PAYMENT_PROVIDER !== "mock") notFound();
  const { externalId } = await searchParams;
  if (!externalId) notFound();
  const paymentId = idFromExternalId(externalId);
  const [payment] = await getDb().select().from(payments).where(eq(payments.id, paymentId));
  if (!payment) notFound();

  async function pay() {
    "use server";
    if (env().PAYMENT_PROVIDER !== "mock") notFound();
    await markPaymentPaid(paymentId, payment.amount);
    redirect(`/posts/${payment.postId}?paid=1`);
  }

  return (
    <form action={pay} className="mx-auto max-w-sm space-y-3 rounded-lg border bg-white p-6">
      <p className="text-xs font-semibold uppercase text-orange-600">Mode uji coba, bukan pembayaran asli</p>
      <p>Total pembayaran</p>
      <p className="text-3xl font-bold">{rupiah(payment.amount)}</p>
      <button className="w-full rounded bg-neutral-900 py-2 text-white">Bayar (simulasi)</button>
    </form>
  );
}
