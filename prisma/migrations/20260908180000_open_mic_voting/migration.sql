-- The open mic ballot: projects an organizer types in live, and one vote per
-- attendee.
--
-- Hand-written to leave `Event.ownerHostId` alone. `prisma migrate dev`
-- offers to drop it on every run because the Prisma schema stopped mapping it
-- in `20260908170000_event_hosts`, but that migration keeps the column on
-- purpose so a pre-deploy does not break the process still serving. Finishing
-- that drop is its own release, not a rider on a feature.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "votingOpenedAt" TIMESTAMP(3),
ADD COLUMN     "votingClosedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "builders" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "attendeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_eventId_sortOrder_idx" ON "Project"("eventId", "sortOrder");

-- CreateIndex
CREATE INDEX "Vote_projectId_idx" ON "Vote"("projectId");

-- One row per attendee per event. This is the "one voting power" rule: moving
-- a vote updates the row, so two phones racing cannot insert a second one.
CREATE UNIQUE INDEX "Vote_eventId_attendeeId_key" ON "Vote"("eventId", "attendeeId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_attendeeId_fkey" FOREIGN KEY ("attendeeId") REFERENCES "EventAttendee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
