import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import NavWrapper from "@/components/NavWrapper";
import ThemeProvider from "@/components/ThemeProvider";
import { LanguageProvider } from "@/components/LanguageProvider";
import Footer from "@/components/Footer";
import ToasterProvider from "@/components/ToasterProvider";
import OfflineIndicator from "@/components/OfflineIndicator";
import CookieBanner from "@/components/CookieBanner";
import AuthProvider from "@/components/AuthProvider";

export const metadata: Metadata = {
  metadataBase: new URL("https://verifa.sk"),
  title: {
    default: "Verifa.sk — Due Diligence reporty",
    template: "%s | Verifa.sk",
  },
  description:
    "Automatizovaná príprava komplexných reportov — zlúčené PDF výpisy zo štátnych registrov SR s titulnou stranou a semaformi nálezov.",
  keywords: ["due diligence", "report", "ORSR", "advokát", "právnik", "register", "previerka", "daňoví dlžníci", "exekúcie", "insolvencia"],
  robots: { index: true, follow: true },
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
  },
  openGraph: {
    type: "website",
    locale: "sk_SK",
    siteName: "Verifa.sk",
    title: "Verifa.sk — Due Diligence reporty",
    description:
      "Automatizovaná príprava komplexných reportov — zlúčené PDF výpisy zo štátnych registrov SR s AI analýzou finančného zdravia a semaformi nálezov.",
    images: [
      {
        url: "/logo-verifa.png",
        width: 1200,
        height: 630,
        alt: "Verifa.sk — Due Diligence reporty",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Verifa.sk — Due Diligence reporty",
    description:
      "Automatizovaná príprava komplexných reportov — zlúčené PDF výpisy zo štátnych registrov SR s AI analýzou finančného zdravia.",
    images: ["/logo-verifa.png"],
  },
  alternates: {
    canonical: "https://verifa.sk",
  },
};

// Inline script to prevent flash of wrong theme before React hydrates
const themeScript = `
(function() {
  try {
    var stored = localStorage.getItem('verifa-theme');
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.setAttribute('data-theme', stored);
    } else {
      var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
  } catch(e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sk" suppressHydrationWarning className={GeistSans.className}>
      <head>
        {/* No-flash theme script — must run before any rendering */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* JSON-LD structured data for SEO */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Verifa.sk",
              url: "https://verifa.sk",
              logo: "https://verifa.sk/logo-verifa.png",
              description: "Automatizovaná príprava komplexných due diligence reportov zo štátnych registrov SR s AI analýzou finančného zdravia.",
              email: "info@verifa.sk",
              areaServed: "SK",
              knowsAbout: ["due diligence", "finančná analýza", "forenzný audit", "registre SR", "Altman Z-score", "Piotroski model"],
            }),
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <LanguageProvider>
              <NavWrapper />
              <main style={{ minHeight: "calc(100vh - 56px)" }}>{children}</main>
              <Footer />
              <ToasterProvider />
              <OfflineIndicator />
              <CookieBanner />
            </LanguageProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
