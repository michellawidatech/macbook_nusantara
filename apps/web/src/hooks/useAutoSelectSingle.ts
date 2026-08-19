import { useEffect, useRef } from "react";
import { Form } from "antd";
import type { FormInstance } from "antd";

/** A form-store path, the shape `Form.Item`'s `name` and `setFields` take. */
export type FieldPath = string | (string | number)[];

/** What a lookup-backed control holds. Every one of them picks by id or code. */
export type OptionValue = string | number;

/**
 * Fills a lookup-backed field that has exactly ONE thing to choose.
 *
 * The master-data lists behind these controls are staff-editable (Settings),
 * so a shop running one storehouse, one courier or one payment method sees a
 * dropdown with a single entry and still has to open it and pick. This is the
 * client-side half of a rule the server already keeps: `store.ResolveLocationID`
 * resolves an order's stock location when exactly one is active and only
 * refuses on ambiguity, and `domain/twGeo.ts` fills a 區 for a 縣市 that has
 * only one.
 *
 * Four rules, each of which is a bug if dropped:
 *
 * 1. ONLY AN EMPTY FIELD is filled. An operator's own choice, an edit form's
 *    saved value and a prefill from a stock hold all outrank this.
 * 2. ONLY WHEN THE LIST HAS SETTLED (`enabled`). A lookup still in flight is
 *    an empty array, and one that has just returned its first of five is not
 *    a list of one — filling from either would write a value nobody chose.
 * 3. ONCE PER CANDIDATE SET. Every `EntitySelect` is `allowClear`, so clearing
 *    the sole option has to STICK; refilling it on the next render would make
 *    the field impossible to empty. A genuinely different set — the conditions
 *    of a newly picked variant — is a new question and fills again.
 * 4. `setFields`, NEVER `validateFields`. Concurrent `validateFields` calls
 *    cannibalise each other, and several fields settling on the same tick
 *    would each fire one. Writing the value and clearing the field's errors in
 *    one store write needs no validation pass at all.
 */
function useFillWhenSole<V extends OptionValue>(
  candidates: readonly V[],
  value: V | undefined | null,
  fill: (only: V) => void,
  enabled: boolean,
): void {
  // Read through a ref so an inline arrow at the call site does not make this
  // a different effect on every render.
  const fillRef = useRef(fill);
  fillRef.current = fill;

  // The candidate set already answered — not "have we ever filled", which
  // would be rule 3 backwards. `null` while there is nothing to answer.
  const settled = useRef<string | null>(null);

  const only = enabled && candidates.length === 1 ? candidates[0] : undefined;
  const signature = only === undefined ? null : String(only);

  useEffect(() => {
    if (
      signature === null ||
      only === undefined ||
      settled.current === signature
    ) {
      return;
    }
    // Marked whether or not it fills. A field that ALREADY holds something is
    // this set's answer just as much as one this call writes, so clearing it
    // afterwards must not be undone on the next render.
    settled.current = signature;
    if (value === undefined || value === null) {
      fillRef.current(only);
    }
  }, [signature, only, value]);
}

export interface AutoSelectSingleOptions<V extends OptionValue> {
  /** The values on offer, already narrowed by whatever the control excludes. */
  candidates: readonly V[];
  /** What the control currently holds. */
  value: V | undefined | null;
  /** Called with the sole candidate — normally `Form.Item`'s own `onChange`. */
  onPick: (only: V) => void;
  /** False while the list is loading or the control is disabled. */
  enabled?: boolean;
}

/**
 * The `value`/`onChange` form of the rule, for a control that is already
 * bound by `Form.Item` — see `EntitySelect`, which is its only caller today.
 * Writing through the injected `onChange` keeps the form store, `useWatch`
 * and `onFinish` in step exactly as a click on the option would.
 */
export function useAutoSelectSingle<V extends OptionValue>({
  candidates,
  value,
  onPick,
  enabled = true,
}: AutoSelectSingleOptions<V>): void {
  useFillWhenSole(candidates, value, onPick, enabled);
}

/**
 * The same rule for a plain `<Select>` inside a `Form.Item` — the stock and
 * product forms, which build their options inline rather than through
 * `EntitySelect`.
 *
 * Takes the form explicitly rather than reading `Form.useFormInstance()`:
 * `OrderFormPage` and the stock pages call this from the component that OWNS
 * the form, which is outside the `<Form>` that provides that context. A caller
 * inside a `Form.List` row passes `Form.useFormInstance()` itself.
 */
export function useAutoFillSingleOption<V extends OptionValue>(
  form: FormInstance,
  path: FieldPath,
  candidates: readonly V[],
  enabled = true,
): void {
  const value = Form.useWatch(path, form) as V | undefined;
  useFillWhenSole(
    candidates,
    value,
    (only) => {
      form.setFields([{ name: path, value: only, errors: [] }]);
    },
    enabled,
  );
}
