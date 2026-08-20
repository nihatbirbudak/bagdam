import React from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

/** Uygulama kökündeki hata sınırı: render hatasında yenile / ana sayfa seçenekleri sunar. */
export class AdminErrorBoundary extends React.Component<Props, State> {
  declare props: Readonly<Props>;
  declare state: State;
  declare context: unknown;
  declare setState: React.Component<Props, State>['setState'];
  declare forceUpdate: React.Component<Props, State>['forceUpdate'];

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AdminErrorBoundary]', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-brand-100 px-6 py-12 text-center">
          <p className="text-2xl font-semibold text-brand-900">Bir hata oluştu</p>
          <p className="mt-2 max-w-md text-sm text-brand-600">
            Sayfa beklenmedik şekilde durdu. Sayfayı yenileyebilir veya özete dönebilirsiniz.
          </p>
          <div className="mt-8 flex items-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-dark"
            >
              Yenile
            </button>
            <a
              href="/"
              className="rounded-lg border border-brand-300 px-5 py-2.5 text-sm font-medium text-brand-700 hover:border-brand-400"
            >
              Özet
            </a>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
