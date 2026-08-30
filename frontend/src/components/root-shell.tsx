import type { Viewport } from "next";
import { Inter } from "next/font/google";
import "../app/globals.css";

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
import Analytics from "@/components/Analytics";
import { getHtmlLang, getLocalizedJsonLd } from "@/lib/seo";
import type { Lang } from "@/lib/i18n";

export const rootViewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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

/**
 * Shared root HTML shell. Used by:
 * - app/(main)/layout.tsx — dynamic, lang detected from headers
 * - app/(pub*)/layout.tsx — static firma route groups, lang fixed per group (ISR-cacheable)
 */
export function RootShell({ lang, children }: { lang: Lang; children: React.ReactNode }) {
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
        <Analytics />
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
