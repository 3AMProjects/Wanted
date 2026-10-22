import { createPostAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { requireVerifiedUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { rupiah } from "@/lib/format";

export default async function NewPostPage() {
  await requireVerifiedUser();
  const e = env();
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-bold">Pasang postingan</h1>
      <p className="text-sm text-neutral-600">
        Hadiah minimal {rupiah(e.MIN_REWARD)}. Kamu membayar hadiah + biaya platform{" "}
        {e.POSTING_FEE_BPS / 100}% di depan; hadiah ditahan sampai ada penemu yang kamu terima.
        Membatalkan postingan dikenai biaya {e.CANCEL_FEE_BPS / 100}% dari hadiah, dan postingan
        berakhir otomatis setelah {e.POST_DURATION_DAYS} hari dengan aturan yang sama.
      </p>
      <ActionForm action={createPostAction} submitLabel="Lanjut ke pembayaran">
        <label>
          Kategori
          <select name="category" required>
            <option value="animal">Hewan</option>
            <option value="vehicle">Kendaraan</option>
          </select>
        </label>
        <label>
          Judul
          <input name="title" required minLength={5} maxLength={120} placeholder="Kucing oren hilang di Tebet" />
        </label>
        <label>
          Deskripsi (ciri-ciri, plat nomor, kalung, dll.)
          <textarea name="description" required minLength={20} rows={5} />
        </label>
        <label>
          Lokasi terakhir terlihat
          <input name="lastSeenLocation" required />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label>
            Latitude (opsional)
            <input name="lastSeenLat" inputMode="decimal" />
          </label>
          <label>
            Longitude (opsional)
            <input name="lastSeenLng" inputMode="decimal" />
          </label>
        </div>
        <label>
          Terakhir terlihat pada
          <input name="lastSeenAt" type="datetime-local" />
        </label>
        <label>
          Hadiah (Rp)
          <input name="reward" type="number" required min={e.MIN_REWARD} step={1000} />
        </label>
        <label>
          Foto (maks. 6)
          <input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple required />
        </label>
      </ActionForm>
    </div>
  );
}
