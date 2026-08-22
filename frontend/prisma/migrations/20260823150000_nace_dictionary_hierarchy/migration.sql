-- NACE dictionary hierarchy — add division/group/class + EN labels
ALTER TABLE "NaceCode" ADD COLUMN "descriptionEn" TEXT;
ALTER TABLE "NaceCode" ADD COLUMN "sectionNameEn" TEXT;
ALTER TABLE "NaceCode" ADD COLUMN "division" TEXT;
ALTER TABLE "NaceCode" ADD COLUMN "divisionName" TEXT;
ALTER TABLE "NaceCode" ADD COLUMN "group" TEXT;
ALTER TABLE "NaceCode" ADD COLUMN "groupName" TEXT;
ALTER TABLE "NaceCode" ADD COLUMN "class" TEXT;
ALTER TABLE "NaceCode" ADD COLUMN "className" TEXT;

CREATE INDEX "NaceCode_division_idx" ON "NaceCode" ("division");
