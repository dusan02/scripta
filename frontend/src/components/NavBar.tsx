"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { signOut, useSession } from "next-auth/react";
import { useTheme } from "@/components/ThemeProvider";
import { useT } from "@/components/LanguageProvider";
import Logo from "@/components/Logo";
import FeedbackModal from "@/components/FeedbackModal";
import LanguageSwitcher from "@/components/LanguageSwitcher";

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}

function LogOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

function FeedbackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
    </svg>
  );
}

function CreditCardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z" /><path d="M22 6l-10 7L2 6" />
    </svg>
  );
}

const NAV_ITEMS = [
  { href: "/dashboard", key: "nav.overenie", icon: SearchIcon },
  { href: "/history", key: "nav.historia", icon: ClockIcon },
  { href: "/plan", key: "nav.pausal", icon: CreditCardIcon },
  { href: "/documents", key: "nav.dokumenty", icon: FileIcon },
  { href: "/settings", key: "nav.nastavenia", icon: SettingsIcon },
  { href: "/messages", key: "nav.spravy", icon: MailIcon },
];

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const t = useT();
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [creditsUsed, setCreditsUsed] = useState<number | null>(null);

  const userInitials = (() => {
    const email = session?.user?.email ?? "";
    const name = session?.user?.name;
    if (name) {
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return parts[0].slice(0, 2).toUpperCase();
    }
    if (email) return email.slice(0, 2).toUpperCase();
    return "?";
  })();

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch("/api/credits")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setCreditsUsed(data.usedThisMonth); })
      .catch(() => {});
  }, [session?.user?.id]);

  const handleLogout = async () => {
    setLoggingOut(true);
    await signOut({ redirect: false });
    router.push("/login");
  };

  const isDark = theme === "dark";

  return (
    <>
    <header className="glass-nav sticky top-0 z-50">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16 py-2">

          {/* Left: Logo */}
          <div className="flex items-center">
            <Link href="/dashboard" aria-label={`Verifa.sk — ${t("nav.overenie")}`} style={{ textDecoration: "none" }}>
              <Logo />
            </Link>
          </div>

          {/* Center: Nav icons */}
          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={t(item.key)}
                  className="flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-150"
                  style={{
                    color: active ? "var(--accent)" : "var(--text-secondary)",
                    background: active ? "var(--accent-light)" : "transparent",
                  }}
                >
                  <item.icon />
                </Link>
              );
            })}
          </nav>

          {/* Right: Unified action cluster */}
          <div className="flex items-center gap-2">
            {/* Credits pill */}
            <div
              className="hidden sm:flex items-center gap-1.5 px-2.5 h-9 rounded-lg text-xs font-medium"
              style={{
                background: "var(--bg-muted)",
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
              }}
              title={t("nav.reportovTentoMesiac")}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
              </svg>
              {creditsUsed !== null ? `${creditsUsed}×` : "—"}
            </div>

            {/* Language switcher */}
            <LanguageSwitcher />

            {/* Theme toggle */}
            <button
              id="theme-toggle-btn"
              onClick={toggle}
              title={isDark ? t("nav.svetly") : t("nav.tmavy")}
              className="w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-150"
              style={{
                background: "var(--bg-muted)",
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
              }}
            >
              {isDark ? <SunIcon /> : <MoonIcon />}
            </button>

            {/* Feedback icon */}
            <button
              onClick={() => setFeedbackOpen(true)}
              title={t("nav.reportovatTitle")}
              className="hidden sm:flex w-9 h-9 items-center justify-center rounded-lg transition-all duration-150"
              style={{
                background: "var(--bg-muted)",
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
              }}
            >
              <FeedbackIcon />
            </button>

            {/* Avatar with dropdown */}
            <div className="relative">
              <button
                onClick={() => setAvatarOpen(!avatarOpen)}
                className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 transition-all duration-150"
                style={{
                  background: "var(--bg-muted)",
                  border: avatarOpen ? "1px solid var(--accent)" : "1px solid var(--border)",
                  color: "var(--text-secondary)",
                }}
              >
                {userInitials}
              </button>

              {avatarOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setAvatarOpen(false)} />
                  <div
                    className="absolute right-0 top-11 z-50 w-48 rounded-lg shadow-lg overflow-hidden"
                    style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
                      {session?.user?.email ?? ""}
                    </div>
                    <button
                      onClick={() => { setFeedbackOpen(true); setAvatarOpen(false); }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <FeedbackIcon />
                      {t("nav.reportovat")}
                    </button>
                    <button
                      onClick={handleLogout}
                      disabled={loggingOut}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {loggingOut ? (
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                          <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                      ) : (
                        <LogOutIcon />
                      )}
                      {t("nav.odhlasit")}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Mobile toggle */}
            <button
              className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: "var(--text-secondary)", background: "var(--bg-muted)", border: "1px solid var(--border)" }}
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label={t("nav.menu")}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {mobileOpen
                  ? <path d="M6 18L18 6M6 6l12 12" />
                  : <><line x1="4" y1="8" x2="20" y2="8" /><line x1="4" y1="16" x2="20" y2="16" /></>
                }
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden pb-4 pt-2 fade-in" style={{ borderTop: "1px solid var(--border)" }}>
            <div className="grid grid-cols-3 gap-2">
              {NAV_ITEMS.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className="flex flex-col items-center gap-1 py-3 rounded-lg transition-all duration-150"
                    style={{
                      color: active ? "var(--accent)" : "var(--text-secondary)",
                      background: active ? "var(--accent-light)" : "var(--bg-muted)",
                    }}
                  >
                    <item.icon />
                    <span className="text-[10px] font-medium">{t(item.key)}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
      </header>

      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </>
  );
}
