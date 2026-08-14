ALTER TABLE "dedicated_lines"
  ADD COLUMN "legacyId" SERIAL,
  ADD COLUMN "legacyRemark" TEXT;

CREATE UNIQUE INDEX "dedicated_lines_legacyId_key" ON "dedicated_lines"("legacyId");
