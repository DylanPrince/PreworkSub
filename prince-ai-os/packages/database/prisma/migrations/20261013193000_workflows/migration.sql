-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('active', 'disabled', 'archived');

-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('running', 'waiting_approval', 'succeeded', 'failed', 'cancelled');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "workflowRunId" TEXT,
ADD COLUMN     "workflowStep" TEXT;

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "WorkflowStatus" NOT NULL DEFAULT 'active',
    "steps" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "workflowVersion" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "input" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'running',
    "estimatedMaxUsd" DECIMAL(12,6),
    "startedById" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Workflow_businessId_createdAt_idx" ON "Workflow"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRun_clientKey_key" ON "WorkflowRun"("clientKey");

-- CreateIndex
CREATE INDEX "WorkflowRun_businessId_createdAt_idx" ON "WorkflowRun"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowRun_workflowId_createdAt_idx" ON "WorkflowRun"("workflowId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Task_workflowRunId_workflowStep_key" ON "Task"("workflowRunId", "workflowStep");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

