/**
 * The id WhatsApp gave a sent message is kept on its outbox row (2026-10-23),
 * for a photo as for a reply: it is what an edit or an unsend from the inbox
 * names later, and the send pass used to log it and throw it away.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PrismaClient, enqueueOutbox, truncateAll } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { sendPass } from "../src/send.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";
const CREDS = {
  whatsappToken: "test-token",
  phoneNumberId: "1200651716467039",
  graphVersion: "v25.0",
};
const NOW = new Date("2026-10-23T03:00:00.000Z");
const logger = createLogger({ app: "worker", env: "test", level: "fatal" });

let db: PrismaClient;

beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: URL } } });
  await db.$connect();
});

afterAll(async () => {
  await truncateAll(db);
  await db.$disconnect();
});

beforeEach(async () => {
  await truncateAll(db);
});

/** One unit with one uploaded QC photo; returns the photo's id. */
async function aPhoto(): Promise<string> {
  await db.staff.create({
    data: {
      id: "st_qc",
      username: "qc",
      name: "QC",
      role: "STAFF",
      canApprove: false,
      active: true,
      passwordHash: "unusable",
      createdAt: NOW,
    },
  });
  await db.location.create({
    data: {
      id: "loc_s",
      code: "S1",
      name: "Toko",
      kind: "TOKO",
      active: true,
      sortOrder: 1,
    },
  });
  await db.category.create({
    data: {
      id: "cat_s",
      name: "MacBook",
      sortOrder: 1,
      marginMode: "PCT",
      marginMin: 5n,
      marginMax: 30n,
      createdAt: NOW,
    },
  });
  await db.catalogModel.create({
    data: {
      id: "mdl_s",
      categoryId: "cat_s",
      name: "MacBook Air M2",
      archived: false,
      createdAt: NOW,
    },
  });
  await db.sku.create({
    data: {
      id: "sku_s",
      modelId: "mdl_s",
      code: "SKU-S1",
      name: "MacBook Air M2 256GB",
      variantLabel: "8/256",
      grade: "A",
      price: 15_500_000n,
      landed: 12_000_000n,
      archived: false,
      createdAt: NOW,
    },
  });
  await db.unit.create({
    data: {
      id: "u_s",
      serial: "SPHOTO1",
      skuId: "sku_s",
      status: "QC",
      locationId: "loc_s",
      buy: 12_000_000n,
      landed: 12_000_000n,
      grade: "A",
      intakeAt: NOW,
      version: 1,
    },
  });
  const note = await db.unitNote.create({
    data: {
      unitId: "u_s",
      serial: "SPHOTO1",
      body: "QC",
      staffId: "st_qc",
      at: NOW,
    },
  });
  const photo = await db.unitNotePhoto.create({
    data: {
      noteId: note.id,
      url: "",
      sortOrder: 0,
      data: Buffer.from([0xff, 0xd8, 0xff]),
      contentType: "image/jpeg",
    },
  });
  return photo.id;
}

describe("the sent message's id", () => {
  it("is stored for a photo: the upload's id is not it, the send's is", async () => {
    const photoId = await aPhoto();
    await db.$transaction((tx) =>
      enqueueOutbox(tx, {
        kind: "WA_IMAGE",
        payload: { to: "628111000555", photoId },
        nextAttemptAt: NOW,
      }),
    );
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      const body = path.endsWith("/media")
        ? { id: "media-1" }
        : { messages: [{ id: "3EB0PHOTO" }] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await sendPass({
      db,
      logger,
      credentials: CREDS,
      maxSendsPerTick: 5,
      fetchImpl,
      now: () => NOW,
    });
    expect(result.sent).toBe(1);
    const row = await db.outbox.findFirstOrThrow({});
    expect(row.status).toBe("SENT");
    expect(row.providerMessageId).toBe("3EB0PHOTO");
    expect(row.retractedAt).toBeNull();
    expect(row.editedAt).toBeNull();
  });
});
