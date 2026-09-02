import { Component, type ReactNode } from "react";
import { Button, Result } from "antd";

/**
 * The last thing between a thrown render and a blank screen.
 *
 * Two properties this needs and did not have:
 *
 * 1. **It must be mounted INSIDE the router**, wrapping the routed page and
 *    not the whole app — see `AppLayout`, which puts one around its `Outlet`.
 *    Above `BrowserRouter` the fallback replaces the sidebar and the router
 *    itself, so a throw on one page takes every other page with it and there
 *    is no way out but a manual reload. That is the outcome the placement was
 *    supposed to avoid.
 * 2. **It must be able to let go.** A boundary latches: once `error` is set it
 *    renders the fallback forever, and React gives it no signal that the user
 *    has navigated somewhere else. So the reset is explicit — `resetKey`,
 *    which `AppLayout` feeds the pathname, clears the error the moment the
 *    route changes, and the button below clears it on demand.
 *
 * The error's own message is deliberately NOT shown. A cashier mid-shift can
 * do nothing with "Cannot read properties of null (reading 'sku')", and it is
 * the same reasoning `errors.ts` records on the server: the detail is for the
 * log, never for the shop floor. It goes to the console instead, where a
 * developer with the tab open will find it.
 */
export class ErrorBoundary extends Component<
  {
    children: ReactNode;
    /**
     * Changing this clears a latched error. `AppLayout` passes the pathname,
     * so navigating away from a broken page is enough to recover.
     */
    resetKey?: string;
  },
  { error: Error | null }
> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override componentDidCatch(error: Error) {
    // The one place the detail goes. Not rendered — see the docblock.
    console.error("[ErrorBoundary]", error);
  }

  override render() {
    if (this.state.error) {
      return (
        <Result
          status="error"
          // Not translated, and it cannot be: this is a class component, so there
          // is no hook to read the catalogue with. It is also the one screen that
          // renders when the tree below it has already thrown, which is the worst
          // possible moment to add a dependency that could throw again.
          title="Something broke on this page"
          subTitle="Halaman ini gagal dimuat. Coba lagi, atau pilih menu lain."
          extra={
            <Button
              type="primary"
              onClick={() => this.setState({ error: null })}
            >
              Try again / Coba lagi
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}
