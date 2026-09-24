/**
 * An antd form's values, kept on this device while they are being typed.
 *
 * The owner asked for the in-app tab strip to go and for everything typed to
 * be saved locally instead (2026-09-21). `usePersistentState` does that for a
 * page that holds its input in React state; this is the same promise for a
 * page whose input lives in an antd `Form`, which keeps its own store and
 * cannot be handed a hook's value.
 *
 * - The form is filled from the draft once, when it mounts.
 * - `onValuesChange` goes on the `<Form>` and writes every change.
 * - `clear` is for the two moments a draft stops being one: saved, and
 *   cancelled. A draft left behind by either would come back over the next,
 *   unrelated, form.
 *
 * `codec` converts what JSON cannot carry — a dayjs date, above all — and
 * `load` doubles as the guard on what an older build wrote.
 */
import { useCallback, useEffect } from "react";
import type { FormInstance } from "antd";
import { isRecord } from "../lib/draftGuards.js";

export interface FormDraftCodec<V> {
  /** Form values → something JSON can hold. */
  readonly save?: (values: V) => unknown;
  /** What was stored → form values, or nothing when it does not fit. */
  readonly load?: (stored: unknown) => Partial<V> | undefined;
}

export function useFormDraft<V>(
  form: FormInstance<V>,
  key: string,
  codec: FormDraftCodec<V> = {},
): { onValuesChange: () => void; clear: () => void } {
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return;
      const parsed: unknown = JSON.parse(raw);
      const values = codec.load
        ? codec.load(parsed)
        : isRecord(parsed)
          ? (parsed as Partial<V>)
          : undefined;
      // antd's own type for this is a recursive partial; a draft is a
      // partial of the same shape.
      if (values)
        form.setFieldsValue(
          values as Parameters<typeof form.setFieldsValue>[0],
        );
    } catch {
      // A draft that cannot be read is a form that starts empty, which is what
      // it did before drafts existed.
    }
    // Once per form: filling it again on every render would type over the
    // person typing in it.
  }, [key, form]);

  const onValuesChange = useCallback(() => {
    try {
      const all = form.getFieldsValue(true) as V;
      localStorage.setItem(
        key,
        JSON.stringify(codec.save ? codec.save(all) : all),
      );
    } catch {
      // Storage refused: the form still works, it just will not outlive the
      // page.
    }
    // `codec` is the caller's constant.
  }, [key, form]);

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing reachable to remove.
    }
  }, [key]);

  return { onValuesChange, clear };
}
