"use client";

import { HamburgerIcon, CloseIcon } from "@/components/icons";

export function HamburgerButton({
  open,
  onClick,
  ariaLabel = "Menu",
}: {
  open: boolean;
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      className="w-10 h-10 md:hidden flex items-center justify-center rounded-lg transition-all hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
      style={{
        background: "var(--bg-muted)",
        border: "1px solid var(--border)",
        color: "var(--text-secondary)",
      }}
    >
      {open ? <CloseIcon size={20} /> : <HamburgerIcon size={20} />}
    </button>
  );
}

export function MobileMenuBackdrop({
  open,
  onClick,
  topOffset = 0,
}: {
  open: boolean;
  onClick: () => void;
  topOffset?: number;
}) {
  if (!open) return null;
  return (
    <div
      className="md:hidden fixed inset-0 z-40"
      style={{
        background: "rgba(0,0,0,0.4)",
        top: topOffset || 0,
      }}
      onClick={onClick}
    />
  );
}
