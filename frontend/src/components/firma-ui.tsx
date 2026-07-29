import { fmtNum } from "@/lib/format";

const ROWS = [
  { label: "Tržby", key: "mainActivityRevenue" },
  { label: "Hrubá marža", key: "grossProfit" },
  { label: "Zisk/Strata", key: "netProfitLoss" },
  { label: "Celkové aktíva", key: "totalAssets" },
  { label: "Obezný majetok", key: "currentAssets" },
  { label: "Vlastné imanie", key: "equity" },
  { label: "Zásoby", key: "inventory" },
  { label: "Pohľadávky", key: "tradeReceivables" },
  { label: "Osobné náklady", key: "staffCosts" },
  { label: "Odpisy", key: "depreciation" },
];

export function FinancialTable({ stmts }: { stmts: any[] }) {
  const sorted = [...stmts].sort((a, b) => a.year - b.year);

  return (
    <div className="overflow-x-auto">
      <table className="w-full" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--border)" }}>
            <th className="text-left py-2 px-2 font-semibold" style={{ color: "var(--text-muted)" }}>Ukazovateľ</th>
            {sorted.map(s => (
              <th key={s.year} className="text-right py-2 px-2 font-semibold" style={{ color: "var(--text-muted)" }}>{s.year}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.key} style={{ borderBottom: "1px solid var(--border)" }}>
              <td className="py-2 px-2" style={{ color: "var(--text-secondary)" }}>{row.label}</td>
              {sorted.map(s => (
                <td key={s.year} className="text-right py-2 px-2" style={{ color: "var(--text)", fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace", fontVariantNumeric: "tabular-nums" }}>
                  {fmtNum(s[row.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MetricCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>{label}</p>
      <div className="text-xl font-black" style={{ color }}>{value}</div>
      {sub && <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{sub}</p>}
    </div>
  );
}

export function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <h3 className="text-sm font-bold mb-4" style={{ color: "var(--text)" }}>{title}</h3>
      {children}
    </div>
  );
}
