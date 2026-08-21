"use client";

import { useRouter } from "next/navigation";
import { toURLSearchParams } from "@/lib/url";
import { getKrajLabel, getNaceSectionLabel, type ScreenerFilterOptions } from "@/lib/screener";

type Props = {
  searchParams: Record<string, string | string[] | undefined>;
  options: ScreenerFilterOptions;
};

const FILTER_LABELS: Record<string, string> = {
  q: "Hľadať",
  naceSection: "NACE sekcia",
  naceCode: "NACE kód",
  legalForm: "Právna forma",
  ownershipType: "Vlastníctvo",
  kraj: "Kraj",
  okres: "Okres",
  city: "Mesto",
  ageMin: "Vek od",
  ageMax: "Vek do",
  revenueMin: "Tržby od",
  revenueMax: "Tržby do",
  profitMin: "Zisk od",
  profitMax: "Zisk do",
  assetsMin: "Aktíva od",
  assetsMax: "Aktíva do",
  equityMin: "Imanie od",
  equityMax: "Imanie do",
  latestYear: "Dáta od roku",
  konkurz: "Konkurz",
  likvidacia: "Likvidácia",
  restrukturalizacia: "Reštrukturalizácia",
  vestnikClean: "Bez Vestník",
  sizeCategory: "Veľkosť",
  status: "Status",
};

export function ActiveFilterChips({ searchParams, options }: Props) {
  const router = useRouter();

  const sp = (key: string): string => {
    const v = searchParams[key];
    if (!v) return "";
    return typeof v === "string" ? v : v[0] || "";
  };

  // Build list of active filters with display labels
  const chips: Array<{ key: string; label: string; value: string }> = [];

  for (const key of Object.keys(FILTER_LABELS)) {
    const val = sp(key);
    if (!val) continue;

    // Boolean filters (konkurz, likvidacia, etc.) — value is "1"
    if (["konkurz", "likvidacia", "restrukturalizacia", "vestnikClean"].includes(key)) {
      if (val === "1") {
        chips.push({ key, label: FILTER_LABELS[key], value: "" });
      }
      continue;
    }

    // Resolve display value for select-based filters
    let displayValue = val;
    if (key === "kraj") {
      displayValue = getKrajLabel(val) || val;
    } else if (key === "naceSection") {
      displayValue = getNaceSectionLabel(val) || val;
    } else if (key === "legalForm") {
      const opt = options.legalForms.find(o => o.value === val);
      displayValue = opt?.label || val;
    } else if (key === "ownershipType") {
      const opt = options.ownershipTypes.find(o => o.value === val);
      displayValue = opt?.label || val;
    } else if (key === "city") {
      const opt = options.cities.find(o => o.value === val);
      displayValue = opt?.label || val;
    } else if (key === "okres") {
      const opt = options.okresy.find(o => o.value === val);
      displayValue = opt?.label || val;
    } else if (key === "sizeCategory") {
      const opt = options.sizeCategories?.find(o => o.value === val);
      displayValue = opt?.label || val;
    } else if (key === "status") {
      const opt = options.statuses?.find(o => o.value === val);
      displayValue = opt?.label || val;
    }

    chips.push({ key, label: FILTER_LABELS[key], value: displayValue });
  }

  if (chips.length === 0) return null;

  const removeFilter = (key: string) => {
    const params = toURLSearchParams(searchParams);
    params.delete(key);
    params.delete("page");
    router.push(`/screener?${params.toString()}`);
  };

  const clearAll = () => {
    router.push("/screener");
  };

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      {chips.map((chip) => (
        <button
          key={chip.key}
          onClick={() => removeFilter(chip.key)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors hover:opacity-80"
          style={{
            background: "var(--accent-light)",
            color: "var(--accent)",
            border: "1px solid var(--accent-border)",
          }}
          title={`Odstrániť filter: ${chip.label}`}
        >
          <span>{chip.label}{chip.value ? `: ${chip.value}` : ""}</span>
          <span style={{ fontSize: "14px", lineHeight: 1 }}>×</span>
        </button>
      ))}
      <button
        onClick={clearAll}
        className="text-xs px-2 py-1 rounded-full transition-colors hover:opacity-80"
        style={{ color: "var(--text-muted)" }}
      >
        Zrušiť všetky
      </button>
    </div>
  );
}
