-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "commandId" TEXT,
ADD COLUMN     "workstream" TEXT;

-- CreateTable
CREATE TABLE "Command" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "request" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "planTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Command_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Command_clientKey_key" ON "Command"("clientKey");

-- CreateIndex
CREATE UNIQUE INDEX "Command_planTaskId_key" ON "Command"("planTaskId");

-- CreateIndex
CREATE INDEX "Command_businessId_createdAt_idx" ON "Command"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Task_commandId_workstream_key" ON "Task"("commandId", "workstream");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "Command"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Command" ADD CONSTRAINT "Command_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Command" ADD CONSTRAINT "Command_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

