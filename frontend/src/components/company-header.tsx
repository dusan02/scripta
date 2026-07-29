import Link from "next/link";
import { fmtYear } from "@/lib/format";

type CompanyInfo = {
  ico: string;
  name: string | null;
  legalForm: string | null;
  city: string | null;
  street: string | null;
  zipCode: string | null;
  establishedAt: Date | null;
  naceText: string | null;
};

export function CompanyHeader({ company, latestYear }: { company: CompanyInfo; latestYear?: number }) {
  const name = company.name || `IČO ${company.ico}`;

  return (
    <div className="mb-8">
      <h1 className="text-2xl sm:text-3xl font-black mb-2" style={{ color: "var(--text)" }}>{name}</h1>
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-1 sm:gap-x-6 sm:gap-y-2 text-xs sm:text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
        <span><strong>IČO:</strong> {company.ico}</span>
        {company.legalForm && <span><strong>Právna forma:</strong> {company.legalForm}</span>}
        {company.city && (
          <span><strong>Sídlo:</strong> {company.street ? `${company.street}, ` : ""}{company.city}{company.zipCode ? `, ${company.zipCode}` : ""}</span>
        )}
        {company.establishedAt && <span><strong>Založená:</strong> {fmtYear(company.establishedAt)}</span>}
        {company.naceText && <span><strong>Predmet činnosti:</strong> {company.naceText}</span>}
      </div>
      <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        {name} (IČO: {company.ico}) je slovenská spoločnosť{company.city ? ` so sídlom v meste ${company.city}` : ""}
        {company.legalForm ? ` v právnej forme ${company.legalForm}` : ""}
        {company.establishedAt ? `, založená v roku ${fmtYear(company.establishedAt)}` : ""}.
        {latestYear ? ` Posledné dostupné účtovné závierky sú za rok ${latestYear}.` : ""}
      </p>
    </div>
  );
}
