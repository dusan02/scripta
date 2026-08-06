import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getLangFromCookie, generatePageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const lang = getLangFromCookie(cookieStore.get("verifa-lang")?.value);
  return generatePageMetadata("documents", lang);
}

export default function DocumentsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
