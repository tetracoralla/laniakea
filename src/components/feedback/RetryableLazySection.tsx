import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useMemo,
  useState,
  type ComponentPropsWithRef,
  type ComponentType,
  type ReactNode,
} from "react";

interface LazyLoadBoundaryProps {
  canRetry: (error: unknown) => boolean;
  children: ReactNode;
  errorLabel: string;
  onRetry: () => void;
}

interface LazyLoadBoundaryState {
  error: unknown | null;
}

class LazyLoadBoundary extends Component<
  LazyLoadBoundaryProps,
  LazyLoadBoundaryState
> {
  state: LazyLoadBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): LazyLoadBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error === null) return this.props.children;
    // This boundary owns only the dynamic-import failure. A defect inside the
    // loaded section must still reach the application's normal error path.
    if (!this.props.canRetry(this.state.error)) throw this.state.error;
    return (
      <div className="overlay-backdrop lazy-load-failure-backdrop">
        <section aria-live="assertive" className="lazy-load-failure" role="alert">
          <p>{this.props.errorLabel}</p>
          <button onClick={this.props.onRetry} type="button">
            重试
          </button>
        </section>
      </div>
    );
  }
}

interface RetryableLazySectionOptions {
  errorLabel: string;
  loadingFallback: ReactNode;
}

/**
 * React.lazy permanently caches a rejected load. Rebuilding both the lazy
 * component and its error boundary gives a transient chunk failure one real,
 * user-triggered retry without reloading or discarding the current document.
 */
export function createRetryableLazySection<T extends ComponentType<any>>(
  loadModule: () => Promise<{ default: T }>,
  options: RetryableLazySectionOptions,
) {
  let request: Promise<{ default: T }> | null = null;
  let loadError: unknown | null = null;
  const loadOnce = () => {
    if (!request) {
      const attempt = loadModule();
      request = attempt;
      void attempt.catch((error) => {
        loadError = error;
        if (request === attempt) request = null;
      });
    }
    return request;
  };
  const preload = () => {
    void loadOnce().catch(() => undefined);
  };

  function RetryableLazyComponent(props: ComponentPropsWithRef<T>) {
    const [attempt, setAttempt] = useState(0);
    const LazyComponent = useMemo(() => lazy(loadOnce), [attempt]);
    const retry = useCallback(() => {
      request = null;
      loadError = null;
      setAttempt((current) => current + 1);
    }, []);
    const Rendered = LazyComponent as ComponentType<ComponentPropsWithRef<T>>;
    return (
      <LazyLoadBoundary
        canRetry={(error) => error === loadError}
        errorLabel={options.errorLabel}
        key={attempt}
        onRetry={retry}
      >
        <Suspense fallback={options.loadingFallback}>
          <Rendered {...props} />
        </Suspense>
      </LazyLoadBoundary>
    );
  }

  return { Component: RetryableLazyComponent, preload };
}
