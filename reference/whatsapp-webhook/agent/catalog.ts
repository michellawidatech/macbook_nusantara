/**
 * How a customer's words become a set of SKUs — pure, no I/O.
 *
 * This exists because the read tools and the reservation write path used to
 * build their own (subtly different) Prisma filters, so the bot could say
 * "stok 4 unit" and then fail to book the very same unit. A real conversation:
 *
 *   bot:  MacBook Air 13" M2 16GB/512GB Grade B, 12 juta, stok 4 unit
 *   cust: boleh, booking
 *   bot:  sayang kak, unit-nya baru sold tadi        ← nothing was sold
 *
 * Two things broke. The catalog splits a unit across columns — model `MacBook
 * Air 13"`, chip `M2`, storage `16GB / 512GB` — but the model sends whatever the
 * customer typed: the whole label as `product`, or `storage: "16GB/512GB"`
 * without the spaces the column happens to have. A single `contains` matched
 * neither.
 *
 * So {@link parseProduct} pulls chip / storage / grade back out of free text,
 * and {@link skuWhere} matches each piece against the column that holds it —
 * every size token independently, so "16GB/512GB", "16GB / 512GB" and "512GB"
 * all land on the same rows. Both call sites share it, which is the point: they
 * can no longer disagree about what is available.
 */

import type { Grade, Prisma } from "@nusantara/db";

/** Entity shape the catalog tools accept (a subset of the tool input). */
export interface CatalogQuery {
  product?: string;
  chip?: string;
  storage?: string;
  grade?: string;
  budget?: number;
}

const GRADES = new Set<Grade>(["A", "B", "C"]);

/** Normalize a model-supplied grade to the enum, or `undefined` if it isn't one. */
export const asGrade = (g: string | undefined): Grade | undefined =>
  g && GRADES.has(g.toUpperCase() as Grade) ? (g.toUpperCase() as Grade) : undefined;

/** Apple silicon: "M2", "M3 Pro", "M4 Max" — lives in the `chip` column. */
const CHIP_RE = /^m[1-9]$/i;
const CHIP_SUFFIX = /^(pro|max|ultra)$/i;

/** A capacity token: "16GB", "512 GB", "1TB" — lives in the `storage` column. */
const SIZE_RE = /^(\d+)\s*(gb|tb)$/i;

/** Noise that carries no matching power (and would wrongly narrow the query). */
const STOPWORDS = new Set(["inch", "inci", "ram", "ssd", "unit", "grade", "dan", "atau"]);

/** Every capacity mentioned in a string, normalized ("16 gb" → "16GB"). */
export function sizeTokens(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const m of (raw ?? "").matchAll(/(\d+)\s*(gb|tb)/gi)) out.push(`${m[1]}${m[2]!.toUpperCase()}`);
  return out;
}

/** What a free-text product label actually says, split by catalog column. */
export interface ParsedProduct {
  /** Words that should appear in the model/SKU name ("macbook", "air", `13"`). */
  nameTokens: string[];
  chip?: string;
  sizes: string[];
  grade?: Grade;
}

/**
 * Split a product label into the columns that hold each part. The model is told
 * to send the model name alone, but customers paste whole labels back at it
 * ('MacBook Air 15" M3 16GB/1TB Grade B') and the model echoes them — so we
 * parse rather than fail.
 */
export function parseProduct(raw: string | undefined): ParsedProduct {
  const text = raw?.trim() ?? "";
  if (!text) return { nameTokens: [], sizes: [] };

  // "Grade B" / "grade-b" — pull it out before tokenizing so the letter can't
  // survive as a name token.
  const gradeMatch = text.match(/\bgrade[\s-]*([abc])\b/i);
  const grade = asGrade(gradeMatch?.[1]);
  const rest = gradeMatch ? text.replace(gradeMatch[0], " ") : text;

  const raws = rest.split(/[\s,/·|]+/).filter(Boolean);
  const nameTokens: string[] = [];
  const sizes: string[] = [];
  let chip: string | undefined;

  for (let i = 0; i < raws.length; i++) {
    const tok = raws[i]!.replace(/[(),.]+$/g, "");
    if (!tok || STOPWORDS.has(tok.toLowerCase())) continue;
    if (SIZE_RE.test(tok)) {
      sizes.push(...sizeTokens(tok));
      continue;
    }
    if (CHIP_RE.test(tok)) {
      // "M3 Pro" is one chip; consume the suffix so it isn't required in the name.
      const next = raws[i + 1];
      if (next && CHIP_SUFFIX.test(next)) {
        chip = `${tok} ${next}`;
        i++;
      } else {
        chip = tok;
      }
      continue;
    }
    nameTokens.push(tok);
  }
  return { nameTokens, chip, sizes, grade };
}

/** One `contains` against the model name OR the SKU's own name (modelId is nullable). */
const nameMatch = (token: string): Prisma.SkuWhereInput => ({
  OR: [
    { model: { is: { name: { contains: token, mode: "insensitive" }, archived: false } } },
    { name: { contains: token, mode: "insensitive" } },
  ],
});

/**
 * The Prisma filter for a catalog query — the ONE definition of "which SKUs did
 * the customer mean", shared by the read tools and the reservation write path.
 *
 * Explicit `chip`/`storage`/`grade` arguments win; anything the model left
 * embedded in `product` is recovered by {@link parseProduct}. Each size token is
 * required separately, so "16GB/512GB" matches a stored "16GB / 512GB".
 *
 * Pass `relaxed` to drop capacity and grade — used to find real alternatives to
 * offer instead of letting the agent invent a reason for an empty result.
 */
export function skuWhere(q: CatalogQuery, relaxed = false): Prisma.SkuWhereInput {
  const parsed = parseProduct(q.product);
  const chip = q.chip?.trim() || parsed.chip;
  const grade = asGrade(q.grade) ?? parsed.grade;
  const sizes = [...new Set([...sizeTokens(q.storage), ...parsed.sizes])];

  const AND: Prisma.SkuWhereInput[] = parsed.nameTokens.map(nameMatch);
  if (chip) AND.push({ chip: { contains: chip, mode: "insensitive" } });
  if (!relaxed) for (const size of sizes) AND.push({ storage: { contains: size, mode: "insensitive" } });

  return {
    archived: false,
    ...(!relaxed && grade ? { grade } : {}),
    ...(AND.length ? { AND } : {}),
  };
}
