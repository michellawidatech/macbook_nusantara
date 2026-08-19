/**
 * AppleDB — the real Mac catalogue, fetched from the community database at
 * https://api.appledb.dev (see littlebyteorg/appledb, API.md).
 *
 * The endpoint is static JSON on a CDN with `access-control-allow-origin: *`,
 * so the browser fetches it directly. There is no key, no rate limit worth
 * pacing, and no backend hop to add — which is why this lives in the web app
 * rather than behind our own API.
 *
 * Two things AppleDB does NOT give us, and how each is handled:
 *
 * 1. **Configurable specs are patchy.** Only ~13 of 130 Mac laptops carry an
 *    `info` block with `Memory.RAM` / `Memory.Storage` — broadly, the Apple
 *    Silicon ones. Every Intel model, *including the 2016 MacBooks the owner
 *    asked for by name*, arrives with a name and a date and nothing to build
 *    variants from. `FALLBACK_SPECS` fills those in from Apple's published
 *    build-to-order options, and `specSource` reports which of the two a row
 *    came from so the import screen can say so rather than implying AppleDB
 *    knew.
 * 2. **No prices.** Obviously — it is a hardware database, not a market. An
 *    imported model's variants are created at a price of 0 and priced by hand,
 *    which is the honest default for second-hand stock anyway.
 */

/** The subset of an AppleDB device row this app reads. */
interface AppleDbDevice {
  name: string;
  identifier?: string[];
  type?: string;
  soc?: string;
  released?: string | string[];
  info?: { type?: string; RAM?: string[]; Storage?: string[] }[];
  key?: string;
}

export interface ImportCandidate {
  /** AppleDB's stable key — used as the dedupe identity on re-import. */
  key: string;
  name: string;
  /** AppleDB's `type`, e.g. "MacBook Pro". Becomes our category. */
  category: string;
  releaseYear: number;
  identifier: string;
  chip?: string;
  ram: string[];
  ssd: string[];
  /** Where the RAM/SSD lists came from. Shown in the import screen. */
  specSource: "appledb" | "curated" | "generic";
}

const ENDPOINT = "https://api.appledb.dev/device/main.json";

/** Mac laptop families. The shop deals in MacBooks; desktops are opt-in. */
export const LAPTOP_TYPES = ["MacBook", "MacBook Air", "MacBook Pro"] as const;
export const DESKTOP_TYPES = [
  "iMac",
  "Mac mini",
  "Mac Studio",
  "Mac Pro",
] as const;

/**
 * Build-to-order RAM and SSD options for models AppleDB has no `info` block
 * for, keyed by Apple's model identifier. Sourced from Apple's own tech specs.
 *
 * This is deliberately a short, curated list rather than an attempt at all 130
 * Intel Macs: it covers what a second-hand Apple shop in Indonesia actually
 * turns over, and everything outside it falls through to `GENERIC_SPECS` and is
 * labelled as a guess in the UI. A wrong-but-confident spec table would be
 * worse than an obvious placeholder.
 */
const FALLBACK_SPECS: Record<string, { ram: string[]; ssd: string[] }> = {
  // The 2016 laptops the owner called out by name. AppleDB lists all four but
  // carries no configurable specs for any of them.
  "MacBook9,1": { ram: ["8GB"], ssd: ["256GB", "512GB"] }, // MacBook 12" Early 2016
  "MacBookPro13,1": { ram: ["8GB", "16GB"], ssd: ["256GB", "512GB", "1TB"] }, // 13" 2 TB3
  "MacBookPro13,2": { ram: ["8GB", "16GB"], ssd: ["256GB", "512GB", "1TB"] }, // 13" 4 TB3
  "MacBookPro13,3": { ram: ["16GB"], ssd: ["256GB", "512GB", "1TB", "2TB"] }, // 15" 2016
  // Neighbouring years that trade in the same volume.
  "MacBookPro14,1": {
    ram: ["8GB", "16GB"],
    ssd: ["128GB", "256GB", "512GB", "1TB"],
  },
  "MacBookPro14,2": { ram: ["8GB", "16GB"], ssd: ["256GB", "512GB", "1TB"] },
  "MacBookPro14,3": { ram: ["16GB"], ssd: ["256GB", "512GB", "1TB", "2TB"] },
  "MacBookPro15,1": {
    ram: ["16GB", "32GB"],
    ssd: ["256GB", "512GB", "1TB", "2TB", "4TB"],
  },
  "MacBookPro15,2": {
    ram: ["8GB", "16GB"],
    ssd: ["128GB", "256GB", "512GB", "1TB", "2TB"],
  },
  "MacBookPro15,4": {
    ram: ["8GB", "16GB"],
    ssd: ["128GB", "256GB", "512GB", "1TB", "2TB"],
  },
  "MacBookPro16,1": {
    ram: ["16GB", "32GB", "64GB"],
    ssd: ["512GB", "1TB", "2TB", "4TB", "8TB"],
  },
  "MacBookPro16,2": {
    ram: ["16GB", "32GB"],
    ssd: ["512GB", "1TB", "2TB", "4TB"],
  },
  "MacBookAir7,2": { ram: ["8GB"], ssd: ["128GB", "256GB", "512GB"] }, // Air 13" 2015-2017
  "MacBookAir8,1": {
    ram: ["8GB", "16GB"],
    ssd: ["128GB", "256GB", "512GB", "1TB"],
  }, // Air 2018
  "MacBookAir8,2": {
    ram: ["8GB", "16GB"],
    ssd: ["128GB", "256GB", "512GB", "1TB"],
  }, // Air 2019
  "MacBookAir9,1": {
    ram: ["8GB", "16GB"],
    ssd: ["256GB", "512GB", "1TB", "2TB"],
  }, // Air 2020 Intel
  // M3 and M4. AppleDB carries `info` blocks for M1 and M2 but not for these,
  // and they are the bulk of what a second-hand shop turns over today, so
  // leaving the whole Apple Silicon range on the generic guess would make the
  // "Specs guessed" tag the normal case rather than the exception.
  "Mac15,3": { ram: ["8GB", "16GB", "24GB"], ssd: ["512GB", "1TB", "2TB"] }, // MBP 14 M3
  "Mac15,6": { ram: ["18GB", "36GB"], ssd: ["512GB", "1TB", "2TB", "4TB"] }, // MBP 14 M3 Pro
  "Mac15,7": { ram: ["18GB", "36GB"], ssd: ["512GB", "1TB", "2TB", "4TB"] }, // MBP 16 M3 Pro
  "Mac15,8": {
    ram: ["48GB", "64GB", "128GB"],
    ssd: ["1TB", "2TB", "4TB", "8TB"],
  }, // MBP 14 M3 Max 16c
  "Mac15,9": {
    ram: ["48GB", "64GB", "128GB"],
    ssd: ["1TB", "2TB", "4TB", "8TB"],
  }, // MBP 16 M3 Max 16c
  "Mac15,10": { ram: ["36GB", "96GB"], ssd: ["1TB", "2TB", "4TB", "8TB"] }, // MBP 14 M3 Max 14c
  "Mac15,11": { ram: ["36GB", "96GB"], ssd: ["1TB", "2TB", "4TB", "8TB"] }, // MBP 16 M3 Max 14c
  "Mac15,12": {
    ram: ["8GB", "16GB", "24GB"],
    ssd: ["256GB", "512GB", "1TB", "2TB"],
  }, // Air 13 M3
  "Mac15,13": {
    ram: ["8GB", "16GB", "24GB"],
    ssd: ["256GB", "512GB", "1TB", "2TB"],
  }, // Air 15 M3
  "Mac16,1": { ram: ["16GB", "24GB", "32GB"], ssd: ["512GB", "1TB", "2TB"] }, // MBP 14 M4
  "Mac16,8": { ram: ["24GB", "48GB"], ssd: ["512GB", "1TB", "2TB", "4TB"] }, // MBP 14 M4 Pro
  "Mac16,7": { ram: ["24GB", "48GB"], ssd: ["512GB", "1TB", "2TB", "4TB"] }, // MBP 16 M4 Pro
  "Mac16,6": {
    ram: ["36GB", "48GB", "64GB", "128GB"],
    ssd: ["1TB", "2TB", "4TB", "8TB"],
  }, // MBP 14 M4 Max
  "Mac16,5": {
    ram: ["36GB", "48GB", "64GB", "128GB"],
    ssd: ["1TB", "2TB", "4TB", "8TB"],
  }, // MBP 16 M4 Max
  "Mac16,12": {
    ram: ["16GB", "24GB", "32GB"],
    ssd: ["256GB", "512GB", "1TB", "2TB"],
  }, // Air 13 M4
  "Mac16,13": {
    ram: ["16GB", "24GB", "32GB"],
    ssd: ["256GB", "512GB", "1TB", "2TB"],
  }, // Air 15 M4
};

/** Last resort: a plausible modern configuration, flagged as a guess. */
const GENERIC_SPECS = { ram: ["8GB", "16GB"], ssd: ["256GB", "512GB"] };

/** `released` is a string on most rows and an array on refreshed models. */
function releaseYear(released: string | string[] | undefined): number {
  const first = Array.isArray(released) ? released[0] : released;
  const year = Number(String(first ?? "").slice(0, 4));
  return Number.isFinite(year) && year > 1980 ? year : 0;
}

function specsFor(
  device: AppleDbDevice,
  identifier: string,
): {
  ram: string[];
  ssd: string[];
  specSource: ImportCandidate["specSource"];
} {
  const memory = device.info?.find((i) => i.type === "Memory");
  if (memory?.RAM?.length && memory?.Storage?.length) {
    return {
      ram: [...memory.RAM],
      ssd: [...memory.Storage],
      specSource: "appledb",
    };
  }
  const curated = FALLBACK_SPECS[identifier];
  if (curated) return { ...curated, specSource: "curated" };
  return { ...GENERIC_SPECS, specSource: "generic" };
}

/**
 * Fetch every Mac AppleDB knows about, newest first.
 *
 * Throws on a network or HTTP failure so the caller can show the real reason —
 * an import that silently yields an empty list is indistinguishable from an
 * import that found nothing, and the fix for the two is different.
 */
export async function fetchMacModels(
  signal?: AbortSignal,
): Promise<ImportCandidate[]> {
  const res = await fetch(ENDPOINT, { signal });
  if (!res.ok) {
    throw new Error(`AppleDB responded ${res.status} ${res.statusText}`);
  }
  const devices = (await res.json()) as AppleDbDevice[];
  const wanted = new Set<string>([...LAPTOP_TYPES, ...DESKTOP_TYPES]);

  return (
    devices
      .filter((d) => d.type && wanted.has(d.type))
      .map((d) => {
        const identifier = d.identifier?.[0] ?? d.key ?? d.name;
        const { ram, ssd, specSource } = specsFor(d, identifier);
        return {
          key: d.key ?? identifier,
          name: d.name,
          category: d.type!,
          releaseYear: releaseYear(d.released),
          identifier,
          chip: d.soc,
          ram,
          ssd,
          specSource,
        };
      })
      // Newest first: a shop importing a catalogue wants this year's models at
      // the top, not a 2006 iBook.
      .sort(
        (a, b) => b.releaseYear - a.releaseYear || a.name.localeCompare(b.name),
      )
  );
}
