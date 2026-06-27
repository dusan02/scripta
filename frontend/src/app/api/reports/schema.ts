import { z } from "zod";
import { SOURCE_IDS } from "@/lib/sources";

export const reportRequestSchema = z.object({
  targetType: z.literal("COMPANY"),
  ico: z.string(),
  sources: z.array(z.enum(SOURCE_IDS)).min(1),
});

export type ReportRequestInput = z.infer<typeof reportRequestSchema>;

