import { vi } from "vitest";
import type { PrismaClient } from "@nusantara/db";

/**
 * Test harness: replace the Prisma singleton with an in-memory double so the
 * persistence, cache and tool code run against stubbable mocks — no database.
 *
 * The double is registered with `vi.doMock("@nusantara/db")`, so it only applies
 * to modules imported *after* the call. Always dynamic-import the code under test:
 *
 *   const { db } = mockDb();
 *   const { persistInbound } = await import("../persist.js");
 */

type MockFn = ReturnType<typeof vi.fn>;
type ModelKeys = Exclude<keyof PrismaClient, symbol | `$${string}`>;

export type PrismaMock = {
  [K in ModelKeys]: { [M in keyof PrismaClient[K]]: MockFn };
} & { $transaction: MockFn };

export function makePrismaMock(): PrismaMock {
  const models = new Map<string, Record<string, ReturnType<typeof vi.fn>>>();

  const target = {
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === "function"
        ? (arg as (tx: unknown) => unknown)(proxy)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  } as PrismaMock;

  const proxy = new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return (t as Record<string, unknown>)[prop];
      if (typeof prop !== "string" || prop.startsWith("$")) return undefined;
      let model = models.get(prop);
      if (!model) {
        model = new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
          get(mt, method: string) {
            if (typeof method !== "string") return undefined;
            if (!mt[method]) mt[method] = vi.fn();
            return mt[method];
          },
          has: () => true,
        });
        models.set(prop, model);
      }
      return model;
    },
  }) as PrismaMock;

  return proxy;
}

/** Mock @nusantara/db's prisma for the current test module. */
export function mockDb() {
  const db = makePrismaMock();
  vi.doMock("@nusantara/db", () => ({ prisma: db }));
  return { db };
}
