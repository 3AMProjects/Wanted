import { and, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "@/db";
import { postMedia, posts } from "@/db/schema";
import { CATEGORY_LABEL, rupiah } from "@/lib/format";
import { publicUrl } from "@/server/services/storage";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const db = getDb();
  const rows = await db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.status, "active"),
        category === "animal" || category === "vehicle" ? eq(posts.category, category) : undefined,
      ),
    )
    .orderBy(desc(posts.createdAt))
    .limit(50);

  const media = rows.length
    ? await db.select().from(postMedia).where(inArray(postMedia.postId, rows.map((r) => r.id)))
    : [];
  const cover = new Map<string, string>();
  for (const m of media.sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (!cover.has(m.postId)) cover.set(m.postId, publicUrl(m.path));
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 text-sm">
        {[
          ["", "Semua"],
          ["animal", "Hewan"],
          ["vehicle", "Kendaraan"],
        ].map(([value, label]) => (
          <Link
            key={value}
            href={value ? `/?category=${value}` : "/"}
            className={`rounded-full border px-3 py-1 ${(category ?? "") === value ? "bg-neutral-900 text-white" : "bg-white"}`}
          >
            {label}
          </Link>
        ))}
      </div>

      {rows.length === 0 && <p className="text-neutral-500">Belum ada postingan aktif.</p>}

      <ul className="grid gap-4 sm:grid-cols-2">
        {rows.map((p) => (
          <li key={p.id} className="overflow-hidden rounded-lg border bg-white">
            <Link href={`/posts/${p.id}`}>
              {cover.get(p.id) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover.get(p.id)} alt="" className="h-48 w-full object-cover" />
              )}
              <div className="space-y-1 p-3">
                <p className="text-xs text-neutral-500">
                  {CATEGORY_LABEL[p.category]} · {p.lastSeenLocation}
                </p>
                <p className="font-semibold">{p.title}</p>
                <p className="text-lg font-bold text-green-700">{rupiah(p.reward)}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
