-- A partner added on one event's page belongs to that event. Null is the
-- shared list. Nullable, so the previous process keeps serving during
-- pre-deploy without reading it.

-- AlterTable
ALTER TABLE "Sponsor" ADD COLUMN "eventId" TEXT;

-- CreateIndex
CREATE INDEX "Sponsor_eventId_idx" ON "Sponsor"("eventId");

-- AddForeignKey
ALTER TABLE "Sponsor" ADD CONSTRAINT "Sponsor_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A how-to now shows only on its own event. A shared one has no event to
-- show on, so it goes back to being a plain partner. Its codes stay.
UPDATE "Sponsor" SET "guide" = false WHERE "guide" = true;
