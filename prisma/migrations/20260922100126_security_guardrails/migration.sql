-- Production guardrails: throttled host discovery, confirmed hosts,
-- database-backed rate limits, and an audit trail.
--
-- Hand-written, same as the two migrations before it. `prisma migrate dev`
-- offers to drop `Event.ownerHostId` and to swap the `_EventToHost` unique
-- index for a primary key; both are declined here. The column stays because
-- pre-deploy runs while the old release is still serving, and neither belongs
-- on a security release.

-- One Luma call per discovery, so it claims a slot the way roster sync does.
ALTER TABLE "Event" ADD COLUMN "hostsSyncedAt" TIMESTAMP(3);

-- Luma names hosts without an access level, so a name on the list is a
-- request to manage, not permission to.
ALTER TABLE "Host" ADD COLUMN "confirmedAt" TIMESTAMP(3),
ADD COLUMN "confirmedBy" TEXT;

-- Every row that exists today was typed in by an admin, which is the
-- confirmation. Only rows Luma discovers from here on start pending.
UPDATE "Host"
SET "confirmedAt" = "createdAt", "confirmedBy" = "grantedBy"
WHERE "grantedBy" <> 'luma';

CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "RateLimit_windowStart_idx" ON "RateLimit"("windowStart");

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "eventSlug" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
