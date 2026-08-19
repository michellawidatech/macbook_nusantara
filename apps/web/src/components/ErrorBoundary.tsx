import { Component, type ReactNode } from "react";
import { Result } from "antd";

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (this.state.error) {
      return (
        <Result
          status="error"
          title="Something broke on this page"
          subTitle={this.state.error.message}
        />
      );
    }
    return this.props.children;
  }
}
