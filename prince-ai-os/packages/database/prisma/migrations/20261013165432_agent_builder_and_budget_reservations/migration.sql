-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('standard', 'test');

-- AlterEnum
ALTER TYPE "AgentStatus" ADD VALUE 'archived';

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "basedOnTemplateKey" TEXT,
ADD COLUMN     "createdById" TEXT;

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "reservedUsd" DECIMAL(12,6);

-- AlterTable
ALTER TABLE "AgentVersion" ADD COLUMN     "createdById" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "kind" "TaskKind" NOT NULL DEFAULT 'standard';

-- CreateIndex
CREATE INDEX "AgentRun_startedAt_idx" ON "AgentRun"("startedAt");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
