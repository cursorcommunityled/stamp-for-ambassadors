-- Appointed hosts live on this join table. Admins manage every event either way.
--
-- `Event.ownerHostId` is intentionally left in place. Pre-deploy runs this
-- while the previous process is still serving, and that process still reads
-- the column. Dropping it here would 500 attendee and admin pages until the
-- new build goes live. The Prisma schema no longer maps the column.

-- CreateTable
CREATE TABLE "_EventToHost" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_EventToHost_AB_unique" ON "_EventToHost"("A", "B");

-- CreateIndex
CREATE INDEX "_EventToHost_B_index" ON "_EventToHost"("B");

-- AddForeignKey
ALTER TABLE "_EventToHost" ADD CONSTRAINT "_EventToHost_A_fkey" FOREIGN KEY ("A") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EventToHost" ADD CONSTRAINT "_EventToHost_B_fkey" FOREIGN KEY ("B") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing owners become appointed hosts.
INSERT INTO "_EventToHost" ("A", "B")
SELECT "id", "ownerHostId" FROM "Event"
WHERE "ownerHostId" IS NOT NULL
ON CONFLICT ("A", "B") DO NOTHING;
