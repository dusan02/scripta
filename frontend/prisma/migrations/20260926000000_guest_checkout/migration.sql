-- CreateTable
CREATE TABLE "GuestCheckout" (
    "id" TEXT NOT NULL,
    "ico" TEXT NOT NULL,
    "companyName" TEXT,
    "email" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "userId" TEXT,
    "reportRequestId" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "fulfilledAt" TIMESTAMP(3),

    CONSTRAINT "GuestCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuestCheckout_email_idx" ON "GuestCheckout"("email");
CREATE INDEX "GuestCheckout_status_idx" ON "GuestCheckout"("status");
CREATE INDEX "GuestCheckout_transactionId_idx" ON "GuestCheckout"("transactionId");
