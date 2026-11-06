-- What the chatbot would quote wrongly: units on sale whose data looks off.
-- Read-only (the whole run is one READ ONLY transaction). The bot quotes a
-- unit's own sell price (Unit.price, 2026-11-05) and its battery reading, so
-- every row below is something a customer could be told today.
--
--   psql "$DATABASE_URL" -f tools/chatbot-data-check.sql
--
-- Fix what it lists in Inventory (Set price, Edit unit). An empty section
-- means nothing to fix there.
\pset pager off
BEGIN READ ONLY;

\echo '=== 1. On sale with no sell price, or a price that is not a round 10.000 (an averaged cost?) ==='
SELECT u.serial, s.name AS product, s."variantLabel" AS variant, u.grade, u.price
FROM "Unit" u JOIN "Sku" s ON s.id = u."skuId"
WHERE u.status IN ('TERSEDIA', 'DIRESERVASI') AND u."archivedAt" IS NULL
  AND (u.price IS NULL OR u.price <= 0 OR u.price % 10000 <> 0)
ORDER BY s.name, s."variantLabel", u.serial;

\echo '=== 2. Variants whose units differ by grade but all ask the same price ==='
SELECT s.name AS product, s."variantLabel" AS variant,
       string_agg(DISTINCT COALESCE(u.grade::text, '-'), ', ') AS grades,
       min(u.price) AS price, count(*) AS units
FROM "Unit" u JOIN "Sku" s ON s.id = u."skuId"
WHERE u.status IN ('TERSEDIA', 'DIRESERVASI') AND u."archivedAt" IS NULL
GROUP BY s.id, s.name, s."variantLabel"
HAVING count(DISTINCT u.grade) > 1 AND count(DISTINCT u.price) = 1
ORDER BY s.name, s."variantLabel";

\echo '=== 3. On sale with no grade ==='
SELECT u.serial, s.name AS product, s."variantLabel" AS variant, u.price
FROM "Unit" u JOIN "Sku" s ON s.id = u."skuId"
WHERE u.status IN ('TERSEDIA', 'DIRESERVASI') AND u."archivedAt" IS NULL
  AND u.grade IS NULL
ORDER BY s.name, u.serial;

\echo '=== 4. A cycle count of 2 or less (a used unit almost never has one) ==='
SELECT u.serial, s.name AS product, u.grade, ua.value AS cycles
FROM "Unit" u
JOIN "Sku" s ON s.id = u."skuId"
JOIN "UnitAttribute" ua ON ua."unitId" = u.id
JOIN "CategoryAttribute" ca ON ca.id = ua."attributeId" AND ca.key = 'siklus'
WHERE u.status IN ('TERSEDIA', 'DIRESERVASI') AND u."archivedAt" IS NULL
  AND u.grade IS DISTINCT FROM 'NEW'
  AND ua.value ~ '^[0-9]+$' AND ua.value::int <= 2
ORDER BY s.name, u.serial;

\echo '=== 5. Asking no more than the unit cost ==='
SELECT u.serial, s.name AS product, s."variantLabel" AS variant, u.price, u.landed
FROM "Unit" u JOIN "Sku" s ON s.id = u."skuId"
WHERE u.status IN ('TERSEDIA', 'DIRESERVASI') AND u."archivedAt" IS NULL
  AND u.price IS NOT NULL AND u.price > 0 AND u.price <= u.landed
ORDER BY s.name, u.serial;

ROLLBACK;
