-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired', 'cancelled', 'executed', 'failed');

-- CreateEnum
CREATE TYPE "ApprovalCategory" AS ENUM ('spend', 'publish', 'purchase', 'contact_customers', 'deploy', 'credentials', 'legal', 'destructive', 'owner_flagged');

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "category" "ApprovalCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "estimatedCostUsd" DECIMAL(12,6),
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "requestedByType" "ActorType" NOT NULL,
    "requestedById" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT NOT NULL DEFAULT '',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),
    "result" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalRequest_businessId_status_createdAt_idx" ON "ApprovalRequest"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_fingerprint_status_idx" ON "ApprovalRequest"("fingerprint", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_targetType_targetId_idx" ON "ApprovalRequest"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

