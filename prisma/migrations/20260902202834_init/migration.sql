-- CreateTable
CREATE TABLE "MagicLink" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "nextPath" TEXT NOT NULL DEFAULT '/',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MagicLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lumaEventId" TEXT NOT NULL,
    "perksRequireCheckIn" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventAttendee" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "lumaGuestId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "approvalStatus" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3),
    "checkedInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sponsor" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "redeemUrl" TEXT,
    "instructions" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Sponsor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Code" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sponsorId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "claimedByAttendeeId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Code_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MagicLink_tokenHash_key" ON "MagicLink"("tokenHash");

-- CreateIndex
CREATE INDEX "MagicLink_email_idx" ON "MagicLink"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

-- CreateIndex
CREATE INDEX "Event_lumaEventId_idx" ON "Event"("lumaEventId");

-- CreateIndex
CREATE INDEX "EventAttendee_eventId_email_idx" ON "EventAttendee"("eventId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "EventAttendee_eventId_lumaGuestId_key" ON "EventAttendee"("eventId", "lumaGuestId");

-- CreateIndex
CREATE UNIQUE INDEX "Sponsor_slug_key" ON "Sponsor"("slug");

-- CreateIndex
CREATE INDEX "Code_eventId_sponsorId_idx" ON "Code"("eventId", "sponsorId");

-- CreateIndex
CREATE UNIQUE INDEX "Code_sponsorId_code_key" ON "Code"("sponsorId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Code_eventId_sponsorId_claimedByAttendeeId_key" ON "Code"("eventId", "sponsorId", "claimedByAttendeeId");

-- AddForeignKey
ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Code" ADD CONSTRAINT "Code_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Code" ADD CONSTRAINT "Code_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "Sponsor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Code" ADD CONSTRAINT "Code_claimedByAttendeeId_fkey" FOREIGN KEY ("claimedByAttendeeId") REFERENCES "EventAttendee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
