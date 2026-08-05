-- Extended financial fields (template 699 — asset/equity composition)
-- These fields are extracted from RÚZ JSON tables (šablóna 699) and enable
-- advanced ratios: CCC, Interest Coverage, Asset Turnover, Equity Ratio, etc.

ALTER TABLE "FinancialStatement" ADD COLUMN "nonCurrentAssets" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "intangibleAssets" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "tangibleAssets" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "ltFinancialAssets" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "ltReceivables" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "stFinancialAssets" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "deferredAssets" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "shareCapital" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "sharePremium" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "otherCapitalFunds" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "statutoryReserveFunds" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "otherProfitFunds" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "retainedEarnings" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "retainedProfit" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "accumulatedLoss" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "currentYearProfit" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "ltReserves" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "stReserves" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "stBankLoans" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "stFinancialAssistance" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "operatingCosts" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "materialConsumption" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "servicesCosts" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "wageCosts" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "taxesFees" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "financialResult" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "profitBeforeTax" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "profitTransfer" DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ADD COLUMN "statementDate" TEXT;
ALTER TABLE "FinancialStatement" ADD COLUMN "approvalDate" TEXT;
