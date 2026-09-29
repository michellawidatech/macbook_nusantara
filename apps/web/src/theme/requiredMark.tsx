import type { ReactNode } from "react";
import { RequiredAsterisk } from "./RequiredAsterisk";

/**
 * The app's required marker: a red `*` AFTER the label, on every form.
 *
 * Installed once on the single `ConfigProvider` (see `ThemeProvider`) as
 * `form={{ requiredMark: renderRequiredMark }}`. antd's `requiredMark` is a
 * FORM-level setting — `Form.Item` cannot override it — so the global config
 * is genuinely the only place this can be said once.
 *
 * ⚠️ A `requiredMark` prop on an individual `<Form>` beats this value
 * completely. That is why the five forms that carried `requiredMark="optional"`
 * had it deleted rather than left as a harmless duplicate: one left behind
 * would have gone on captioning its optional fields "(optional)" while every
 * other form in the app marked its required ones instead.
 * `requiredMark={false}` survives on four deliberately mark-free forms —
 * LoginPage and the three confirm/adjust modals — where every field is
 * required and marking them all would be noise rather than information.
 *
 * What antd does with a function, which is what makes this safe: it swaps the
 * label content for whatever we return AND switches the item's class to
 * `-required-mark-optional`, whose CSS sets `display: none` on the built-in
 * `::before`. There is no way to end up with two asterisks.
 *
 * An unrequired field returns the label untouched — no "(optional)", which is
 * what made a read-only `Form.Item` with no `rules` (the fixed parent
 * category on `CategoryFormPage`) read as though the category were optional
 * when it is mandatory and merely unchangeable.
 */
export function renderRequiredMark(
  label: ReactNode,
  { required }: { required: boolean },
): ReactNode {
  if (!required) {
    return label;
  }

  return (
    <>
      {label}
      <RequiredAsterisk />
    </>
  );
}
