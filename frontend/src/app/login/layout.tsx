import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Prihlásenie",
  description: "Prihlásenie do systému Registro.sk — Komplexné reporty pre advokátov",
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
