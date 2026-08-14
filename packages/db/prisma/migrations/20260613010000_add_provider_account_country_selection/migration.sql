ALTER TABLE "provider_accounts"
ADD COLUMN "enabledCountryCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
