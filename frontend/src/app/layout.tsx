import type { Metadata } from "next";
import "./globals.css";
import NavBar from "@/components/NavBar";

export const metadata: Metadata = {
  title: {
    default: "Scripta.sk — Evidence Binder pre advokátov",
    template: "%s | Scripta.sk",
  },
  description:
    "Automatizovaná príprava Evidence Binder — zlúčené PDF výpisy zo štátnych registrov SR s titulnou stranou a semaformi nálezov.",
  keywords: ["evidence binder", "due diligence", "ORSR", "advokát", "právnik", "register"],
  robots: { index: false, follow: false }, // B2B SaaS — nechceme indexáciu
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sk" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <NavBar />
        <main className="min-h-[calc(100vh-64px)]">{children}</main>
        <footer
          className="border-t mt-16 py-6"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2">
            <span className="text-xs text-slate-600">
              © {new Date().getFullYear()} Scripta.sk — B2B Legal-Tech SaaS
            </span>
            <span className="text-xs text-slate-700">
              Určené výhradne pre advokátov a právnikov
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
