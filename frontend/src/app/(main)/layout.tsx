import type { Metadata } from "next";
import { headers } from "next/headers";
import { RootShell, rootViewport } from "@/components/root-shell";
import { getLangFromHeaders, generateGlobalMetadata } from "@/lib/seo";

export const viewport = rootViewport;

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const lang = getLangFromHeaders(h);
  return generateGlobalMetadata(lang);
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const h = await headers();
  const lang = getLangFromHeaders(h);
  return <RootShell lang={lang}>{children}</RootShell>;
}
