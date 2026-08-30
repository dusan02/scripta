-- CreateIndex
CREATE INDEX "AlertDelivery_alertId_idx" ON "AlertDelivery"("alertId");

-- CreateIndex
CREATE INDEX "Company_latestYear_idx" ON "Company"("latestYear");

-- CreateIndex
CREATE INDEX "Company_ownershipType_idx" ON "Company"("ownershipType");

-- CreateIndex
CREATE INDEX "CompanyEvent_companyIco_createdAt_idx" ON "CompanyEvent"("companyIco", "createdAt");

-- CreateIndex
CREATE INDEX "User_subscriptionStatus_idx" ON "User"("subscriptionStatus");

-- CreateIndex
CREATE INDEX "VestnikEvent_companyIco_publishedAt_idx" ON "VestnikEvent"("companyIco", "publishedAt");
