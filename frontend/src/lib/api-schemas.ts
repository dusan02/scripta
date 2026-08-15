import { z } from "zod";

// ── Shared schemas for API input validation ──────────────────────────────────

export const icoSchema = z.string().regex(/^\d{8}$/, "IČO musí obsahovať 8 číslic");

export const emailSchema = z.string().email("Neplatný e-mail").max(254);

export const cuidSchema = z.string().min(20).max(30);

// ── Auth ──────────────────────────────────────────────────────────────────────

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const verifyEmailSchema = z.object({
  token: z.string().min(16, "Chýba verifikačný token"),
});

// ── Feedback ──────────────────────────────────────────────────────────────────

export const feedbackSchema = z.object({
  category: z.enum(["BUG", "IMPROVEMENT", "QUESTION", "OTHER"]),
  message: z.string().trim().min(1, "Správa je povinná").max(5000),
  requestId: z.string().max(100).optional(),
});

// ── Messages ──────────────────────────────────────────────────────────────────

export const messageCreateSchema = z.object({
  title: z.string().trim().min(1, "Predmet je povinný").max(200),
  message: z.string().trim().min(1, "Správa je povinná").max(5000),
});

export const messageMarkReadSchema = z.object({
  messageIds: z.array(z.string().min(1)).min(1).max(100),
});

// ── Settings ──────────────────────────────────────────────────────────────────

export const settingsPatchSchema = z.object({
  orsrExtractType: z.enum(["CURRENT", "FULL"]).optional(),
  crzDateFrom: z.union([z.string().date(), z.null()]).optional(),
  rozhodnutiaDateFrom: z.union([z.string().date(), z.null()]).optional(),
  vestnikDateFrom: z.union([z.string().date(), z.null()]).optional(),
  defaultSources: z.array(z.string()).optional(),
  reportLanguage: z.string().max(10).optional(),
  attachmentsConfig: z.record(z.string(), z.boolean()).nullable().optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: "No fields to update" }
);

// ── Account deletion ──────────────────────────────────────────────────────────

export const accountDeleteSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

// ── Watched companies ─────────────────────────────────────────────────────────

export const watchedCompanyCreateSchema = z.object({
  companyId: z.string().regex(/^\d{8}$/, "Valid 8-digit IČO is required"),
  note: z.string().max(500).optional(),
});

// ── Billing ───────────────────────────────────────────────────────────────────

export const checkoutSchema = z.object({
  planId: z.string().min(1, "Plan ID required"),
});

export const confirmSchema = z.object({
  transactionId: z.string().min(1, "Transaction ID required").max(200),
});

// ── Revalidate ────────────────────────────────────────────────────────────────

export const revalidateSchema = z.object({
  type: z.enum(["all", "path"]).default("all"),
  path: z.string().max(500).optional(),
}).refine(
  (data) => data.type !== "path" || (data.path != null && data.path.length > 0),
  { message: "path is required when type is 'path'" }
);

// ── Alert events ──────────────────────────────────────────────────────────────

export const alertListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
