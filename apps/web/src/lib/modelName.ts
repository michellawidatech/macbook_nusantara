/**
 * What PRODUCT a model name is, and its name in full — moved to
 * `@nusantara/domain` (`catalogIdentity.ts`) on 2026-10-21 so the server
 * computes the same product key the browser does. Re-exported here because
 * the web modules import it from `lib/`.
 */
export {
  fullModelName,
  fullNameRenames,
  identityKey,
  modelIdentity,
  modelKeyOf,
  productKeyOf,
  variantKeyOf,
  type ModelIdentity,
} from "@nusantara/domain";
