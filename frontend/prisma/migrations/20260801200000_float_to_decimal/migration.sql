-- Migrate financial fields from Float to Decimal(15,2) to prevent floating-point rounding errors.
-- Company model: 4 fields
ALTER TABLE "Company" ALTER COLUMN "latestRevenue" TYPE DECIMAL(15,2);
ALTER TABLE "Company" ALTER COLUMN "latestProfit" TYPE DECIMAL(15,2);
ALTER TABLE "Company" ALTER COLUMN "latestAssets" TYPE DECIMAL(15,2);
ALTER TABLE "Company" ALTER COLUMN "latestEquity" TYPE DECIMAL(15,2);

-- CompanyEvent model: 1 field
ALTER TABLE "CompanyEvent" ALTER COLUMN "amount" TYPE DECIMAL(15,2);

-- FinancialStatement model: 22 fields
ALTER TABLE "FinancialStatement" ALTER COLUMN "totalAssets" TYPE DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ALTER COLUMN "currentAssets" TYPE DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ALTER COLUMN "equity" TYPE DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ALTER COLUMN "shortTermLiabilities" TYPE DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ALTER COLUMN "longTermLiabilities" TYPE DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ALTER COLUMN "mainActivityRevenue" TYPE DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ALTER COLUMN "grossProfit" TYPE DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ALTER COLUMN "netProfitLoss" TYPE DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ALTER COLUMN "cashAndEquivalents" TYPE DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ALTER COLUMN "operatingCashFlow" TYPE DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ALTER COLUMN "staffCosts" TYPE DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ALTER COLUMN "tradeReceivables" TYPE DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ALTER COLUMN "tradePayables" TYPE DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ALTER COLUMN "inventory" TYPE DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ALTER COLUMN "depreciation" TYPE DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ALTER COLUMN "investingCashFlow" TYPE DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ALTER COLUMN "financingCashFlow" TYPE DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ALTER COLUMN "interestExpense" TYPE DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ALTER COLUMN "incomeTax" TYPE DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ALTER COLUMN "socialInsuranceLiabilities" TYPE DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ALTER COLUMN "taxLiabilities" TYPE DECIMAL(15,2);
ALTER TABLE "FinancialStatement" ALTER COLUMN "employeeLiabilities" TYPE DECIMAL(15,2);
