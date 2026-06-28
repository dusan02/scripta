import type { Metadata } from "next";
import "./globals.css";
import NavWrapper from "@/components/NavWrapper";
import ThemeProvider from "@/components/ThemeProvider";
import { LanguageProvider } from "@/components/LanguageProvider";
import Footer from "@/components/Footer";
import ToasterProvider from "@/components/ToasterProvider";
import OfflineIndicator from "@/components/OfflineIndicator";
import AuthProvider from "@/components/AuthProvider";

export const metadata: Metadata = {
  title: {
    default: "Verifa.sk — Due Diligence reporty",
    template: "%s | Verifa.sk",
  },
  description:
    "Automatizovaná príprava komplexných reportov — zlúčené PDF výpisy zo štátnych registrov SR s titulnou stranou a semaformi nálezov.",
  keywords: ["due diligence", "report", "ORSR", "advokát", "právnik", "register", "previerka", "daňoví dlžníci", "exekúcie", "insolvencia"],
  robots: { index: false, follow: false },
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
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
    <html lang="sk" suppressHydrationWarning>
      <head>
        {/* No-flash theme script — must run before any rendering */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap"
          rel="stylesheet"
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
            </LanguageProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
