import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-inter",
  weight: ["400", "500", "600", "700"],
});
import NavWrapper from "@/components/NavWrapper";
import ThemeProvider from "@/components/ThemeProvider";
import { LanguageProvider } from "@/components/LanguageProvider";
import Footer from "@/components/Footer";
import ToasterProvider from "@/components/ToasterProvider";
import OfflineIndicator from "@/components/OfflineIndicator";
import CookieBanner from "@/components/CookieBanner";
import AuthProvider from "@/components/AuthProvider";
import SkipToContent from "@/components/SkipToContent";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://verifa.sk"),
  title: {
    default: "Verifa.sk — Business Risk Report",
    template: "%s | Verifa.sk",
  },
  description:
    "Automatizovaný Business Risk Report — finančné, právne a forenzné riziko firmy v jednom PDF. Verifa Score (0–100), Altman Z-Score, kontrola 25+ registrov.",
  keywords: ["business risk report", "riziko firmy", "overenie firmy", "report", "ORSR", "advokát", "právnik", "register", "previerka", "daňoví dlžníci", "exekúcie", "insolvencia"],
  robots: { index: true, follow: true },
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
  },
  openGraph: {
    type: "website",
    locale: "sk_SK",
    siteName: "Verifa.sk",
    title: "Verifa.sk — Business Risk Report",
    description:
      "Automatizovaný Business Risk Report — finančné, právne a forenzné riziko firmy v jednom PDF s Verifa Score a semaformi nálezov.",
    images: [
      {
        url: "/logo-verifa.png",
        width: 1200,
        height: 630,
        alt: "Verifa.sk — Business Risk Report",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Verifa.sk — Business Risk Report",
    description:
      "Automatizovaný Business Risk Report — finančné, právne a forenzné riziko firmy v jednom PDF s AI analýzou finančného zdravia.",
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
      document.documentElement.setAttribute('data-theme', 'light');
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
    <html lang="sk" suppressHydrationWarning className={inter.variable}>
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
              description: "Automatizovaný Business Risk Report — finančné, právne a forenzné riziko firmy z štátnych registrov SR s AI analýzou finančného zdravia.",
              email: "info@verifa.sk",
              areaServed: "SK",
              knowsAbout: ["business risk report", "finančná analýza", "forenzný audit", "registre SR", "Altman Z-score", "Piotroski model"],
            }),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "Verifa.sk",
              url: "https://verifa.sk",
              description: "Automatizovaný Business Risk Report — finančné, právne a forenzné riziko firmy z štátnych registrov SR.",
              publisher: {
                "@type": "Organization",
                name: "Verifa.sk",
                url: "https://verifa.sk",
              },
            }),
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <LanguageProvider>
              <SkipToContent />
              <NavWrapper />
              <main id="main-content" style={{ minHeight: "calc(100vh - 56px)" }}>{children}</main>
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
