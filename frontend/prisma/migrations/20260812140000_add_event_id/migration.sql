-- AlterTable
ALTER TABLE "WalletTransaction" ADD COLUMN "eventId" TEXT;
CREATE UNIQUE INDEX "WalletTransaction_eventId_key" ON "WalletTransaction"("eventId");
