import { z } from "zod";
import { SOURCE_IDS } from "@/lib/sources";

export const reportRequestSchema = z.object({
  targetType: z.literal("COMPANY"),
  ico: z.string().regex(/^\d{8}$/, "IČO musí obsahovať presne 8 číslic"),
  sources: z.array(z.enum(SOURCE_IDS)).min(1, "Musíte zvoliť aspoň jeden zdroj"),
});

export type ReportRequestInput = z.infer<typeof reportRequestSchema>;

