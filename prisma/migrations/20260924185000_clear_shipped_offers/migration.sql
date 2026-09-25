-- Offers that used to ship with amounts. A row that already has codes is
-- kept and only stripped of the written deal. The rest are removed.
UPDATE "Sponsor"
SET "guide" = false,
    "perk" = NULL,
    "instructions" = NULL,
    "redeemUrl" = NULL
WHERE "slug" IN ('render', 'exa', 'firecrawl');

DELETE FROM "Sponsor"
WHERE "slug" IN ('render', 'exa', 'firecrawl')
  AND NOT EXISTS (
    SELECT 1 FROM "Code" WHERE "Code"."sponsorId" = "Sponsor"."id"
  );

UPDATE "Sponsor"
SET "perk" = NULL,
    "instructions" = NULL
WHERE "slug" = 'cursor';
