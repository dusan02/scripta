import { z } from "zod";
import { SOURCE_IDS, SOURCE_COSTS, calculateCost } from "@/lib/sources";

export const reportRequestSchema = z.object({
  targetType: z.enum(["COMPANY", "PERSON"]),
  // Firma
  ico: z.string().optional(),
  // Fyzická osoba
  name: z.string().optional(),
  surname: z.string().optional(),
  birthDate: z.string().datetime().optional(),
  sources: z.array(z.enum(SOURCE_IDS)).min(1),
});

export type ReportRequestInput = z.infer<typeof reportRequestSchema>;

export { SOURCE_COSTS, calculateCost };
