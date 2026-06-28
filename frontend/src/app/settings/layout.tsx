import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Nastavenia",
  description: "Prispôsobte si predvolené registre a nastavenia reportov na Verifa.sk.",
};

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
