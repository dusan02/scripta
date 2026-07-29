"use client";

import { useTheme } from "@/components/ThemeProvider";
import { SunIcon, MoonIcon } from "@/components/icons";

type Size = "sm" | "md";

const sizeMap: Record<Size, { btn: string; icon: number }> = {
  sm: { btn: "w-10 h-10", icon: 16 },
  md: { btn: "w-9 h-9", icon: 15 },
};

export default function ThemeToggle({
  size = "md",
  className = "",
}: {
  size?: Size;
  className?: string;
}) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  const s = sizeMap[size];

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className={`${s.btn} flex items-center justify-center rounded-lg transition-all duration-150 hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ${className}`}
      style={{
        background: "var(--bg-muted)",
        border: "1px solid var(--border)",
        color: "var(--text-secondary)",
      }}
    >
      {isDark ? <SunIcon size={s.icon} /> : <MoonIcon size={s.icon} />}
    </button>
  );
}
