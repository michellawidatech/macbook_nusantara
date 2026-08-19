import { useEffect, useState } from "react";
import { Form } from "antd";
import type { FormInstance, StepsProps } from "antd";

/** antd's own union for one `Steps` item's state — it exports the items array
 * but not the item interface, so it is read back off the prop. */
type StepStatus = NonNullable<StepsProps["items"]>[number]["status"];

/** One step: what it is called, and which of the form's ROOT field names it
 * owns. A path belongs to the step that owns its root name, so `['lines']`
 * covers every field inside every order line. */
export interface FormStep {
  title: string;
  fields: readonly string[];
}

export interface UseFormStepsOptions {
  /**
   * Tick a step only once it has actually been REACHED, on top of its fields
   * passing.
   *
   * Off by default, which is the behaviour every existing caller was built
   * against: a step ticks the moment its required fields validate, whether or
   * not the operator has been there. That is right for a wizard whose every
   * step has required fields — the mark then means "nothing here is missing",
   * and forcing a visit would just be ceremony.
   *
   * It goes wrong for a step with NO required fields, which validates
   * vacuously and therefore ticks before it has ever been opened. On a form
   * with two mostly-optional steps that reads as "you are done" on first
   * paint. Turning this on makes the mark mean "you have been here and
   * nothing is wrong", which is what a tick is taken to mean.
   *
   * It does NOT gate anything: Save and the Steps bar behave identically
   * either way. Only the icon changes.
   */
  tickOnlyVisited?: boolean;
}

export interface UseFormStepsResult {
  current: number;
  setCurrent: (step: number) => void;
  /** Ready for `<Steps items={...} />` — titles with live tick marks. */
  items: NonNullable<StepsProps["items"]>;
  /** Advance, but only once this step's own fields pass. */
  goNext: () => Promise<void>;
  goBack: () => void;
  isFirst: boolean;
  isLast: boolean;
  /** Pass to `<Form onFinishFailed>` so a refused save lands on the step
   * holding the offending field. */
  onFinishFailed: () => void;
  /** Whether every field of every step currently passes. */
  allComplete: boolean;
}

/**
 * The multi-step form machinery `ProductFormPage` pioneered, extracted so
 * `OrderFormPage` gets the same behaviour rather than a second copy of it.
 *
 * A wizard hides most of its own form, and that is the problem this solves:
 * without a map from field to step, a save refused because of a blank field on
 * step 1 puts a red outline on an input nobody can see from step 2, and reads
 * as the Save button simply not working. `steps[].fields` is the single map —
 * the tick marks, the "Next" gate and the jump-to-the-error on submit all read
 * it, rather than keeping copies that drift the first time a field moves.
 *
 * ⚠️ ONE `validateFields` CALL FOR ALL STEPS, AND IT MUST STAY ONE. antd parks
 * its promise in a single form-wide `lastValidatePromise` slot, so concurrent
 * calls cannibalise each other: whichever starts last wins and every earlier
 * one settles as `outOfDate` with an EMPTY `errorFields` — indistinguishable
 * from "this passed" unless the flag is checked. A call per step therefore
 * reported the last step honestly and marked every other one failed forever.
 * Validating everything at once and bucketing the errors by root name cannot
 * race with itself.
 */
export function useFormSteps(
  form: FormInstance,
  steps: readonly FormStep[],
  options: UseFormStepsOptions = {},
): UseFormStepsResult {
  const [current, setCurrent] = useState(0);
  /** The furthest step reached, so a tick survives stepping BACK — having
   * been somewhere is not undone by leaving it. */
  const [furthest, setFurthest] = useState(0);
  /** One flag per step, in `steps` order. See the effect that fills it. */
  const [complete, setComplete] = useState<boolean[]>(() =>
    steps.map(() => false),
  );

  // The whole store, watched as one, purely to drive the tick marks.
  const allValues = Form.useWatch([], form);

  /** Which step owns a form path, by its ROOT name. `-1` when none does. */
  const stepOfPath = (path: readonly (string | number)[]): number =>
    steps.findIndex((step) => step.fields.includes(String(path[0])));

  useEffect(() => {
    let alive = true;
    const settle = (errorFields: readonly { name: (string | number)[] }[]) => {
      // A rule may be debounced and ask the server, so a check started
      // earlier can land later — and after an unmount, later still.
      if (!alive) {
        return;
      }
      const failed = new Set(
        errorFields.map((field) => stepOfPath(field.name)),
      );
      setComplete(steps.map((_step, index) => !failed.has(index)));
    };

    void form
      .validateFields({ validateOnly: true })
      .then(() => settle([]))
      .catch(
        (rejection: {
          errorFields?: { name: (string | number)[] }[];
          outOfDate?: boolean;
        }) => {
          // Abandoned mid-flight because a "Next" press or a submit started its
          // own validation. Nothing was learned, and the store has not moved
          // since — so the marks already on screen are still the right answer.
          if (!rejection.outOfDate) {
            settle(rejection.errorFields ?? []);
          }
        },
      );

    return () => {
      alive = false;
    };
    // `steps` is a module-level constant at every call site; listing it would
    // re-run this on every render for a caller that built it inline. (No
    // eslint-disable here: react-hooks is not among this repo's plugins, so
    // the suppression named a rule that never ran and eslint failed on it.)
  }, [allValues, form]);

  /**
   * How one step's marker reads: ticked once its fields pass, wherever the
   * operator happens to be standing.
   *
   * `process` is kept for the step being worked on while it is still
   * incomplete, and nothing is lost by dropping it once it finishes: in antd
   * v6 `process` and `finish` share every colour, differing only in the glyph
   * (the step number against a check), and "you are here" is drawn from
   * `current` alone — the item at `current` gets the solid primary disc from
   * `-item-active`, whatever status it carries.
   */
  const statusOf = (index: number): StepStatus => {
    const visited = !options.tickOnlyVisited || index <= furthest;
    if (complete[index] && visited) {
      return "finish";
    }
    return index === current ? "process" : "wait";
  };

  /**
   * Advances only once this step's own fields pass.
   *
   * `recursive` is what stops this disagreeing with the tick beside it. A bare
   * `['lines']` validates the `Form.List`'s own rules — at least one row — and
   * NOT the required fields inside each row, so a blank line would leave the
   * step unticked while "Next" waved it through, and the miss would surface
   * only at Save. Skipping ahead stays possible — the Steps bar itself is
   * clickable — so this gate refuses nothing it cannot route around.
   */
  const goNext = async () => {
    try {
      await form.validateFields(steps[current]!.fields as string[], {
        recursive: true,
      });
      setCurrent((step) => {
        const next = Math.min(step + 1, steps.length - 1);
        setFurthest((seen) => Math.max(seen, next));
        return next;
      });
    } catch {
      // validateFields has already painted the offending fields; there is
      // nothing to add here, and rethrowing would surface as an unhandled
      // rejection in the console for an ordinary "you missed a field".
    }
  };

  /** The first step holding a field that currently has an error. */
  const stepOfFirstError = (): number => {
    const errored = form
      .getFieldsError()
      .filter((field) => field.errors.length > 0);
    for (const field of errored) {
      const index = stepOfPath(field.name);
      if (index >= 0) {
        return index;
      }
    }
    return current;
  };

  const goTo = (step: number) => {
    setCurrent(step);
    setFurthest((seen) => Math.max(seen, step));
  };

  return {
    current,
    // Jumping straight to a step from the Steps bar counts as reaching it,
    // and every step passed over on the way as well — which is what the
    // high-water mark records.
    setCurrent: goTo,
    items: steps.map((step, index) => ({
      title: step.title,
      status: statusOf(index),
    })),
    goNext,
    goBack: () => setCurrent((step) => Math.max(step - 1, 0)),
    isFirst: current === 0,
    isLast: current === steps.length - 1,
    onFinishFailed: () => goTo(stepOfFirstError()),
    allComplete: complete.every(Boolean),
  };
}
