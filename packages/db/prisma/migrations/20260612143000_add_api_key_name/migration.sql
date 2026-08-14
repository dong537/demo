ALTER TABLE "api_keys" ADD COLUMN "name" TEXT;

UPDATE "api_keys"
SET "name" = 'API Key ' || "keyPrefix"
WHERE "name" IS NULL;

ALTER TABLE "api_keys" ALTER COLUMN "name" SET NOT NULL;
