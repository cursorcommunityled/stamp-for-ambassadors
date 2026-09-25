-- CreateTable
CREATE TABLE "Host" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Host_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Host_email_key" ON "Host"("email");

-- DropIndex
DROP INDEX "Event_lumaEventId_idx";

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "coverUrl" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "endAt" TIMESTAMP(3),
ADD COLUMN     "location" TEXT,
ADD COLUMN     "lumaUrl" TEXT,
ADD COLUMN     "ownerHostId" TEXT,
ADD COLUMN     "startAt" TIMESTAMP(3),
ADD COLUMN     "timezone" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Event_lumaEventId_key" ON "Event"("lumaEventId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_ownerHostId_fkey" FOREIGN KEY ("ownerHostId") REFERENCES "Host"("id") ON DELETE SET NULL ON UPDATE CASCADE;
