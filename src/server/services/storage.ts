import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { RuleError } from "@/domain/rules";

export const BUCKETS = {
  postMedia: "post-media", // public
  proofs: "proofs", // private
  kyc: "kyc", // private
} as const;

const IMAGE = ["image/jpeg", "image/png", "image/webp"];
const VIDEO = ["video/mp4", "video/quicktime"];
const MAX_BYTES = 10 * 1024 * 1024;

export function realFiles(files: FormDataEntryValue[]): File[] {
  return files.filter((f): f is File => f instanceof File && f.size > 0);
}

export async function uploadFiles(
  bucket: (typeof BUCKETS)[keyof typeof BUCKETS],
  prefix: string,
  files: File[],
  opts: { allowVideo?: boolean; max: number },
) {
  if (files.length > opts.max) throw new RuleError(`Maksimal ${opts.max} file.`);
  const allowed = opts.allowVideo ? [...IMAGE, ...VIDEO] : IMAGE;
  for (const f of files) {
    if (!allowed.includes(f.type)) throw new RuleError(`Tipe file tidak didukung: ${f.type}`);
    if (f.size > MAX_BYTES) throw new RuleError("Ukuran file maksimal 10 MB.");
  }

  const storage = supabaseAdmin().storage.from(bucket);
  const paths: string[] = [];
  for (const f of files) {
    const ext = f.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
    const path = `${prefix}/${randomUUID()}.${ext}`;
    const { error } = await storage.upload(path, f, { contentType: f.type });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    paths.push(path);
  }
  return paths;
}

export function publicUrl(path: string) {
  return supabaseAdmin().storage.from(BUCKETS.postMedia).getPublicUrl(path).data.publicUrl;
}

/** Short-lived links for private files; callers must authorise the viewer first. */
export async function signedUrls(bucket: "proofs" | "kyc", paths: string[]) {
  if (paths.length === 0) return [];
  const { data, error } = await supabaseAdmin().storage.from(bucket).createSignedUrls(paths, 600);
  if (error) throw new Error(error.message);
  return data.map((d) => d.signedUrl ?? "");
}
