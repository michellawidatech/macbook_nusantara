/** Every collection's adapter, by the collection's name. */
import type { CollectionName } from "@nusantara/store";
import type { Adapter } from "../context.js";
import {
  categories,
  gradingCriteria,
  gradingRules,
  models,
  skus,
} from "./catalogue.js";
import {
  deposits,
  opnames,
  orders,
  paymentLog,
  pos,
  reservations,
  returns,
  services,
  settlementLog,
  settlements,
} from "./documents.js";
import {
  customers,
  discounts,
  expenses,
  incomes,
  knowledge,
  paymentMethods,
  qcDescriptions,
  racks,
  reasons,
  referralSources,
  reservationSources,
  salesmen,
  suppliers,
  warehouses,
} from "./reference.js";
import { chats, corrections, personas } from "./singletons.js";
import { adjustments, events, stockIns, unitNotes, units } from "./units.js";
import { stockMoves } from "./stock.js";

export const ADAPTERS: { readonly [C in CollectionName]: Adapter<C> } = {
  paymentMethods,
  warehouses,
  racks,
  suppliers,
  reasons,
  qcDescriptions,
  reservationSources,
  referralSources,
  salesmen,
  categories,
  models,
  gradingCriteria,
  gradingRules,
  skus,
  customers,
  discounts,
  knowledge,
  deposits,
  pos,
  units,
  reservations,
  orders,
  returns,
  opnames,
  services,
  settlements,
  events,
  stockMoves,
  unitNotes,
  stockIns,
  adjustments,
  expenses,
  incomes,
  paymentLog,
  settlementLog,
  chats,
  corrections,
  personas,
};

/** The adapter for a collection named at run time. */
export function adapterOf(name: CollectionName): Adapter<CollectionName> {
  return ADAPTERS[name] as unknown as Adapter<CollectionName>;
}
