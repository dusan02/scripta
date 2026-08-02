import Link from "next/link";
import { fmtYear } from "@/lib/format";
import { useT } from "@/components/LanguageProvider";

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
  const t = useT();
  const name = company.name || `${t("company.ico")} ${company.ico}`;

  const cityPart = company.city ? t("company.descCity", { city: company.city }) : "";
  const legalFormPart = company.legalForm ? t("company.descLegalForm", { legalForm: company.legalForm }) : "";
  const establishedPart = company.establishedAt ? t("company.descEstablished", { year: fmtYear(company.establishedAt) }) : "";
  const nacePart = company.naceText ? t("company.descNace", { nace: company.naceText }) : "";
  const latestYearPart = latestYear ? t("company.descLatestYear", { year: String(latestYear) }) : "";

  return (
    <div className="mb-8">
      <h1 className="text-2xl sm:text-3xl font-black mb-2" style={{ color: "var(--text)" }}>{name}</h1>
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-1 sm:gap-x-6 sm:gap-y-2 text-xs sm:text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
        <span><strong>{t("company.ico")}:</strong> {company.ico}</span>
        {company.legalForm && <span><strong>{t("company.pravnaForma")}:</strong> {company.legalForm}</span>}
        {company.city && (
          <span><strong>{t("firma.sidlo")}:</strong> {company.street ? `${company.street}, ` : ""}{company.city}{company.zipCode ? `, ${company.zipCode}` : ""}</span>
        )}
        {company.establishedAt && <span><strong>{t("firma.zalozena")}:</strong> {fmtYear(company.establishedAt)}</span>}
        {company.naceText && <span><strong>{t("firma.predmetCinnosti")}:</strong> {company.naceText}</span>}
      </div>
      <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        {t("company.desc", { name, ico: company.ico, city: cityPart, legalForm: legalFormPart, established: establishedPart, nace: nacePart })}{latestYearPart}
      </p>
    </div>
  );
}
