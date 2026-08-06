import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies, headers } from "next/headers";
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
import { getLangFromHeaders, getHtmlLang, generateGlobalMetadata, getLocalizedJsonLd } from "@/lib/seo";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const lang = getLangFromHeaders(h);
  return generateGlobalMetadata(lang);
}

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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const h = await headers();
  const lang = getLangFromHeaders(h);
  const htmlLang = getHtmlLang(lang);
  const jsonLd = getLocalizedJsonLd(lang);

  return (
    <html lang={htmlLang} suppressHydrationWarning className={inter.variable}>
      <head>
        {/* No-flash theme script — must run before any rendering */}
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeScript }} />
        {/* JSON-LD structured data for SEO (localized) */}
        {jsonLd.map((schema, i) => (
          <script
            key={i}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
          />
        ))}
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <LanguageProvider initialLang={lang}>
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
