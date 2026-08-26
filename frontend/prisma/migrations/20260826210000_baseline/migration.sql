-- CreateEnum
CREATE TYPE "FeedbackCategory" AS ENUM ('BUG', 'IMPROVEMENT', 'QUESTION', 'OTHER');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('ANNOUNCEMENT', 'REPLY', 'SYSTEM', 'USER');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'PADDLE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'PARTIAL', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('ORSR', 'ZRSR', 'RPO', 'RPVS', 'OBCHODNY_VESTNIK', 'INSOLVENCY', 'POVERENIA', 'FINANCNA_SPRAVA', 'SP_DLZNICI', 'VSZP_DLZNICI', 'DOVERA_DLZNICI', 'UNION_DLZNICI', 'CRRS', 'DISKVALIFIKACIE', 'NCRZP', 'NCRD', 'OCHRANNE_ZNAMKY', 'FS_DANOVE_SUBJEKTY', 'FS_DPH_REGISTROVANI', 'FS_DPH_RUSENIE', 'FS_DPH_VYMAZANI', 'FS_DPH_NADMERNY_ODPOCET', 'FS_DPH_BANKOVE_UCTY', 'FS_DAN_Z_PRIJMOV', 'FS_DAN_PRIJMOV_REG', 'REGISTER_UZ', 'CRZ', 'UVO', 'ROZHODNUTIA');

-- CreateEnum
CREATE TYPE "TargetType" AS ENUM ('COMPANY');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('CHARGE', 'TOPUP', 'REFUND', 'REFUND_DEDUCTION');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('LAWYER', 'ADMIN');

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertDelivery" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AlertDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "riskScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditVerdict" (
    "id" TEXT NOT NULL,
    "companyIco" TEXT NOT NULL,
    "verifaScore" INTEGER NOT NULL,
    "riskCategory" TEXT NOT NULL,
    "debtExposureRating" INTEGER,
    "finalVerdict" TEXT NOT NULL,
    "executiveSummary" TEXT,
    "justification" TEXT NOT NULL,
    "keyRisk" TEXT NOT NULL,
    "scorecardBreakdown" JSONB,
    "llmScoreAdjustment" INTEGER DEFAULT 0,
    "llmAnalysisStatus" TEXT NOT NULL DEFAULT 'LLM_ANALYZED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adjustmentBreakdown" TEXT,
    "executiveSections" TEXT,
    "findings" JSONB,

    CONSTRAINT "AuditVerdict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditorOpinion" (
    "id" TEXT NOT NULL,
    "financialStatementId" TEXT NOT NULL,
    "opinionType" TEXT NOT NULL,
    "goingConcernRisk" BOOLEAN NOT NULL,
    "reservationText" TEXT,

    CONSTRAINT "AuditorOpinion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "ico" TEXT NOT NULL,
    "name" TEXT,
    "legalForm" TEXT,
    "city" TEXT,
    "street" TEXT,
    "zipCode" TEXT,
    "country" TEXT,
    "establishedAt" TIMESTAMP(3),
    "status" TEXT,
    "naceCode" TEXT,
    "naceText" TEXT,
    "ownershipType" TEXT,
    "sizeCategory" TEXT,
    "employeeCount" INTEGER,
    "ruzEntityId" INTEGER,
    "orsrSyncedAt" TIMESTAMP(3),
    "ruzSyncedAt" TIMESTAMP(3),
    "shareCapital" DECIMAL(15,2),
    "businessActivity" TEXT,
    "signingAuthority" TEXT,
    "latestYear" INTEGER,
    "latestRevenue" DECIMAL(15,2),
    "latestProfit" DECIMAL(15,2),
    "latestAssets" DECIMAL(15,2),
    "latestEquity" DECIMAL(15,2),
    "kraj" TEXT,
    "okres" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "legalStatus" TEXT,
    "legalStatusObservedAt" TIMESTAMP(3),
    "legalStatusSource" TEXT,
    "ruzDissolutionDate" TIMESTAMP(3),
    "ruzReportingStatus" TEXT,
    "sizeCategoryNormalized" TEXT,
    "statusNormalized" TEXT,
    "vestnikSyncedAt" TIMESTAMP(3),

    CONSTRAINT "Company_pkey" PRIMARY KEY ("ico")
);

-- CreateTable
CREATE TABLE "CompanyEvent" (
    "id" TEXT NOT NULL,
    "companyIco" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3),
    "amount" DECIMAL(15,2),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyPerson" (
    "id" TEXT NOT NULL,
    "companyIco" TEXT NOT NULL,
    "rawName" TEXT NOT NULL,
    "cleanName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "city" TEXT,
    "street" TEXT,
    "zipCode" TEXT,
    "functionStart" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "functionEnd" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CompanyPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "planName" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "FeedbackCategory" NOT NULL,
    "requestId" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reply" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialStatement" (
    "id" TEXT NOT NULL,
    "companyIco" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "totalAssets" DECIMAL(15,2),
    "currentAssets" DECIMAL(15,2),
    "equity" DECIMAL(15,2),
    "shortTermLiabilities" DECIMAL(15,2),
    "longTermLiabilities" DECIMAL(15,2),
    "mainActivityRevenue" DECIMAL(15,2),
    "grossProfit" DECIMAL(15,2),
    "netProfitLoss" DECIMAL(15,2),
    "cashAndEquivalents" DECIMAL(15,2),
    "operatingCashFlow" DECIMAL(15,2),
    "staffCosts" DECIMAL(15,2),
    "tradeReceivables" DECIMAL(15,2),
    "tradePayables" DECIMAL(15,2),
    "inventory" DECIMAL(15,2),
    "depreciation" DECIMAL(15,2),
    "investingCashFlow" DECIMAL(15,2),
    "financingCashFlow" DECIMAL(15,2),
    "interestExpense" DECIMAL(15,2),
    "incomeTax" DECIMAL(15,2),
    "employeeCount" INTEGER,
    "socialInsuranceLiabilities" DECIMAL(15,2),
    "taxLiabilities" DECIMAL(15,2),
    "employeeLiabilities" DECIMAL(15,2),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "statementType" TEXT NOT NULL DEFAULT 'SK_GAAP',
    "monthsInPeriod" INTEGER DEFAULT 12,
    "isConsolidated" BOOLEAN NOT NULL DEFAULT false,
    "nonCurrentAssets" DECIMAL(15,2),
    "intangibleAssets" DECIMAL(15,2),
    "tangibleAssets" DECIMAL(15,2),
    "ltFinancialAssets" DECIMAL(15,2),
    "ltReceivables" DECIMAL(15,2),
    "stFinancialAssets" DECIMAL(15,2),
    "deferredAssets" DECIMAL(15,2),
    "shareCapital" DECIMAL(15,2),
    "sharePremium" DECIMAL(15,2),
    "otherCapitalFunds" DECIMAL(15,2),
    "statutoryReserveFunds" DECIMAL(15,2),
    "otherProfitFunds" DECIMAL(15,2),
    "retainedEarnings" DECIMAL(15,2),
    "retainedProfit" DECIMAL(15,2),
    "accumulatedLoss" DECIMAL(15,2),
    "currentYearProfit" DECIMAL(15,2),
    "ltReserves" DECIMAL(15,2),
    "stReserves" DECIMAL(15,2),
    "stBankLoans" DECIMAL(15,2),
    "stFinancialAssistance" DECIMAL(15,2),
    "operatingCosts" DECIMAL(15,2),
    "materialConsumption" DECIMAL(15,2),
    "servicesCosts" DECIMAL(15,2),
    "wageCosts" DECIMAL(15,2),
    "taxesFees" DECIMAL(15,2),
    "financialResult" DECIMAL(15,2),
    "profitBeforeTax" DECIMAL(15,2),
    "profitTransfer" DECIMAL(15,2),
    "statementDate" TEXT,
    "approvalDate" TEXT,
    "ruzZavierkaId" INTEGER,
    "ruzVykazId" INTEGER,
    "dataQualityStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NaceCode" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "section" TEXT,
    "sectionName" TEXT,
    "class" TEXT,
    "className" TEXT,
    "descriptionEn" TEXT,
    "division" TEXT,
    "divisionName" TEXT,
    "group" TEXT,
    "groupName" TEXT,
    "sectionNameEn" TEXT,

    CONSTRAINT "NaceCode_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "NarrativeRiskAnalysis" (
    "id" TEXT NOT NULL,
    "financialStatementId" TEXT NOT NULL,
    "managementChanges" TEXT,
    "litigationRisks" TEXT,
    "goingConcernDoubts" BOOLEAN NOT NULL,
    "plannedInvestments" TEXT,
    "profitabilityExplanation" TEXT,
    "forensicRedFlags" TEXT[],
    "synthesis" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessDevelopments" TEXT,
    "sourcePages" TEXT,
    "strengthsAndOpportunities" TEXT,

    CONSTRAINT "NarrativeRiskAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotesRiskAnalysis" (
    "id" TEXT NOT NULL,
    "financialStatementId" TEXT NOT NULL,
    "relatedPartyTransactions" TEXT,
    "offBalanceSheetLiabilities" TEXT,
    "contingentRisks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acquisitionsAndDisposals" TEXT,
    "capitalChanges" TEXT,
    "financingActivities" TEXT,
    "provisionsAndReserves" TEXT,
    "restructuringActivities" TEXT,
    "significantInvestments" TEXT,
    "sourcePages" TEXT,
    "subsequentEvents" TEXT,

    CONSTRAINT "NotesRiskAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportFinancialSnapshot" (
    "id" TEXT NOT NULL,
    "reportRequestId" TEXT NOT NULL,
    "companyIco" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL DEFAULT 'v1',
    "scoringVersion" TEXT NOT NULL DEFAULT 'v3-candidate',
    "companyIdentity" JSONB NOT NULL,
    "financialStatements" JSONB NOT NULL,
    "auditorOpinions" JSONB,
    "narrativeRisk" JSONB,
    "notesRisk" JSONB,
    "companyEvents" JSONB,
    "vestnikEvents" JSONB,
    "registryFindings" JSONB,
    "scoringInputs" JSONB,
    "sourceMetadata" JSONB,
    "inputDataHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportFinancialSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "targetType" "TargetType" NOT NULL,
    "ico" TEXT,
    "companyName" TEXT,
    "selectedSources" "SourceType"[],
    "resultUrl" TEXT,
    "resultFilePath" TEXT,
    "completedAt" TIMESTAMP(3),
    "aiStatus" TEXT,
    "eta" INTEGER,
    "verifaScore" INTEGER,
    "scrapersMs" INTEGER,
    "aiMs" INTEGER,
    "auditorMs" INTEGER,
    "compileMs" INTEGER,
    "attachmentsConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ReportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSource" (
    "id" TEXT NOT NULL,
    "reportRequestId" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "status" "SourceStatus" NOT NULL DEFAULT 'PENDING',
    "statusMessage" TEXT,
    "filePath" TEXT,
    "pageCount" INTEGER,
    "findings" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoringSnapshot" (
    "id" TEXT NOT NULL,
    "companyIco" TEXT NOT NULL,
    "reportRequestId" TEXT,
    "scoringVersion" TEXT NOT NULL DEFAULT 'v3',
    "financialYear" INTEGER,
    "baseScore" INTEGER NOT NULL,
    "finalScore" INTEGER NOT NULL,
    "riskCategory" TEXT NOT NULL,
    "adjustmentTotal" INTEGER NOT NULL DEFAULT 0,
    "adjustments" JSONB NOT NULL,
    "isConsolidated" BOOLEAN NOT NULL DEFAULT false,
    "financialBasis" TEXT NOT NULL DEFAULT 'individual',
    "llmAdjustment" INTEGER DEFAULT 0,
    "llmAdjustmentReason" TEXT,
    "whOverrideRefund" INTEGER DEFAULT 0,
    "inputDataHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auditVerdictId" TEXT,
    "reportFinancialSnapshotId" TEXT,

    CONSTRAINT "ScoringSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "emailVerified" TIMESTAMP(3),
    "role" "UserRole" NOT NULL DEFAULT 'LAWYER',
    "orsrExtractType" TEXT NOT NULL DEFAULT 'CURRENT',
    "crzDateFrom" TIMESTAMP(3),
    "rozhodnutiaDateFrom" TIMESTAMP(3),
    "vestnikDateFrom" TIMESTAMP(3),
    "defaultSources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reportLanguage" TEXT NOT NULL DEFAULT 'sk',
    "attachmentsConfig" JSONB,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "planName" TEXT,
    "planRenewalDate" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "subscriptionStatus" TEXT,
    "subscriptionEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "emailBounced" BOOLEAN NOT NULL DEFAULT false,
    "emailBouncedAt" TIMESTAMP(3),
    "emailBouncedReason" TEXT,
    "emailComplained" BOOLEAN NOT NULL DEFAULT false,
    "emailComplainedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "screenerPrefs" JSONB,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "senderId" TEXT,
    "type" "MessageType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "feedbackId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "UserMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VestnikEvent" (
    "id" TEXT NOT NULL,
    "companyIco" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "severityLevel" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VestnikEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VestnikSyncCheckpoint" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "lastId" INTEGER,
    "sinceTimestamp" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRunSuccess" BOOLEAN NOT NULL DEFAULT false,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "eventsFetched" INTEGER NOT NULL DEFAULT 0,
    "matchedCompanies" INTEGER NOT NULL DEFAULT 0,
    "savedEvents" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VestnikSyncCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "reportRequestId" TEXT,
    "provider" "PaymentProvider",
    "providerReference" TEXT,
    "eventId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchedCompany" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WatchedCompany_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminUserId_createdAt_idx" ON "AdminAuditLog"("adminUserId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "AlertDelivery_deletedAt_idx" ON "AlertDelivery"("deletedAt" ASC);

-- CreateIndex
CREATE INDEX "AlertDelivery_userId_status_idx" ON "AlertDelivery"("userId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "AlertEvent_companyId_createdAt_idx" ON "AlertEvent"("companyId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "AlertEvent_deletedAt_idx" ON "AlertEvent"("deletedAt" ASC);

-- CreateIndex
CREATE INDEX "AlertEvent_source_eventType_idx" ON "AlertEvent"("source" ASC, "eventType" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "AuditVerdict_companyIco_key" ON "AuditVerdict"("companyIco" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "AuditorOpinion_financialStatementId_key" ON "AuditorOpinion"("financialStatementId" ASC);

-- CreateIndex
CREATE INDEX "Company_city_idx" ON "Company"("city" ASC);

-- CreateIndex
CREATE INDEX "Company_establishedAt_idx" ON "Company"("establishedAt" ASC);

-- CreateIndex
CREATE INDEX "Company_kraj_idx" ON "Company"("kraj" ASC);

-- CreateIndex
CREATE INDEX "Company_latestAssets_idx" ON "Company"("latestAssets" DESC);

-- CreateIndex
CREATE INDEX "Company_latestEquity_idx" ON "Company"("latestEquity" DESC);

-- CreateIndex
CREATE INDEX "Company_latestProfit_idx" ON "Company"("latestProfit" DESC);

-- CreateIndex
CREATE INDEX "Company_latestRevenue_idx" ON "Company"("latestRevenue" DESC);

-- CreateIndex
CREATE INDEX "Company_legalForm_idx" ON "Company"("legalForm" ASC);

-- CreateIndex
CREATE INDEX "Company_legalStatus_idx" ON "Company"("legalStatus" ASC);

-- CreateIndex
CREATE INDEX "Company_naceCode_idx" ON "Company"("naceCode" ASC);

-- CreateIndex
CREATE INDEX "Company_name_idx" ON "Company"("name" ASC);

-- CreateIndex
CREATE INDEX "Company_okres_idx" ON "Company"("okres" ASC);

-- CreateIndex
CREATE INDEX "Company_orsrSyncedAt_idx" ON "Company"("orsrSyncedAt" ASC);

-- CreateIndex
CREATE INDEX "Company_ruzReportingStatus_idx" ON "Company"("ruzReportingStatus" ASC);

-- CreateIndex
CREATE INDEX "Company_ruzSyncedAt_idx" ON "Company"("ruzSyncedAt" ASC);

-- CreateIndex
CREATE INDEX "Company_sizeCategoryNormalized_idx" ON "Company"("sizeCategoryNormalized" ASC);

-- CreateIndex
CREATE INDEX "Company_sizeCategory_idx" ON "Company"("sizeCategory" ASC);

-- CreateIndex
CREATE INDEX "Company_statusNormalized_idx" ON "Company"("statusNormalized" ASC);

-- CreateIndex
CREATE INDEX "Company_status_idx" ON "Company"("status" ASC);

-- CreateIndex
CREATE INDEX "Company_vestnikSyncedAt_idx" ON "Company"("vestnikSyncedAt" ASC);

-- CreateIndex
CREATE INDEX "CompanyEvent_companyIco_idx" ON "CompanyEvent"("companyIco" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyEvent_companyIco_source_eventType_eventDate_amount_key" ON "CompanyEvent"("companyIco" ASC, "source" ASC, "eventType" ASC, "eventDate" ASC, "amount" ASC);

-- CreateIndex
CREATE INDEX "CompanyEvent_severity_idx" ON "CompanyEvent"("severity" ASC);

-- CreateIndex
CREATE INDEX "CompanyPerson_companyIco_idx" ON "CompanyPerson"("companyIco" ASC);

-- CreateIndex
CREATE INDEX "CompanyPerson_companyIco_isActive_idx" ON "CompanyPerson"("companyIco" ASC, "isActive" ASC);

-- CreateIndex
CREATE INDEX "CompanyPerson_role_idx" ON "CompanyPerson"("role" ASC);

-- CreateIndex
CREATE INDEX "CreditBatch_userId_createdAt_idx" ON "CreditBatch"("userId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "CreditBatch_userId_expiresAt_idx" ON "CreditBatch"("userId" ASC, "expiresAt" ASC);

-- CreateIndex
CREATE INDEX "Feedback_status_idx" ON "Feedback"("status" ASC);

-- CreateIndex
CREATE INDEX "Feedback_userId_idx" ON "Feedback"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "FinancialStatement_companyIco_year_key" ON "FinancialStatement"("companyIco" ASC, "year" ASC);

-- CreateIndex
CREATE INDEX "NaceCode_division_idx" ON "NaceCode"("division" ASC);

-- CreateIndex
CREATE INDEX "NaceCode_section_idx" ON "NaceCode"("section" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "NarrativeRiskAnalysis_financialStatementId_key" ON "NarrativeRiskAnalysis"("financialStatementId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "NotesRiskAnalysis_financialStatementId_key" ON "NotesRiskAnalysis"("financialStatementId" ASC);

-- CreateIndex
CREATE INDEX "PasswordResetToken_email_idx" ON "PasswordResetToken"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_email_token_key" ON "PasswordResetToken"("email" ASC, "token" ASC);

-- CreateIndex
CREATE INDEX "PasswordResetToken_expires_idx" ON "PasswordResetToken"("expires" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token" ASC);

-- CreateIndex
CREATE INDEX "ReportFinancialSnapshot_companyIco_idx" ON "ReportFinancialSnapshot"("companyIco" ASC);

-- CreateIndex
CREATE INDEX "ReportFinancialSnapshot_createdAt_idx" ON "ReportFinancialSnapshot"("createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ReportFinancialSnapshot_reportRequestId_key" ON "ReportFinancialSnapshot"("reportRequestId" ASC);

-- CreateIndex
CREATE INDEX "ReportRequest_deletedAt_idx" ON "ReportRequest"("deletedAt" ASC);

-- CreateIndex
CREATE INDEX "ReportRequest_status_idx" ON "ReportRequest"("status" ASC);

-- CreateIndex
CREATE INDEX "ReportRequest_userId_createdAt_idx" ON "ReportRequest"("userId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "ReportSource_reportRequestId_idx" ON "ReportSource"("reportRequestId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ReportSource_reportRequestId_sourceType_key" ON "ReportSource"("reportRequestId" ASC, "sourceType" ASC);

-- CreateIndex
CREATE INDEX "ReportSource_sourceType_idx" ON "ReportSource"("sourceType" ASC);

-- CreateIndex
CREATE INDEX "ReportSource_status_idx" ON "ReportSource"("status" ASC);

-- CreateIndex
CREATE INDEX "SavedSearch_deletedAt_idx" ON "SavedSearch"("deletedAt" ASC);

-- CreateIndex
CREATE INDEX "SavedSearch_userId_idx" ON "SavedSearch"("userId" ASC);

-- CreateIndex
CREATE INDEX "ScoringSnapshot_companyIco_idx" ON "ScoringSnapshot"("companyIco" ASC);

-- CreateIndex
CREATE INDEX "ScoringSnapshot_createdAt_idx" ON "ScoringSnapshot"("createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ScoringSnapshot_reportFinancialSnapshotId_key" ON "ScoringSnapshot"("reportFinancialSnapshotId" ASC);

-- CreateIndex
CREATE INDEX "ScoringSnapshot_scoringVersion_idx" ON "ScoringSnapshot"("scoringVersion" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email" ASC);

-- CreateIndex
CREATE INDEX "UserMessage_deletedAt_idx" ON "UserMessage"("deletedAt" ASC);

-- CreateIndex
CREATE INDEX "UserMessage_read_idx" ON "UserMessage"("read" ASC);

-- CreateIndex
CREATE INDEX "UserMessage_senderId_idx" ON "UserMessage"("senderId" ASC);

-- CreateIndex
CREATE INDEX "UserMessage_userId_idx" ON "UserMessage"("userId" ASC);

-- CreateIndex
CREATE INDEX "VerificationToken_email_idx" ON "VerificationToken"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_email_token_key" ON "VerificationToken"("email" ASC, "token" ASC);

-- CreateIndex
CREATE INDEX "VerificationToken_expires_idx" ON "VerificationToken"("expires" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token" ASC);

-- CreateIndex
CREATE INDEX "VestnikEvent_companyIco_idx" ON "VestnikEvent"("companyIco" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "VestnikEvent_companyIco_sourceId_key" ON "VestnikEvent"("companyIco" ASC, "sourceId" ASC);

-- CreateIndex
CREATE INDEX "VestnikEvent_severityLevel_idx" ON "VestnikEvent"("severityLevel" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "VestnikSyncCheckpoint_endpoint_key" ON "VestnikSyncCheckpoint"("endpoint" ASC);

-- CreateIndex
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_eventId_key" ON "WalletTransaction"("eventId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_providerReference_key" ON "WalletTransaction"("providerReference" ASC);

-- CreateIndex
CREATE INDEX "WalletTransaction_provider_providerReference_idx" ON "WalletTransaction"("provider" ASC, "providerReference" ASC);

-- CreateIndex
CREATE INDEX "WalletTransaction_reportRequestId_idx" ON "WalletTransaction"("reportRequestId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_reportRequestId_type_key" ON "WalletTransaction"("reportRequestId" ASC, "type" ASC);

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_idx" ON "WalletTransaction"("walletId" ASC);

-- CreateIndex
CREATE INDEX "WatchedCompany_deletedAt_idx" ON "WatchedCompany"("deletedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "WatchedCompany_userId_companyId_key" ON "WatchedCompany"("userId" ASC, "companyId" ASC);

-- CreateIndex
CREATE INDEX "WatchedCompany_userId_idx" ON "WatchedCompany"("userId" ASC);

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertDelivery" ADD CONSTRAINT "AlertDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditVerdict" ADD CONSTRAINT "AuditVerdict_companyIco_fkey" FOREIGN KEY ("companyIco") REFERENCES "Company"("ico") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditorOpinion" ADD CONSTRAINT "AuditorOpinion_financialStatementId_fkey" FOREIGN KEY ("financialStatementId") REFERENCES "FinancialStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyEvent" ADD CONSTRAINT "CompanyEvent_companyIco_fkey" FOREIGN KEY ("companyIco") REFERENCES "Company"("ico") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPerson" ADD CONSTRAINT "CompanyPerson_companyIco_fkey" FOREIGN KEY ("companyIco") REFERENCES "Company"("ico") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditBatch" ADD CONSTRAINT "CreditBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialStatement" ADD CONSTRAINT "FinancialStatement_companyIco_fkey" FOREIGN KEY ("companyIco") REFERENCES "Company"("ico") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NarrativeRiskAnalysis" ADD CONSTRAINT "NarrativeRiskAnalysis_financialStatementId_fkey" FOREIGN KEY ("financialStatementId") REFERENCES "FinancialStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotesRiskAnalysis" ADD CONSTRAINT "NotesRiskAnalysis_financialStatementId_fkey" FOREIGN KEY ("financialStatementId") REFERENCES "FinancialStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportFinancialSnapshot" ADD CONSTRAINT "ReportFinancialSnapshot_reportRequestId_fkey" FOREIGN KEY ("reportRequestId") REFERENCES "ReportRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRequest" ADD CONSTRAINT "ReportRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSource" ADD CONSTRAINT "ReportSource_reportRequestId_fkey" FOREIGN KEY ("reportRequestId") REFERENCES "ReportRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSearch" ADD CONSTRAINT "SavedSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoringSnapshot" ADD CONSTRAINT "ScoringSnapshot_auditVerdictId_fkey" FOREIGN KEY ("auditVerdictId") REFERENCES "AuditVerdict"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoringSnapshot" ADD CONSTRAINT "ScoringSnapshot_companyIco_fkey" FOREIGN KEY ("companyIco") REFERENCES "Company"("ico") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoringSnapshot" ADD CONSTRAINT "ScoringSnapshot_reportFinancialSnapshotId_fkey" FOREIGN KEY ("reportFinancialSnapshotId") REFERENCES "ReportFinancialSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMessage" ADD CONSTRAINT "UserMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMessage" ADD CONSTRAINT "UserMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VestnikEvent" ADD CONSTRAINT "VestnikEvent_companyIco_fkey" FOREIGN KEY ("companyIco") REFERENCES "Company"("ico") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchedCompany" ADD CONSTRAINT "WatchedCompany_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

