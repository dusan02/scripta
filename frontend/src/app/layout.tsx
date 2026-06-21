import type { Metadata } from "next";
import "./globals.css";
import NavWrapper from "@/components/NavWrapper";
import ThemeProvider from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: {
    default: "Veriso.sk — Due Diligence reporty pre advokátov",
    template: "%s | Veriso.sk",
  },
  description:
    "Automatizovaná príprava komplexných reportov — zlúčené PDF výpisy zo štátnych registrov SR s titulnou stranou a semaformi nálezov.",
  keywords: ["due diligence", "report", "ORSR", "advokát", "právnik", "register", "previerka"],
  robots: { index: false, follow: false },
};

// Inline script to prevent flash of wrong theme before React hydrates
const themeScript = `
(function() {
  try {
    var stored = localStorage.getItem('veriso-theme');
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
          <NavWrapper />
          <main style={{ minHeight: "calc(100vh - 56px)" }}>{children}</main>
          <footer style={{ borderTop: "1px solid var(--border)", marginTop: "64px" }}>
            <div className="max-w-[1200px] mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                © {new Date().getFullYear()} Veriso.sk
              </span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                Určené výhradne pre advokátov a právnikov
              </span>
            </div>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
