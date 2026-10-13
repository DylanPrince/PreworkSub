-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('user_entered', 'imported', 'estimated');

-- CreateEnum
CREATE TYPE "FinanceKind" AS ENUM ('revenue', 'refund', 'cogs', 'operating_expense', 'ad_spend', 'subscription', 'other_income', 'other_expense');

-- CreateEnum
CREATE TYPE "ProductStage" AS ENUM ('idea', 'researching', 'sourcing', 'ready', 'listed', 'retired');

-- CreateEnum
CREATE TYPE "ContentFormat" AS ENUM ('blog', 'short_video', 'long_video', 'social_post', 'email', 'ad', 'other');

-- CreateEnum
CREATE TYPE "ContentStage" AS ENUM ('idea', 'drafting', 'review', 'approved', 'published');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('planning', 'approved', 'ended');

-- CreateEnum
CREATE TYPE "SaasStage" AS ENUM ('idea', 'specification', 'building', 'testing', 'launched', 'paused');

-- CreateEnum
CREATE TYPE "BacklogType" AS ENUM ('feature', 'bug', 'chore');

-- CreateEnum
CREATE TYPE "BacklogStatus" AS ENUM ('todo', 'in_progress', 'done');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('low', 'medium', 'high');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "subjectId" TEXT,
ADD COLUMN     "subjectType" TEXT;

-- CreateTable
CREATE TABLE "FinanceEntry" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" "FinanceKind" NOT NULL,
    "amountUsd" DECIMAL(14,2) NOT NULL,
    "occurredOn" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "source" "RecordSource" NOT NULL DEFAULT 'user_entered',
    "createdById" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT NOT NULL DEFAULT '',
    "contact" TEXT NOT NULL DEFAULT '',
    "leadTimeDays" INTEGER,
    "minimumOrder" INTEGER,
    "notes" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "stage" "ProductStage" NOT NULL DEFAULT 'idea',
    "supplierId" TEXT,
    "priceUsd" DECIMAL(12,2),
    "unitCostUsd" DECIMAL(12,2),
    "shippingCostUsd" DECIMAL(12,2),
    "feePercent" DECIMAL(5,2),
    "feeFixedUsd" DECIMAL(12,2),
    "source" "RecordSource" NOT NULL DEFAULT 'user_entered',
    "notes" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "format" "ContentFormat" NOT NULL,
    "channel" TEXT NOT NULL DEFAULT '',
    "stage" "ContentStage" NOT NULL DEFAULT 'idea',
    "brief" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "scheduledFor" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "publishedUrl" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT '',
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "budgetUsd" DECIMAL(12,2),
    "startsOn" DATE,
    "endsOn" DATE,
    "status" "CampaignStatus" NOT NULL DEFAULT 'planning',
    "notes" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaasProject" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "stage" "SaasStage" NOT NULL DEFAULT 'idea',
    "repositoryUrl" TEXT NOT NULL DEFAULT '',
    "requirements" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaasProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacklogItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "type" "BacklogType" NOT NULL DEFAULT 'feature',
    "status" "BacklogStatus" NOT NULL DEFAULT 'todo',
    "priority" "Priority" NOT NULL DEFAULT 'medium',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BacklogItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceEntry_businessId_occurredOn_idx" ON "FinanceEntry"("businessId", "occurredOn");

-- CreateIndex
CREATE INDEX "Supplier_businessId_idx" ON "Supplier"("businessId");

-- CreateIndex
CREATE INDEX "Product_businessId_stage_idx" ON "Product"("businessId", "stage");

-- CreateIndex
CREATE INDEX "ContentItem_businessId_stage_idx" ON "ContentItem"("businessId", "stage");

-- CreateIndex
CREATE INDEX "ContentItem_scheduledFor_idx" ON "ContentItem"("scheduledFor");

-- CreateIndex
CREATE INDEX "Campaign_businessId_status_idx" ON "Campaign"("businessId", "status");

-- CreateIndex
CREATE INDEX "SaasProject_businessId_idx" ON "SaasProject"("businessId");

-- CreateIndex
CREATE INDEX "BacklogItem_projectId_status_idx" ON "BacklogItem"("projectId", "status");

-- CreateIndex
CREATE INDEX "Task_subjectType_subjectId_idx" ON "Task"("subjectType", "subjectId");

-- AddForeignKey
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaasProject" ADD CONSTRAINT "SaasProject_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacklogItem" ADD CONSTRAINT "BacklogItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "SaasProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

