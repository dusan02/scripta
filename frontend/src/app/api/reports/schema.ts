import { z } from "zod";

export const reportRequestSchema = z.object({
  targetType: z.enum(["COMPANY", "PERSON"]),
  // Firma
  ico: z.string().optional(),
  // Fyzická osoba
  name: z.string().optional(),
  surname: z.string().optional(),
  birthDate: z.string().datetime().optional(),
  sources: z.array(z.enum(["ORSR", "ZRSR", "INSOLVENCY", "CRE"])).min(1),
});

export type ReportRequestInput = z.infer<typeof reportRequestSchema>;

export const SOURCE_COSTS: Record<string, number> = {
  ORSR: 0,
  ZRSR: 0,
  INSOLVENCY: 0,
  CRE: 5, // platený register
};

export function calculateCost(sources: string[]) {
  return sources.reduce((sum, source) => sum + (SOURCE_COSTS[source] ?? 0), 0);
}
