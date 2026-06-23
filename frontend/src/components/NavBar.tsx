"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { signOut } from "next-auth/react";
import { useTheme } from "@/components/ThemeProvider";
import Logo from "@/components/Logo";

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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
];

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    await signOut({ redirect: false });
    router.push("/login");
  };

  const isDark = theme === "dark";

  return (
    <header className="glass-nav sticky top-0 z-50">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">

          {/* Left: Logo + Nav */}
          <div className="flex items-center gap-6">
            <Link href="/" aria-label="Registro dashboard" style={{ textDecoration: "none" }}>
              <Logo />
            </Link>

            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-150"
                    style={{
                      color: active ? "var(--text)" : "var(--text-muted)",
                      background: active ? "var(--bg-muted)" : "transparent",
                    }}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">

            {/* Divider */}
            <div
              className="hidden sm:block w-px h-5 mx-1"
              style={{ background: "var(--border)" }}
            />

            {/* Dark mode toggle */}
            <button
              id="theme-toggle-btn"
              onClick={toggle}
              title={isDark ? "Prepnúť na svetlý režim" : "Prepnúť na tmavý režim"}
              className="w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-150"
              style={{
                background: "var(--bg-muted)",
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
              }}
            >
              {isDark ? <SunIcon /> : <MoonIcon />}
            </button>

            {/* Logout button */}
            <button
              id="logout-btn"
              onClick={handleLogout}
              disabled={loggingOut}
              title="Odhlásiť sa"
              className="hidden sm:flex w-9 h-9 items-center justify-center rounded-lg transition-all duration-150"
              style={{
                background: "var(--bg-muted)",
                border: "1px solid var(--border)",
                color: loggingOut ? "var(--text-muted)" : "var(--text-secondary)",
              }}
            >
              {loggingOut ? (
                <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              ) : (
                <LogOutIcon />
              )}
            </button>

            {/* Avatar */}
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
              style={{
                background: "var(--bg-muted)",
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
              }}
            >
              JD
            </div>

            {/* Mobile toggle */}
            <button
              className="md:hidden w-8 h-8 flex items-center justify-center rounded-md transition-colors"
              style={{ color: "var(--text-muted)" }}
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Menu"
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
          <div className="md:hidden pb-3 pt-2 space-y-1 fade-in" style={{ borderTop: "1px solid var(--border)" }}>
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center px-3 py-2 rounded-md text-sm font-medium"
                  style={{
                    color: active ? "var(--text)" : "var(--text-secondary)",
                    background: active ? "var(--bg-muted)" : "transparent",
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
            {/* Mobile logout */}
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm"
              style={{ color: "var(--text-muted)" }}
            >
              <LogOutIcon />
              Odhlásiť sa
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
