import { submitKycAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function KycPage() {
  const user = await requireUser();
  if (user.kycStatus === "verified") return <p>KYC kamu sudah terverifikasi.</p>;
  if (user.kycStatus === "pending") return <p>KYC kamu sedang ditinjau. Kami akan mengabari setelah selesai.</p>;

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-xl font-bold">Verifikasi identitas (KYC)</h1>
      <p className="text-sm text-neutral-600">
        Wajib untuk memasang postingan, mengirim klaim, dan mencairkan saldo. Dokumen disimpan privat dan hanya
        dilihat admin untuk verifikasi.
      </p>
      {user.kycStatus === "rejected" && (
        <p className="text-sm text-red-600">Pengajuan sebelumnya ditolak. Silakan ajukan ulang.</p>
      )}
      <ActionForm action={submitKycAction} submitLabel="Kirim">
        <label>
          Nama lengkap sesuai KTP
          <input name="fullName" required />
        </label>
        <label>
          NIK
          <input name="nik" inputMode="numeric" pattern="\d{16}" required />
        </label>
        <label>
          Foto KTP
          <input name="ktp" type="file" accept="image/jpeg,image/png,image/webp" required />
        </label>
        <label>
          Selfie sambil memegang KTP
          <input name="selfie" type="file" accept="image/jpeg,image/png,image/webp" required />
        </label>
      </ActionForm>
    </div>
  );
}
