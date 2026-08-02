-- CreateTable: WatchedCompany
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

-- CreateIndex: unique user+company
CREATE UNIQUE INDEX "WatchedCompany_userId_companyId_key" ON "WatchedCompany"("userId", "companyId");

-- CreateIndex
CREATE INDEX "WatchedCompany_userId_idx" ON "WatchedCompany"("userId");

-- CreateIndex
CREATE INDEX "WatchedCompany_deletedAt_idx" ON "WatchedCompany"("deletedAt");

-- AddForeignKey
ALTER TABLE "WatchedCompany" ADD CONSTRAINT "WatchedCompany_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: AlertEvent
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

-- CreateIndex
CREATE INDEX "AlertEvent_companyId_createdAt_idx" ON "AlertEvent"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AlertEvent_source_eventType_idx" ON "AlertEvent"("source", "eventType");

-- CreateIndex
CREATE INDEX "AlertEvent_deletedAt_idx" ON "AlertEvent"("deletedAt");

-- CreateTable: AlertDelivery
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

-- CreateIndex
CREATE INDEX "AlertDelivery_userId_status_idx" ON "AlertDelivery"("userId", "status");

-- CreateIndex
CREATE INDEX "AlertDelivery_deletedAt_idx" ON "AlertDelivery"("deletedAt");

-- AddForeignKey
ALTER TABLE "AlertDelivery" ADD CONSTRAINT "AlertDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
