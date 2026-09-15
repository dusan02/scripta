"use client";

import { useRef, type ReactNode, type KeyboardEvent } from "react";

// ── Types ─────────────────────────────────────────────────────────────

export interface TabItem {
  /** Unique value identifying this tab */
  value: string;
  /** Visible label */
  label: ReactNode;
  /** Optional icon element rendered before the label */
  icon?: ReactNode;
  /** Disabled state — tab is visible but not activatable */
  disabled?: boolean;
}

interface TabsProps {
  items: TabItem[];
  /** Currently active tab value */
  value: string;
  /** Callback when the user selects a tab (click or keyboard) */
  onChange: (value: string) => void;
  /**
   * Visual variant:
   *   "underline" — bottom-border highlight (default, fits page-level navigation)
   *   "pill"      — filled rounded buttons (fits in-card segmented control)
   */
  variant?: "underline" | "pill";
  /** Extra class on the tablist container */
  className?: string;
  /** Accessible label for the tablist */
  ariaLabel?: string;
}

// ── Component ────────────────────────────────────────────────────────

/**
 * Accessible tab switcher with full ARIA + keyboard navigation.
 *
 * Implements WAI-ARIA Tabs pattern:
 *   - role="tablist" on container, role="tab" on each button
 *   - aria-selected reflects active state
 *   - Arrow Left/Right moves focus between tabs
 *   - Home/End jumps to first/last tab
 *   - Tab key moves into the associated panel (roving tabindex)
 *
 * Usage:
 *   <Tabs items={[...]} value={active} onChange={setActive} variant="underline" />
 *   <div role="tabpanel" aria-labelledby="tab-{value}">...</div>
 */
export function Tabs({
  items,
  value,
  onChange,
  variant = "underline",
  className = "",
  ariaLabel,
}: TabsProps) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const activeIndex = items.findIndex((t) => t.value === value);
  const safeActiveIndex = activeIndex === -1 ? 0 : activeIndex;

  const focusTab = (index: number) => {
    const clamped = Math.max(0, Math.min(index, items.length - 1));
    const el = tabRefs.current[clamped];
    if (el && !items[clamped].disabled) {
      el.focus();
      onChange(items[clamped].value);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        focusTab(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        focusTab(index - 1);
        break;
      case "Home":
        e.preventDefault();
        focusTab(0);
        break;
      case "End":
        e.preventDefault();
        focusTab(items.length - 1);
        break;
    }
  };

  // ── Underline variant ──────────────────────────────────────────────
  if (variant === "underline") {
    return (
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={`flex items-center gap-1 border-b ${className}`}
        style={{ borderColor: "var(--border)" }}
      >
        {items.map((tab, i) => {
          const isActive = tab.value === value;
          return (
            <button
              key={tab.value}
              ref={(el) => { tabRefs.current[i] = el; }}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.value}`}
              id={`tab-${tab.value}`}
              tabIndex={isActive ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => !tab.disabled && onChange(tab.value)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              className="px-4 py-2 text-sm font-medium transition-colors relative flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                color: isActive ? "var(--accent)" : "var(--text-muted)",
                borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                background: "none",
                border: "none",
                borderBottomWidth: 2,
                borderBottomStyle: "solid",
                borderBottomColor: isActive ? "var(--accent)" : "transparent",
                cursor: tab.disabled ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>
    );
  }

  // ── Pill variant ────────────────────────────────────────────────────
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex gap-2 ${className}`}
    >
      {items.map((tab, i) => {
        const isActive = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(el) => { tabRefs.current[i] = el; }}
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.value}`}
            id={`tab-${tab.value}`}
            tabIndex={isActive ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => !tab.disabled && onChange(tab.value)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className="px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: isActive ? "var(--accent)" : "var(--surface)",
              color: isActive ? "var(--accent-button-text)" : "var(--text-secondary)",
              border: isActive ? "none" : "1px solid var(--border)",
              fontFamily: "inherit",
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
