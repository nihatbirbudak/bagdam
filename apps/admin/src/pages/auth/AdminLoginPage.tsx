import { useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { ApiError } from '../../lib/api';

/** `?next=` yalnız aynı origin içi göreli yol olabilir (açık yönlendirme koruması). */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

function loginErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'not-found') return 'Giriş servisi henüz etkin değil (F4 fazında bağlanacak).';
    if (err.kind === 'auth') return 'E-posta veya şifre hatalı.';
    if (err.kind === 'rate-limit') return 'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.';
    if (err.kind === 'network') return err.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Giriş başarısız';
}

/**
 * Giriş sayfası — UI hazır; API F4'te (AuthModule) bağlanır.
 * Akış: POST /auth/login → httpOnly cookie → /auth/me → panel.
 */
export function AdminLoginPage() {
  const { login, isAuthenticated, loading: authLoading, authDisabled } = useAdminAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Oturum zaten varsa panele geç
  if (!authLoading && isAuthenticated) return <Navigate to={next} replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(loginErrorMessage(err));
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

        {authDisabled && (
          <div className="mb-4 rounded-md border border-butter-deep/30 bg-butter/40 px-3 py-2 text-xs text-butter-deep">
            Geliştirme modu: kimlik kapısı kapalı (<code className="font-mono">VITE_AUTH_DISABLED=true</code>).{' '}
            <Link to={next} className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline">
              Panele geç <ArrowRight size={12} aria-hidden />
            </Link>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-4 flex items-center gap-2 rounded-md border border-accent/30 bg-accent-light px-3 py-2 text-xs text-accent-dark"
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {error}
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
              Şifre
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
          Yalnız yetkili personel. Oturum çerez tabanlıdır; 5 hatalı denemede 30 dk kilit.
        </p>
      </div>
    </div>
  );
}
