-- CreateEnum
CREATE TYPE "ReasoningEffort" AS ENUM ('low', 'medium', 'high');

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "thinkingTokens" INTEGER;

-- AlterTable
ALTER TABLE "AgentVersion" ADD COLUMN     "effort" "ReasoningEffort";

