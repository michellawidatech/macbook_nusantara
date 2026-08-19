import { theme } from "antd";

/**
 * The red `*` that marks a required field, sized and coloured exactly as
 * antd's own built-in marker.
 *
 * A component rather than an inline element so it can read
 * `theme.useToken()`. The renderer that returns it (`requiredMark.ts`) is
 * handed to `ConfigProvider`, which is where the theme is *installed* — a
 * hook called there would read the context from outside it and resolve to
 * antd's defaults. What the renderer RETURNS is rendered deep inside the
 * `Form.Item` label, well within the provider, so the lookup here lands on
 * the app's real theme in both colour schemes.
 *
 * `colorError` and `marginXXS` are antd's own choices for this mark —
 * `labelRequiredMarkColor` is literally `token.colorError` in the Form
 * styles — so a form using our renderer is indistinguishable in colour and
 * spacing from one using the built-in marker. Only the side changes.
 *
 * Not `aria-hidden`. antd's built-in mark is a CSS `::before`, and the
 * library sets no `aria-required` on the control, so the asterisk is the ONLY
 * signal that a field is mandatory. Hiding it from assistive tech would make
 * moving it to the right a regression for screen-reader users.
 */
export function RequiredAsterisk() {
  const { token } = theme.useToken();

  return (
    <span
      style={{
        marginInlineStart: token.marginXXS,
        color: token.colorError,
        // antd's own mark forces sans-serif so the glyph is a star rather
        // than whatever the label's font makes of `*`. Matching it keeps the
        // two renderings identical while both exist in the app.
        fontFamily: "sans-serif",
        lineHeight: 1,
      }}
    >
      *
    </span>
  );
}
