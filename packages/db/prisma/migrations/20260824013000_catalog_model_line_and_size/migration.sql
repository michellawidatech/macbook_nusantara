-- Label fields. The printed product code is "PRO 13\" 2017 i5 8/128 NTB";
-- year and the ram/ssd variant already existed, line and size did not.
--
-- Both nullable: the catalogue holds iPhones and accessories that have no line
-- and no screen size worth printing, and backfilling a lie is worse than a NULL
-- the label renderer can skip.

ALTER TABLE "CatalogModel" ADD COLUMN "line" TEXT;
ALTER TABLE "CatalogModel" ADD COLUMN "sizeInch" DECIMAL(3,1);
