import { RootShell, rootViewport } from "@/components/root-shell";
import { generateGlobalMetadata } from "@/lib/seo";

export const viewport = rootViewport;

export function generateMetadata() {
  return generateGlobalMetadata("de");
}

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <RootShell lang="de">{children}</RootShell>;
}
