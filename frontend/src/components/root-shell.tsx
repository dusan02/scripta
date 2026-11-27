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
import { safeJsonLd } from "@/lib/seo/safe-json-ld";
import { getHtmlLang, getLocalizedJsonLd } from "@/lib/seo";
import type { Lang } from "@/lib/i18n";

export const rootViewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Inline script to prevent flash of wrong theme before React hydrates
// and auto-recover once from stale deploy ChunkLoadError / 404 chunk scripts.
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

  function reloadOnceOnChunkError() {
    try {
      var key = 'verifa-chunk-reload:' + location.pathname;
      var last = Number(sessionStorage.getItem(key) || '0');
      var now = Date.now();
      if (!last || now - last > 15000) {
        sessionStorage.setItem(key, String(now));
        location.reload();
      }
    } catch(e) {}
  }

  function isChunkErrorMessage(msg, name) {
    if (name === 'ChunkLoadError') return true;
    if (!msg) return false;
    return /ChunkLoadError|Loading (CSS )?chunk [\\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(String(msg));
  }

  window.addEventListener('error', function(e) {
    var t = e && e.target;
    if (t && (t.tagName === 'SCRIPT' || t.tagName === 'LINK')) {
      var url = t.src || t.href || '';
      if (url.indexOf('/_next/static/') !== -1) {
        reloadOnceOnChunkError();
        return;
      }
    }
    var err = e && e.error;
    if (isChunkErrorMessage(e && e.message, err && err.name) || isChunkErrorMessage(err && err.message, err && err.name)) {
      reloadOnceOnChunkError();
    }
  }, true);

  window.addEventListener('unhandledrejection', function(e) {
    var r = e && e.reason;
    if (isChunkErrorMessage(r && (r.message || r), r && r.name)) {
      reloadOnceOnChunkError();
    }
  });
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
      <head suppressHydrationWarning>
        {/* No-flash theme script — must run before any rendering */}
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {/* JSON-LD structured data for SEO (localized) */}
        {jsonLd.map((schema, i) => (
          <script
            key={i}
            type="application/ld+json"
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: safeJsonLd(schema) }}
          />
        ))}
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
