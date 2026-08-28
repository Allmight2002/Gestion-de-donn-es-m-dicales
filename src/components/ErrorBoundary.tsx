// Filet anti-plantage (audit F-7) : une erreur de rendu non rattrapee afficherait un ECRAN BLANC.
// L'ErrorBoundary l'intercepte, journalise en INTERNE (reportClientError, sans fuite reseau) et
// montre un repli lisible + un bouton « recharger » -> le medecin n'est jamais bloque sur du vide.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportClientError } from '../lib/reportError';
import { useI18n } from '../i18n/useI18n';

function AppErrorFallback({ onReload }: { onReload: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="mx-auto mt-24 max-w-md rounded-2xl border border-red-100 bg-red-50 p-6 text-center">
      <h1 className="text-lg font-semibold text-red-800">{t('error.boundary_title')}</h1>
      <p className="mt-2 text-sm text-red-700">{t('error.boundary_body')}</p>
      <button onClick={onReload} className="btn-primary mt-4">{t('error.reload')}</button>
    </div>
  );
}

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportClientError(error, info.componentStack ?? undefined, 'react-render');
  }

  private handleReload = (): void => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) return <AppErrorFallback onReload={this.handleReload} />;
    return this.props.children;
  }
}
