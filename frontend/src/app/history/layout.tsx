import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "História reportov",
  description: "Prehľad všetkých vygenerovaných reportov na Verifa.sk.",
};

export default function HistoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
