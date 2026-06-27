"use client";

import { SOURCE_CATEGORIES, SOURCES, ENABLED_SOURCES, SOURCE_MAP, type SourceInfo } from "@/lib/sources";

// ── Types ────────────────────────────────────────────────────────

interface SourceStatus {
  sourceType: string;
  status: string;
  statusMessage?: string | null;
}

type Mode = "selection" | "status";

interface RegistryGridProps {
  mode: Mode;
  selected?: string[];
  onToggle?: (id: string) => void;
  onSelectAll?: () => void;
  onSelectNone?: () => void;
  sources?: SourceStatus[];
}

// ── Pill state type ──────────────────────────────────────────────

type PillState = "idle_selected" | "idle_deselected" | "disabled" | "loading" | "success" | "warning" | "error";

// ── Icons ────────────────────────────────────────────────────────

function CheckIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" className="flex-shrink-0">
      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SpinnerIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="flex-shrink-0 animate-spin" style={{ color: "var(--info-text)" }}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function AlertIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
      <path d="M12 9v4M12 17h.01" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function LockIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-shrink-0 opacity-40 hover:opacity-100 transition-opacity"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

// ── Pill style config per state ──────────────────────────────────

const PILL_STYLES: Record<PillState, { bg: string; border: string; color: string; opacity: number }> = {
  idle_selected:   { bg: "var(--accent-light)",   border: "var(--accent-border)",  color: "var(--accent)",          opacity: 1 },
  idle_deselected: { bg: "var(--bg-muted)",       border: "var(--border)",          color: "var(--text-muted)",      opacity: 1 },
  disabled:        { bg: "var(--bg-subtle)",      border: "var(--border)",          color: "var(--text-muted)",      opacity: 0.5 },
  loading:         { bg: "var(--bg-muted)",       border: "var(--border)",          color: "var(--text-muted)",      opacity: 0.6 },
  success:         { bg: "var(--success-bg)",     border: "var(--success)",         color: "var(--success-text)",    opacity: 1 },
  warning:         { bg: "var(--warning-bg)",     border: "var(--warning)",         color: "var(--warning-text)",    opacity: 1 },
  error:           { bg: "var(--danger-bg)",      border: "var(--danger)",          color: "var(--danger-text)",     opacity: 1 },
};

function LeftIcon({ state }: { state: PillState }) {
  switch (state) {
    case "idle_selected":
    case "success":
      return <CheckIcon />;
    case "loading":
      return <SpinnerIcon />;
    case "warning":
    case "error":
      return <AlertIcon />;
    case "disabled":
      return <LockIcon />;
    default:
      return null;
  }
}

// ── RegistryPill (shared) ────────────────────────────────────────

interface RegistryPillProps {
  label: string;
  state: PillState;
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
}

function RegistryPill({ label, state, title, onClick, disabled }: RegistryPillProps) {
  const style = PILL_STYLES[state];
  const isButton = !!onClick;

  const className = "flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors duration-300 max-w-full";
  const sharedProps = {
    className,
    style: {
      background: style.bg,
      border: `1px solid ${style.border}`,
      color: style.color,
      opacity: style.opacity,
      cursor: disabled ? "not-allowed" : onClick ? "pointer" : "default",
    },
  };

  const content = (
    <>
      <LeftIcon state={state} />
      <span className="truncate whitespace-nowrap">{label}</span>
      {title ? (
        <span className="pill-tooltip-wrap flex-shrink-0">
          <InfoIcon />
          <span className="pill-tooltip">{title}</span>
        </span>
      ) : (
        <InfoIcon />
      )}
    </>
  );

  if (isButton) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} {...sharedProps}>
        {content}
      </button>
    );
  }

  return (
    <div {...sharedProps}>
      {content}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────

export default function RegistryGrid({
  mode,
  selected = [],
  onToggle,
  onSelectAll,
  onSelectNone,
  sources = [],
}: RegistryGridProps) {
  const isSelection = mode === "selection";

  const statusMap: Record<string, SourceStatus> = Object.fromEntries(
    sources.map(s => [s.sourceType, s])
  );

  return (
    <div>
      {/* ── Toolbar (selection mode only) ── */}
      {isSelection && (
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
            {selected.length} z {ENABLED_SOURCES.length} registrov
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onSelectAll}
              className="text-[11px] font-medium transition-colors hover:opacity-80"
              style={{ color: "var(--accent)" }}
            >
              Označiť všetko
            </button>
            <span style={{ color: "var(--border)" }}>·</span>
            <button
              type="button"
              onClick={onSelectNone}
              className="text-[11px] font-medium transition-colors hover:opacity-80"
              style={{ color: "var(--text-muted)" }}
            >
              Odznačiť všetko
            </button>
          </div>
        </div>
      )}

      {/* ── Masonry grid ── */}
      <div className="columns-1 md:columns-2 xl:columns-3 gap-6">
        {SOURCE_CATEGORIES.map((cat) => {
          const catSources = SOURCES.filter((s) => s.category === cat.id);
          if (catSources.length === 0) return null;

          // Selection mode helpers
          const catEnabled = catSources.filter(s => s.enabled);
          const catSelected = catEnabled.filter(s => selected.includes(s.id));
          const allCatSelected = catEnabled.length > 0 && catSelected.length === catEnabled.length;
          const someCatSelected = catSelected.length > 0 && !allCatSelected;

          // Status mode counter
          const catStatusSources = catSources
            .map(s => statusMap[s.id])
            .filter(Boolean);

          const counterText = isSelection
            ? `${catSelected.length}/${catSources.length}`
            : `${catStatusSources.length}/${catSources.length}`;

          // Determine pill state for a source
          function getPillState(source: SourceInfo): PillState {
            if (isSelection) {
              if (!source.enabled) return "disabled";
              return selected.includes(source.id) ? "idle_selected" : "idle_deselected";
            }
            const s = statusMap[source.id];
            if (!s) return "idle_deselected";
            if (s.status === "SUCCESS") return "success";
            if (s.status === "FAILED") return "error";
            if (s.status === "UNAVAILABLE") return "warning";
            return "loading";
          }

          return (
            <div
              key={cat.id}
              className="rounded-xl break-inside-avoid mb-6"
              style={{
                border: "1px solid var(--border)",
                background: "var(--surface)",
              }}
            >
              {/* Category header — always identical styling */}
              <div
                className={`flex items-center justify-between px-3 py-2 select-none rounded-t-xl ${isSelection ? "cursor-pointer transition-colors hover:bg-opacity-50" : ""}`}
                style={{ background: "var(--bg-muted)", borderBottom: "1px solid var(--border)", minHeight: "44px" }}
                onClick={isSelection ? () => {
                  if (allCatSelected) {
                    onSelectAll?.();
                  } else {
                    catEnabled.forEach(s => {
                      if (!selected.includes(s.id)) onToggle?.(s.id);
                    });
                  }
                } : undefined}
              >
                <div className="flex items-center gap-2">
                  {isSelection && (
                    <span
                      className="inline-flex items-center justify-center w-4 h-4 rounded border transition-all flex-shrink-0"
                      style={{
                        background: allCatSelected ? "var(--accent)" : someCatSelected ? "var(--accent-light)" : "var(--surface)",
                        borderColor: allCatSelected || someCatSelected ? "var(--accent)" : "var(--border)",
                      }}
                    >
                      {allCatSelected && <CheckIcon size={10} />}
                      {someCatSelected && (
                        <span style={{ background: "var(--accent)", width: "6px", height: "2px", borderRadius: "1px" }} />
                      )}
                    </span>
                  )}
                  <span className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                    {cat.label}
                  </span>
                </div>
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {counterText}
                </span>
              </div>

              {/* Source pills */}
              <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
                {catSources.map((source) => {
                  const meta = SOURCE_MAP[source.id];
                  if (!meta) return null;

                  const state = getPillState(source);
                  const statusEntry = !isSelection ? statusMap[source.id] : undefined;
                  const tooltip = meta.description ?? statusEntry?.statusMessage ?? undefined;

                  return (
                    <RegistryPill
                      key={source.id}
                      label={meta.label}
                      state={state}
                      title={tooltip}
                      onClick={isSelection && source.enabled ? () => onToggle?.(source.id) : undefined}
                      disabled={isSelection && !source.enabled}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
