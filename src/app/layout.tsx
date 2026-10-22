import type { Metadata } from "next";
import Link from "next/link";
import { signOutAction } from "@/app/actions";
import { currentUser } from "@/lib/auth";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Wanted",
  description: "Pasang hadiah untuk menemukan hewan dan kendaraan yang hilang.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="id">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        <header className="border-b bg-white">
          <nav className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3 text-sm">
            <Link href="/" className="text-lg font-bold">
              Wanted
            </Link>
            <Link href="/posts/new">Pasang postingan</Link>
            <span className="flex-1" />
            {user ? (
              <>
                {user.role === "admin" && <Link href="/admin">Admin</Link>}
                <Link href="/me">Akun saya</Link>
                <form action={signOutAction}>
                  <button className="text-neutral-500">Keluar</button>
                </form>
              </>
            ) : (
              <Link href="/login">Masuk</Link>
            )}
          </nav>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
