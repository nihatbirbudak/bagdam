import { useState, type FormEvent } from 'react';
import { AlertCircle, Loader2, Lock } from 'lucide-react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { PanelAccessError, useAdminAuth } from '../../contexts/AdminAuthContext';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/utils';

/** `?next=` yalnız aynı origin içi göreli yol olabilir (açık yönlendirme koruması). */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

interface LoginError {
  message: string;
  locked?: boolean;
}

/** API hata zarfını kullanıcı metnine çevirir (ADR-0009: 401 / 423 kilit / 429). */
export function loginErrorFromApi(err: unknown): LoginError {
  if (err instanceof PanelAccessError) return { message: err.message };
  if (err instanceof ApiError) {
    if (err.kind === 'locked') {
      return {
        locked: true,
        message: err.message && !/^locked$/i.test(err.message) ? err.message : 'Çok fazla hatalı deneme. Hesap 30 dakika kilitlendi.',
      };
    }
    if (err.kind === 'auth') return { message: err.message || 'E-posta veya parola hatalı' };
    if (err.kind === 'rate-limit') return { message: 'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.' };
    if (err.kind === 'not-found') return { message: 'Giriş servisi bulunamadı (API /auth/login).' };
    if (err.kind === 'validation') return { message: 'E-posta ve parola zorunludur.' };
    if (err.kind === 'network') return { message: err.message };
    if (err.kind === 'server') return { message: 'Sunucu hatası. Lütfen tekrar deneyin.' };
    return { message: err.message };
  }
  return { message: err instanceof Error ? err.message : 'Giriş başarısız' };
}

/**
 * Giriş (ekran 1) — GET /auth/csrf → POST /auth/login → httpOnly cookie → GET /auth/me → panel.
 * 401: "E-posta veya parola hatalı" · 423: 30 dk kilit · 429: throttle.
 */
export function AdminLoginPage() {
  const { login, isAuthenticated, loading: authLoading } = useAdminAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);

  // Oturum zaten varsa panele geç
  if (!authLoading && isAuthenticated) return <Navigate to={next} replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(loginErrorFromApi(err));
      setPassword('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-100 px-4">
      <div className="w-full max-w-sm rounded-xl border border-brand-300 bg-white p-8 shadow-sm">
        {/* Marka */}
        <div className="mb-6 text-center">
          <span
            className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-xl font-bold text-accent-light"
            aria-hidden
          >
            B
          </span>
          <h1 className="text-xl font-bold text-brand-900">Bağdam</h1>
          <p className="mt-1 text-sm text-brand-500">Yönetim Paneli</p>
        </div>

        {error && (
          <div
            role="alert"
            className={cn(
              'mb-4 flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
              error.locked ? 'border-butter-deep/40 bg-butter/40 text-butter-deep' : 'border-accent/30 bg-accent-light text-accent-dark',
            )}
          >
            {error.locked ? <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
            <span>{error.message}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="mb-4">
            <label htmlFor="login-email" className="mb-1 block text-xs font-medium text-brand-600">
              E-posta
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="username"
              inputMode="email"
              className="w-full rounded-md border border-brand-300 bg-white px-3 py-2.5 text-sm text-brand-900 placeholder:text-brand-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
              placeholder="ornek@bagdam.com"
            />
          </div>

          <div className="mb-6">
            <label htmlFor="login-password" className="mb-1 block text-xs font-medium text-brand-600">
              Parola
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full rounded-md border border-brand-300 bg-white px-3 py-2.5 text-sm text-brand-900 placeholder:text-brand-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-accent bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Giriş Yap
          </button>
        </form>

        <p className="mt-6 text-center text-[11px] text-brand-400">
          Yalnız yetkili personel (ADMIN / STAFF). Oturum çerez tabanlıdır; 5 hatalı denemede 30 dk kilit.
        </p>
      </div>
    </div>
  );
}
