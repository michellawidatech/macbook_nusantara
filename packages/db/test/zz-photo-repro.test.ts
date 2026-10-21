import { beforeAll, afterAll, it, expect } from "vitest";
import { decodeStore, diffStore, encodeChangeset, type Row, type StoreShape } from "@nusantara/store";
import { PrismaClient, commitStore, snapshotStore, truncateAll } from "../src/index.js";
const URL = "postgresql://nusantara@localhost:5432/nusantara_photo_repro";
const APP = "postgresql://nusantara_app@localhost:5432/nusantara_photo_repro";
let db: PrismaClient, app: PrismaClient;
const NOW = new Date("2026-09-13T03:00:00.000Z");
beforeAll(async () => { db = new PrismaClient({ datasourceUrl: URL }); app = new PrismaClient({ datasourceUrl: APP }); });
afterAll(async () => { await db.$disconnect(); await app.$disconnect(); });
it("photo survives", async () => {
  await truncateAll(db);
  for (const [i, name] of ["Store Test", "Michella", "Dimas Pratama", "Ayu Lestari"].entries())
    await db.staff.create({ data: { id: i === 0 ? "staff_store_test" : `s${i}`, username: `u${i}`, name, role: "OWNER", canApprove: true, active: true, passwordHash: "x", createdAt: NOW } });
  const mod = await import(/* @vite-ignore */ new globalThis.URL("../../../apps/web/src/mock/seed.ts", import.meta.url).href) as any;
  const shop = mod.buildSeed();
  const empty: any = {}; for (const [k, v] of Object.entries(shop)) empty[k] = Array.isArray(v) ? [] : v;
  empty.chats = shop.chats; empty.corrections = shop.corrections; empty.personas = shop.personas;
  empty.settings = { batteryGoodMin: 80, batteryFairMin: 76 }; empty.appleDbHidden = []; empty.myWarehouseId = "";
  await commitStore(db, { staffId: "staff_store_test", changes: encodeChangeset(diffStore(empty as StoreShape, shop as StoreShape)), mode: "import", now: NOW });
  const snap0 = decodeStore((await snapshotStore(app, { staffId: "staff_store_test" })).db) as any;
  const unit = (snap0.units as Row[]).find((u) => u["status"] === "TERSEDIA")!;
  const existing = (snap0.unitNotes as Row[]).filter((n) => n["serial"] === unit["serial"]);
  console.log("existing notes", existing.length);
  const note = { id: "note-photo-1", serial: unit["serial"], body: "", tag: "QC", staff: "Store Test", at: "2026-09-13T04:00:00.000Z",
    photos: [{ id: "ph-1", url: "data:image/jpeg;base64," + Buffer.alloc(300_000, 7).toString("base64"), sortOrder: 0 }] };
  const res = await commitStore(app, { staffId: "staff_store_test", changes: encodeChangeset(diffStore({ unitNotes: [] }, { unitNotes: [note] })) });
  console.log("commit answer notes", JSON.stringify((res as any).db?.unitNotes ?? Object.keys(res)).slice(0, 300));
  const snap = decodeStore((await snapshotStore(app, { staffId: "staff_store_test" })).db) as any;
  const back = (snap.unitNotes as Row[]).find((n) => n["id"] === "note-photo-1");
  console.log("after refresh", JSON.stringify(back)?.slice(0, 300));
  expect(back).toBeDefined();
}, 120_000);
