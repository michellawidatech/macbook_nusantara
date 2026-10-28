-- The shop's Shopee listings, per variant (owner, 2026-10-28: "pls seed this
-- in the product yah for the shopee link"). DATA ONLY — the columns came in
-- 20261028090000. Source: the owner's scrape, shopee-links.xlsx, sheet "Link
-- Shopee": the Export stock sheet (lib/stockExport.ts) with the listing
-- matched to each "Unit" row.
--
-- Matched EXACTLY the way the export wrote the row and lib/priceImport.ts
-- reads it back: `Sku.name` + " " + the variant label, whitespace collapsed,
-- upper-cased — live variants only. A variant the shop does not hold (a test
-- database, staging before a refresh) matches nothing and nothing happens.
-- Only an EMPTY link is filled: a link somebody set by hand in the app before
-- this ran is theirs and is left alone, and running it twice changes nothing.
--
-- Left out on purpose: "MacBook Pro 16" M1 Pro 16GB · 512GB · Standar", which
-- the scrape matched to the Intel 2019 16-inch listing — an M1 Pro is a 2021
-- unit. Rows marked "Tidak ada listing yang cocok" have no link to load.

WITH listing ("unit", "url") AS (VALUES
  ('Mac mini 2018 i3 · 8GB · 128GB', 'https://shopee.co.id/product/976133661/44129264068'),
  ('MacBook Air 12" 2016 m3 · 8GB · 256GB · RETINA', 'https://shopee.co.id/product/976133661/47162054859'),
  ('MacBook Air 12" 2016 m5 · 8GB · 512GB · RETINA', 'https://shopee.co.id/product/976133661/47162054859'),
  ('MacBook Air 12" 2017 m3 · 8GB · 256GB · RETINA', 'https://shopee.co.id/product/976133661/49111919670'),
  ('MacBook Air 13" 2017 i5 · 8GB · 256GB', 'https://shopee.co.id/product/976133661/22336167730'),
  ('MacBook Air 13" 2018 i5 · 8GB · 128GB', 'https://shopee.co.id/product/976133661/19777537873'),
  ('MacBook Air 13" 2018 i5 · 8GB · 256GB', 'https://shopee.co.id/product/976133661/19777537873'),
  ('MacBook Air 13" 2019 i5 · 16GB · 1TB', 'https://shopee.co.id/product/976133661/27844977105'),
  ('MacBook Air 13" 2019 i5 · 8GB · 128GB', 'https://shopee.co.id/product/976133661/27844977105'),
  ('MacBook Air 13" 2020 i3 / 8GB / 256GB', 'https://shopee.co.id/product/976133661/23636158438'),
  ('MacBook Air 13" M1 8GB · 256GB', 'https://shopee.co.id/product/976133661/23636158438'),
  ('MacBook Air 13" M1 8GB · 512GB', 'https://shopee.co.id/product/976133661/23636158438'),
  ('MacBook Air 13" M2 8GB · 256GB', 'https://shopee.co.id/product/976133661/19990430237'),
  ('MacBook Air 13" M3 8GB · 256GB', 'https://shopee.co.id/product/976133661/40382183833'),
  ('MacBook Air 13" M5 16GB · 512GB · NEW', 'https://shopee.co.id/product/976133661/46864113336'),
  ('MacBook Air 15" M2 24GB · 512GB', 'https://shopee.co.id/product/976133661/19990430237'),
  ('MacBook Air 15" M2 8GB · 256GB', 'https://shopee.co.id/product/976133661/19990430237'),
  ('MacBook Air 15" M3 8GB · 512GB', 'https://shopee.co.id/product/976133661/40382183833'),
  ('MacBook Pro 13" 2015 i5 · 8GB · 128GB', 'https://shopee.co.id/product/976133661/21077603720'),
  ('MacBook Pro 13" 2015 i7 · 16GB · 1TB', 'https://shopee.co.id/product/976133661/21077603720'),
  ('MacBook Pro 13" 2016 i5 · 16GB · 256GB · TB', 'https://shopee.co.id/product/976133661/58011726200'),
  ('MacBook Pro 13" 2016 i5 · 8GB · 128GB · NTB', 'https://shopee.co.id/product/976133661/58011726200'),
  ('MacBook Pro 13" 2016 i5 · 8GB · 256GB · TB', 'https://shopee.co.id/product/976133661/58011726200'),
  ('MacBook Pro 13" 2016 i5 · 8GB · 512GB · TB', 'https://shopee.co.id/product/976133661/58011726200'),
  ('MacBook Pro 13" 2017 i5 · 16GB · 256GB · NTB', 'https://shopee.co.id/product/976133661/22636164158'),
  ('MacBook Pro 13" 2017 i5 · 16GB · 512GB · NTB', 'https://shopee.co.id/product/976133661/22636164158'),
  ('MacBook Pro 13" 2017 i5 · 16GB · 512GB · TB', 'https://shopee.co.id/product/976133661/22636164158'),
  ('MacBook Pro 13" 2017 i5 · 8GB · 128GB · NTB', 'https://shopee.co.id/product/976133661/22636164158'),
  ('MacBook Pro 13" 2017 i5 · 8GB · 256GB · NTB', 'https://shopee.co.id/product/976133661/22636164158'),
  ('MacBook Pro 13" 2017 i7 · 16GB · 1TB · NTB', 'https://shopee.co.id/product/976133661/22636164158'),
  ('MacBook Pro 13" 2018 i5 · 8GB · 256GB', 'https://shopee.co.id/product/976133661/23836328693'),
  ('MacBook Pro 13" 2018 i5 · 8GB · 512GB', 'https://shopee.co.id/product/976133661/23836328693'),
  ('MacBook Pro 13" 2019 i5 · 16GB · 256GB', 'https://shopee.co.id/product/976133661/49661868191'),
  ('MacBook Pro 13" 2019 i5 · 16GB · 512GB', 'https://shopee.co.id/product/976133661/49661868191'),
  ('MacBook Pro 13" 2019 i5 · 8GB · 128GB', 'https://shopee.co.id/product/976133661/49661868191'),
  ('MacBook Pro 13" 2019 i5 · 8GB · 256GB', 'https://shopee.co.id/product/976133661/49661868191'),
  ('MacBook Pro 13" 2020 i5 · 16GB · 1TB', 'https://shopee.co.id/product/976133661/22836332614'),
  ('MacBook Pro 13" 2020 i5 · 16GB · 512GB', 'https://shopee.co.id/product/976133661/22836332614'),
  ('MacBook Pro 13" 2020 i5 · 8GB · 256GB', 'https://shopee.co.id/product/976133661/22836332614'),
  ('MacBook Pro 13" 2020 i5 · 8GB · 512GB', 'https://shopee.co.id/product/976133661/22836332614'),
  ('MacBook Pro 13" 2020 i7 · 16GB · 512GB', 'https://shopee.co.id/product/976133661/22836332614'),
  ('MacBook Pro 13" M1 8GB · 256GB', 'https://shopee.co.id/product/976133661/22836332614'),
  ('MacBook Pro 13" M1 8GB · 512GB', 'https://shopee.co.id/product/976133661/22836332614'),
  ('MacBook Pro 13" M2 8GB · 256GB', 'https://shopee.co.id/product/976133661/22256260808'),
  ('MacBook Pro 14" M1 Pro 16GB · 1TB', 'https://shopee.co.id/product/976133661/19193229277'),
  ('MacBook Pro 14" M1 Pro 16GB · 512GB', 'https://shopee.co.id/product/976133661/19193229277'),
  ('MacBook Pro 15" 2016 i7 · 16GB · 512GB', 'https://shopee.co.id/product/976133661/41181529072'),
  ('MacBook Pro 15" 2018 i7 · 16GB · 1TB', 'https://shopee.co.id/product/976133661/56911852057'),
  ('MacBook Pro 15" 2018 i7 · 16GB · 256GB', 'https://shopee.co.id/product/976133661/56911852057'),
  ('MacBook Pro 15" 2018 i7 · 16GB · 512GB', 'https://shopee.co.id/product/976133661/56911852057'),
  ('MacBook Pro 15" 2019 i7 · 16GB · 256GB', 'https://shopee.co.id/product/976133661/29595189063'),
  ('MacBook Pro 16" 2019 i7 · 16GB · 256GB', 'https://shopee.co.id/product/976133661/49511872127'),
  ('MacBook Pro 16" 2019 i9 · 16GB · 1TB', 'https://shopee.co.id/product/976133661/49511872127'),
  ('MacBook Pro 16" M2 Pro Max 64GB · 1TB', 'https://shopee.co.id/product/976133661/55706296065'),
  ('MacBook Pro 16" M4 Pro 24GB · 512GB', 'https://shopee.co.id/product/976133661/45312419137'),
  ('STUDIO DISPLAY 27"', 'https://shopee.co.id/product/976133661/57163489822'),
  ('iMac 27" 2017 i5 · 16GB · 128GB', 'https://shopee.co.id/product/976133661/45607331353'),
  ('iMac 27" 2020 i5 · 8GB · 512GB', 'https://shopee.co.id/product/976133661/41881557853')
)
UPDATE "Sku" AS s
SET "shopeeUrl" = l."url"
FROM listing AS l
WHERE s."archived" = false
  AND s."mergedIntoId" IS NULL
  AND s."shopeeUrl" IS NULL
  AND upper(regexp_replace(btrim(
        s."name" || CASE WHEN coalesce(s."variantLabel", '') <> ''
                         THEN ' ' || s."variantLabel" ELSE '' END
      ), '\s+', ' ', 'g'))
    = upper(regexp_replace(btrim(l."unit"), '\s+', ' ', 'g'));
