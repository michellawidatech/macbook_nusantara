/**
 * A shipping address, asked for in parts and stored as one line.
 *
 * ## Why parts
 *
 * The sale used to ask for the address as a single textarea, and what came back
 * was whatever the cashier could get out of a customer over WhatsApp while
 * somebody waited at the counter. Half of them were missing a postcode, a
 * third had no kecamatan, and the courier's form — which does have separate
 * fields — had to be filled in by guessing which comma meant what. Asking for
 * the parts is the fix the owner asked for: each field is a question with an
 * obvious answer, and nothing is silently left out.
 *
 * ## Why one line is still what gets stored
 *
 * `Order.address` is one string, and CLAUDE.md is explicit that a column is not
 * invented to suit a screen. So the form is the only place the parts exist; the
 * order carries the composed line, which is also exactly what gets printed on
 * an invoice and pasted into a courier's booking page.
 *
 * The order below is Indonesian postal order — street, then village, district,
 * city, province, postcode — narrowest to widest, which is how an address is
 * read aloud here and how every delivery app asks for it.
 */

export interface AddressParts {
  /** Street and number, plus anything a courier needs to find the door. */
  street: string;
  /** Kelurahan / desa — the village or urban ward. */
  village: string;
  /** Kecamatan — the district above the village. */
  district: string;
  /** Kota or kabupaten. */
  city: string;
  province: string;
  /** Kode pos. Five digits in Indonesia, but not validated as such here. */
  postcode: string;
  /** Anything that is not part of the address: a landmark, a gate code. */
  notes: string;
}

export const EMPTY_ADDRESS: AddressParts = {
  street: "",
  village: "",
  district: "",
  city: "",
  province: "",
  postcode: "",
  notes: "",
};

/**
 * The fields, in the order they are asked and composed.
 *
 * Exported as data rather than written out in JSX so the form, the composer and
 * the completeness check cannot disagree about what an address is made of —
 * adding a field is one entry here.
 *
 * `required` marks what a courier genuinely cannot deliver without. A village
 * and a district are usual but not universal — plenty of city addresses are
 * found from the street and postcode alone — so they are asked for and not
 * insisted on.
 */
export const ADDRESS_FIELDS: readonly {
  key: keyof AddressParts;
  label: string;
  placeholder: string;
  required: boolean;
  /** Renders as a textarea rather than a single line. */
  long?: boolean;
}[] = [
  {
    key: "street",
    label: "Street and number",
    placeholder: "Jl. Kaliurang KM 5 No. 21",
    required: true,
    long: true,
  },
  {
    key: "village",
    label: "Kelurahan / desa",
    placeholder: "Caturtunggal",
    required: false,
  },
  {
    key: "district",
    label: "Kecamatan",
    placeholder: "Depok",
    required: false,
  },
  {
    key: "city",
    label: "City / regency",
    placeholder: "Sleman",
    required: true,
  },
  {
    key: "province",
    label: "Province",
    placeholder: "DI Yogyakarta",
    required: true,
  },
  {
    key: "postcode",
    label: "Postcode",
    placeholder: "55281",
    required: true,
  },
  {
    key: "notes",
    label: "Delivery notes",
    placeholder: "Green gate beside the laundry, ring the bell",
    required: false,
    long: true,
  },
];

/**
 * The parts as the one line that gets stored and printed.
 *
 * Blank parts are dropped rather than left as empty segments, so a half-filled
 * address reads as a short address instead of "Jl. Mawar 3, , , Sleman, , ".
 * The notes are separated by an em dash because they are not part of the
 * address proper — a courier's form takes them in a different box, and the dash
 * is where to cut.
 */
export function composeAddress(parts: AddressParts): string {
  const line = [
    parts.street,
    parts.village,
    parts.district,
    parts.city,
    parts.province,
    parts.postcode,
  ]
    .map((v) => v.trim())
    .filter((v) => v !== "")
    .join(", ");
  const notes = parts.notes.trim();
  if (line === "") return notes;
  return notes === "" ? line : `${line} — ${notes}`;
}

/**
 * Which required parts are still blank.
 *
 * Returns labels rather than keys, because every caller is about to show them
 * to somebody. An empty array means the address is good enough to ship to.
 */
export function missingAddressParts(parts: AddressParts): string[] {
  return ADDRESS_FIELDS.filter(
    (f) => f.required && parts[f.key].trim() === "",
  ).map((f) => f.label);
}
