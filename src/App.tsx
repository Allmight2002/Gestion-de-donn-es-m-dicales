import { BrowserRouter } from 'react-router-dom';
import { I18nProvider } from './i18n/I18nProvider';
import { AuthProvider } from './auth/AuthProvider';
import { RepositoryProvider } from './data/RepositoryProvider';
import { AppRoutes } from './routes/AppRoutes';

export function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <RepositoryProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </RepositoryProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
