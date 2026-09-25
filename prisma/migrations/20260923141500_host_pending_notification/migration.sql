-- Tell the admins when Luma names a host who needs confirming. Until now the
-- queue on /admin was only seen by an admin who thought to look, so someone
-- could sit waiting for access nobody knew they had asked for.
--
-- Hand-written, same as the migrations before it, and for the same reason:
-- `prisma migrate dev` still offers to drop `Event.ownerHostId` and to swap
-- the `_EventToHost` unique index for a primary key. Both are declined.

ALTER TABLE "Host" ADD COLUMN "pendingNotifiedAt" TIMESTAMP(3);

-- Anyone already in the queue has been waiting since before this existed, and
-- is already listed under Pending hosts. Treating them as announced keeps the
-- first sync after deploy from mailing out a backlog the admin has seen.
UPDATE "Host"
SET "pendingNotifiedAt" = "createdAt"
WHERE "confirmedAt" IS NULL;
