import React from "react";
import styles from "./ErrorBoundary.module.css";

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

// Top-level boundary so a render-time throw in any page shows a recoverable
// fallback instead of a blank white screen. Error boundaries must be class
// components — there is no hook equivalent for componentDidCatch.
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Uncaught render error", error, info);
  }

  handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className={styles.container} role="alert">
          <div className={styles.card}>
            <h1 className={styles.heading}>Something went wrong</h1>
            <p className={styles.body}>
              This page hit an unexpected error. Reloading usually fixes it.
            </p>
            <button
              className={styles.button}
              type="button"
              onClick={this.handleReload}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
