import { z } from "zod";
import { SOURCE_IDS } from "@/lib/sources";

const icoRegex = /^\d{8}$/;

function isValidIco(ico: string): boolean {
  if (!icoRegex.test(ico)) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += parseInt(ico[i], 10) * (8 - i);
  return (11 - (sum % 11)) % 10 === parseInt(ico[7], 10);
}

export const reportRequestSchema = z.object({
  targetType: z.enum(["COMPANY", "PERSON"]),
  // Firma
  ico: z.string().optional().refine((val) => !val || isValidIco(val), "Neplatné IČO — nesprávna kontrolná číslica."),
  // Fyzická osoba
  name: z.string().optional(),
  surname: z.string().optional(),
  birthDate: z.string().datetime().optional(),
  sources: z.array(z.enum(SOURCE_IDS)).min(1),
});

export type ReportRequestInput = z.infer<typeof reportRequestSchema>;
