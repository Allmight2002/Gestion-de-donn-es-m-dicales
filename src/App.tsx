import { BrowserRouter } from 'react-router-dom';
import { I18nProvider } from './i18n/I18nProvider';
import { AuthProvider } from './auth/AuthProvider';
import { RepositoryProvider } from './data/RepositoryProvider';
import { AppRoutes } from './routes/AppRoutes';
import { ErrorBoundary } from './components/ErrorBoundary';

export function App() {
  // ErrorBoundary sous I18nProvider (repli localise) mais AU-DESSUS de l'auth, des donnees et du
  // routeur : un plantage de rendu n'importe ou dans l'app montre un repli, jamais un ecran blanc.
  return (
    <I18nProvider>
      <ErrorBoundary>
        <AuthProvider>
          <RepositoryProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </RepositoryProvider>
        </AuthProvider>
      </ErrorBoundary>
    </I18nProvider>
  );
}
