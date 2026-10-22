export const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

export const dateTime = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(d) : "-";

export const CATEGORY_LABEL = { animal: "Hewan", vehicle: "Kendaraan" } as const;

export const POST_STATUS_LABEL = {
  pending_payment: "Menunggu pembayaran",
  active: "Aktif",
  fulfilled: "Ditemukan",
  cancelled: "Dibatalkan",
  expired: "Kedaluwarsa",
} as const;

export const CLAIM_STATUS_LABEL = {
  pending: "Menunggu tinjauan",
  accepted: "Diterima",
  rejected: "Ditolak",
  disputed: "Sengketa (ditinjau admin)",
  dismissed: "Ditolak final",
  closed: "Ditutup",
} as const;
