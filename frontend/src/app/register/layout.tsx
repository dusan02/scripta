import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Registrácia",
  description: "Vytvorte si účet na Verifa.sk — platforme pre automatizované Business Risk Reporty.",
};

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
