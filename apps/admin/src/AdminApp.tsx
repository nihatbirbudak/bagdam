import { BrowserRouter } from 'react-router-dom';
import { AdminRouter } from './app/router';
import { AdminAuthProvider } from './contexts/AdminAuthContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { Toaster } from './components/Toaster';
import { AdminErrorBoundary } from './components/AdminErrorBoundary';

/** Uygulama kökü: hata sınırı > router > kimlik > onay diyaloğu > toast. */
export function AdminApp() {
  return (
    <AdminErrorBoundary>
      <BrowserRouter>
        <AdminAuthProvider>
          <ConfirmProvider>
            <AdminRouter />
            <Toaster />
          </ConfirmProvider>
        </AdminAuthProvider>
      </BrowserRouter>
    </AdminErrorBoundary>
  );
}
