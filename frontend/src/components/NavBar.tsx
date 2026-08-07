"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { signOut, useSession } from "next-auth/react";
import { useT } from "@/components/LanguageProvider";
import Logo from "@/components/Logo";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ThemeToggle from "@/components/ThemeToggle";
import { useScrollLock } from "@/components/useNav";
import { HamburgerButton, MobileMenuBackdrop } from "@/components/NavShared";
import {
  LogOutIcon,
  SearchIcon,
  ClockIcon,
  CreditCardIcon,
  SettingsIcon,
  MailIcon,
  CheckIcon,
} from "@/components/icons";

const NAV_ITEMS = [
  { href: "/dashboard", key: "nav.overenie", icon: SearchIcon },
  { href: "/history", key: "nav.historia", icon: ClockIcon },
  { href: "/credits", key: "nav.kredity", icon: CreditCardIcon },
  { href: "/settings", key: "nav.nastavenia", icon: SettingsIcon },
  { href: "/messages", key: "nav.spravy", icon: MailIcon },
];

function getUserInitials(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return "?";
}

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useT();
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [creditsUsed, setCreditsUsed] = useState<number | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Lock body scroll when mobile menu is open
  useScrollLock(mobileOpen);

  const userInitials = getUserInitials(session?.user?.name, session?.user?.email);

  useEffect(() => {
    if (!session?.user?.id) return;
    const fetchCredits = () => {
      fetch("/api/credits")
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setCreditsUsed(data.usedThisMonth); })
        .catch(() => {});
    };
    fetchCredits();
    const interval = setInterval(fetchCredits, 30000);
    return () => clearInterval(interval);
  }, [session?.user?.id, pathname]);

  useEffect(() => {
    if (!session?.user?.id) return;
    const fetchUnread = () => {
      fetch("/api/messages/unread")
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setUnreadCount(data.count); })
        .catch(() => {});
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => clearInterval(interval);
  }, [session?.user?.id, pathname]);

  const handleLogout = async () => {
    setLoggingOut(true);
    await signOut({ redirect: false });
    router.push("/login");
  };


  return (
    <>
    <header className="glass-nav sticky top-0 z-50">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16 py-2">

          {/* Left: Logo */}
          <div className="flex items-center flex-1">
            <Link href="/dashboard" aria-label={`Verifa.sk — ${t("nav.overenie")}`} style={{ textDecoration: "none" }}>
              <Logo />
            </Link>
          </div>

          {/* Center: Nav icons */}
          <nav className="hidden md:flex items-center gap-1 justify-center">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={t(item.key)}
                  aria-current={active ? "page" : undefined}
                  className="flex items-center gap-1.5 px-2.5 h-9 rounded-lg transition-all duration-150 relative"
                  style={{
                    color: active ? "var(--accent)" : "var(--text-secondary)",
                    background: active ? "var(--accent-light)" : "transparent",
                  }}
                >
                  <item.icon />
                  <span className="text-xs font-medium hidden lg:inline">{t(item.key)}</span>
                  {item.href === "/messages" && unreadCount > 0 && (
                    <span
                      className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full"
                      style={{ background: "var(--danger)", border: "1.5px solid var(--surface)" }}
                    />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Right: Unified action cluster */}
          <div className="flex items-center gap-2 flex-1 justify-end">
            {/* Credits pill — hidden on mobile, shown in menu */}
            <div
              className="hidden sm:flex items-center gap-1.5 px-2.5 h-9 rounded-lg text-xs font-medium"
              style={{
                background: "var(--bg-muted)",
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
              }}
              title={t("nav.reportovTentoMesiac")}
            >
              <CheckIcon size={12} />
              {creditsUsed !== null ? creditsUsed : "—"}
            </div>

            {/* Language switcher — hidden on mobile, shown in menu */}
            <div className="hidden sm:block">
              <LanguageSwitcher />
            </div>

            {/* Theme toggle — hidden on mobile, shown in menu */}
            <div className="hidden sm:block">
              <ThemeToggle size="md" />
            </div>

            {/* Avatar with dropdown — hidden on mobile, shown in menu */}
            <div className="relative hidden sm:block">
              <button
                onClick={() => setAvatarOpen(!avatarOpen)}
                aria-label={t("nav.odhlasit")}
                aria-expanded={avatarOpen}
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
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
                      {session?.user?.email ?? ""}
                    </div>
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
            <HamburgerButton
              open={mobileOpen}
              onClick={() => setMobileOpen(!mobileOpen)}
              ariaLabel={t("nav.menu")}
            />
          </div>
        </div>

        {/* Mobile menu */}
        <MobileMenuBackdrop open={mobileOpen} onClick={() => setMobileOpen(false)} topOffset={64} />
        {mobileOpen && (
          <>
            {/* Menu panel */}
            <div
              className="md:hidden pb-4 pt-3 slide-down relative z-50"
              style={{
                borderTop: "1px solid var(--border)",
                background: "var(--surface)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
              }}
            >
              {/* Credits + user info */}
              <div className="flex items-center justify-between mb-3 px-1 gap-2">
                <div
                  className="flex items-center gap-1.5 px-3 rounded-lg text-xs font-medium flex-shrink-0"
                  style={{ background: "var(--bg-muted)", border: "1px solid var(--border)", color: "var(--text-secondary)", minHeight: "44px" }}
                >
                  <CheckIcon size={12} />
                  {creditsUsed !== null ? creditsUsed : "—"}
                </div>
                <span className="text-xs truncate min-w-0" style={{ color: "var(--text-muted)", maxWidth: "calc(100% - 80px)" }}>
                  {session?.user?.email ?? ""}
                </span>
              </div>

              {/* Nav grid */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                {NAV_ITEMS.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className="flex flex-col items-center gap-1.5 py-3 rounded-lg transition-all duration-150 relative"
                      style={{
                        color: active ? "var(--accent)" : "var(--text-secondary)",
                        background: active ? "var(--accent-light)" : "var(--bg-muted)",
                      }}
                    >
                      <item.icon />
                      {item.href === "/messages" && unreadCount > 0 && (
                        <span
                          className="absolute top-2 right-3 w-2.5 h-2.5 rounded-full"
                          style={{ background: "var(--danger)", border: "1.5px solid var(--surface)" }}
                        />
                      )}
                      <span className="text-[10px] font-medium">{t(item.key)}</span>
                    </Link>
                  );
                })}
              </div>

              {/* Bottom controls: theme, language, logout */}
              <div className="flex items-center justify-between gap-2 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                <div className="flex items-center gap-2">
                  <ThemeToggle size="sm" />
                  <LanguageSwitcher />
                </div>
                <button
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="flex items-center gap-2 px-4 h-11 rounded-lg text-sm font-medium transition-all duration-150"
                  style={{ background: "var(--bg-muted)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
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
            </div>
          </>
        )}
      </div>
      </header>

    </>
  );
}
