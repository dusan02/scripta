export interface LiveRegistryDef {
  source: string;
  label: string;
  fullLabel: string;
  authority: string;
  description: string;
}

export const LIVE_CHECK_REGISTRIES: readonly LiveRegistryDef[] = [
  {
    source: "SP_DLZNICI",
    label: "Sociálna poisťovňa",
    fullLabel: "Sociálna poisťovňa SR — Zoznam dlžníkov",
    authority: "socpoist.sk",
    description: "Kontrola evidovaných nedoplatkov na sociálnom poistení a chýbajúcich výkazov",
  },
  {
    source: "VSZP_DLZNICI",
    label: "VšZP",
    fullLabel: "Všeobecná zdravotná poisťovňa — Zoznam dlžníkov",
    authority: "vszp.sk",
    description: "Kontrola evidovaných nedoplatkov na verejnom zdravotnom poistení vo VšZP",
  },
  {
    source: "DOVERA_DLZNICI",
    label: "Dôvera",
    fullLabel: "Dôvera zdravotná poisťovňa — Zoznam dlžníkov",
    authority: "dovera.sk",
    description: "Kontrola evidovaných nedoplatkov na zdravotnom poistení v poisťovni Dôvera",
  },
  {
    source: "UNION_DLZNICI",
    label: "Union",
    fullLabel: "Union zdravotná poisťovňa — Zoznam dlžníkov",
    authority: "union.sk",
    description: "Kontrola evidovaných nedoplatkov na zdravotnom poistení v poisťovni Union",
  },
  {
    source: "FS_DPH_RUSENIE",
    label: "Finančná správa (DPH)",
    fullLabel: "Finančná správa SR — Riziko zrušenia DPH",
    authority: "financnasprava.sk",
    description: "Zoznam platiteľov DPH, u ktorých nastali dôvody na zrušenie registrácie",
  },
  {
    source: "FS_DANOVE_DLZNICI",
    label: "Finančná správa (dlžníci)",
    fullLabel: "Finančná správa SR — Zoznam daňových dlžníkov",
    authority: "financnasprava.sk",
    description: "Kontrola evidovaných daňových nedoplatkov v zozname daňových dlžníkov",
  },
  {
    source: "INSOLVENCY",
    label: "Register úpadcov SR",
    fullLabel: "Register predinsolvenčných, likvidačných a insolvenčných konaní SR",
    authority: "replik.justice.sk",
    description: "Kontrola aktívnych konkurzných, reštrukturalizačných a likvidačných konaní",
  },
] as const;

export type LiveCheckItemState = "IDLE" | "RUNNING" | "CLEAN" | "DEBT" | "UNAVAILABLE" | "AMBIGUOUS";

export interface LiveCheckItem {
  source: string;
  label: string;
  fullLabel: string;
  authority: string;
  state: LiveCheckItemState;
  description: string;
  amount: number | null;
  checkedAt: string | null;
}

export interface LiveCheckSummary {
  ico: string;
  hasCheck: boolean;
  isRunning: boolean;
  isFresh: boolean;
  lastCheckedAt: string | null;
  cleanCount: number;
  debtCount: number;
  unavailableCount: number;
  totalDebtEur: number;
  items: LiveCheckItem[];
}

/**
 * Phase 1 vs Phase 2 monetization toggle:
 * - false (Phase 1 — habit & traffic growth): show all parsed registry results
 *   and debt amounts for free on the page.
 * - true (Phase 2 — conversion): keep CLEAN statuses visible, but blur exact
 *   debt amounts/details on DEBT findings behind registration / 3.90 € unlock.
 */
export const LOCK_DEBT_DETAILS = false;

/** Results stay fresh for 7 days before allowing a new Playwright run. */
export const LIVE_CHECK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A RUNNING check older than 300s is treated as stale/timed-out.
 *  Must exceed the real duration of a 7-registry Playwright run (FS portal
 *  with retries can take 60-180s); if it fires early, polling stops and the
 *  UI permanently shows UNAVAILABLE even though the worker writes the real
 *  result seconds later. */
export const LIVE_CHECK_RUNNING_TIMEOUT_MS = 300 * 1000;

export function buildLiveCheckSummary(
  ico: string,
  events: Array<{
    source: string;
    eventType: string;
    severity: string;
    title: string;
    description: string;
    amount: any;
    metadata?: any;
    createdAt: Date | string;
  }> = []
): LiveCheckSummary {
  const checkEvents = events.filter((e) => e.eventType === "LIVE_REGISTRY_CHECK");
  const bySource = new Map<string, (typeof checkEvents)[number]>();
  for (const ev of checkEvents) {
    const prev = bySource.get(ev.source);
    if (!prev || new Date(ev.createdAt).getTime() > new Date(prev.createdAt).getTime()) {
      bySource.set(ev.source, ev);
    }
  }

  let latestTs = 0;
  let isRunning = false;
  let cleanCount = 0;
  let debtCount = 0;
  let unavailableCount = 0;
  let totalDebtEur = 0;

  const now = Date.now();

  const items: LiveCheckItem[] = LIVE_CHECK_REGISTRIES.map((reg) => {
    const ev = bySource.get(reg.source);
    if (!ev) {
      return {
        source: reg.source,
        label: reg.label,
        fullLabel: reg.fullLabel,
        authority: reg.authority,
        state: "IDLE",
        description: reg.description,
        amount: null,
        checkedAt: null,
      };
    }

    const createdMs = new Date(ev.createdAt).getTime();
    if (createdMs > latestTs) latestTs = createdMs;

    const meta = (ev.metadata && typeof ev.metadata === "object" ? ev.metadata : {}) as Record<string, any>;
    let rawState: LiveCheckItemState =
      meta.state === "RUNNING" || meta.state === "CLEAN" || meta.state === "DEBT" || meta.state === "UNAVAILABLE" || meta.state === "AMBIGUOUS"
        ? meta.state
        : ev.severity === "HIGH" || ev.severity === "CRITICAL"
          ? "DEBT"
          : ev.severity === "INFO"
            ? "CLEAN"
            : "UNAVAILABLE";

    if (rawState === "RUNNING" && now - createdMs > LIVE_CHECK_RUNNING_TIMEOUT_MS) {
      rawState = "UNAVAILABLE";
    }

    if (rawState === "RUNNING") isRunning = true;
    else if (rawState === "CLEAN") cleanCount++;
    else if (rawState === "DEBT") debtCount++;
    else if (rawState === "UNAVAILABLE" || rawState === "AMBIGUOUS") unavailableCount++;

    const amt = ev.amount != null ? Number(ev.amount) : null;
    const validAmt = amt != null && Number.isFinite(amt) && amt > 0 ? amt : null;
    if (rawState === "DEBT" && validAmt) {
      totalDebtEur += validAmt;
    }

    return {
      source: reg.source,
      label: reg.label,
      fullLabel: reg.fullLabel,
      authority: reg.authority,
      state: rawState,
      description: ev.description || reg.description,
      amount: validAmt,
      checkedAt: meta.checkedAt || new Date(ev.createdAt).toISOString(),
    };
  });

  const hasCheck = bySource.size > 0;
  const isFresh = hasCheck && !isRunning && latestTs > 0 && now - latestTs < LIVE_CHECK_TTL_MS;

  return {
    ico,
    hasCheck,
    isRunning,
    isFresh,
    lastCheckedAt: latestTs > 0 ? new Date(latestTs).toISOString() : null,
    cleanCount,
    debtCount,
    unavailableCount,
    totalDebtEur,
    items,
  };
}
