import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Prihlásenie",
  description: "Prihlásenie do systému Verifa.sk — Komplexné reporty",
};

/**
 * Login layout — zámerne bez NavBar a Footer, aby stránka pôsobila
 * ako plnoobrazovkový autentifikačný portál.
 */
export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
