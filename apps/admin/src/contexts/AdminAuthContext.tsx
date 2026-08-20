import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ensureCsrf } from '../lib/api';
import type { AuthUser, LoginResponse } from '../lib/apiTypes';

/*
 * Kimlik bağlamı — cookie tabanlı oturum (ADR-0009): API httpOnly `access_token` (path=/) ve
 * `refresh_token` (path=/api/v1/auth) çerezlerini set eder; panel token saklamaz.
 * Mutasyonlar CSRF header'ı ile gider (lib/api.ts). Akış: GET /auth/csrf → POST /auth/login → GET /auth/me.
 * Access 15 dk; 401'de lib/api.ts bir kez POST /auth/refresh dener (rotasyon), olmazsa `/login?next=` yönlendirir.
 */

const PANEL_ROLES = new Set(['ADMIN', 'STAFF']);

function hasPanelAccess(user: AuthUser | null | undefined): user is AuthUser {
  return !!user && PANEL_ROLES.has(String(user.role).toUpperCase());
}

/** `/auth/login` yanıtı `{ user }` zarfı; `/auth/me` doğrudan kullanıcı. İkisi de kabul edilir. */
function unwrapUser(payload: unknown): AuthUser | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as { user?: AuthUser; id?: unknown; email?: unknown };
  if (p.user && typeof p.user === 'object') return p.user;
  if (typeof p.id === 'string' && typeof p.email === 'string') return p as unknown as AuthUser;
  return null;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  loading: boolean;
}

export interface AdminAuthContextValue extends AuthState {
  /** ADMIN rolü (STAFF değil) — audit/sistem ekranları yalnız ADMIN'e. */
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<AuthUser | null>;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);
const ANON: AuthState = { user: null, isAuthenticated: false, loading: false };

export class PanelAccessError extends Error {
  constructor() {
    super('Bu hesabın yönetim paneline erişim yetkisi yok.');
    this.name = 'PanelAccessError';
  }
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, isAuthenticated: false, loading: true });

  const refreshMe = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const me = unwrapUser(await api.get<unknown>('/auth/me'));
      if (!hasPanelAccess(me)) {
        setState(ANON);
        return null;
      }
      setState({ user: me, isAuthenticated: true, loading: false });
      return me;
    } catch {
      // 401 (oturum yok) · ağ hatası → anonim; hata fırlatma (route kapısı /login'e yollar).
      setState(ANON);
      return null;
    }
  }, []);

  // Açılışta CSRF cookie'sini al ve oturumu doğrula (sayfa yenilemede de çalışır).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureCsrf();
      if (!cancelled) await refreshMe();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshMe]);

  const login = useCallback(async (email: string, password: string): Promise<AuthUser> => {
    await ensureCsrf();
    const res = await api.post<LoginResponse>('/auth/login', { email, password });
    let user = unwrapUser(res);
    if (!user) user = unwrapUser(await api.get<unknown>('/auth/me').catch(() => null));
    if (!user) throw new Error('Beklenmeyen sunucu yanıtı');
    if (!hasPanelAccess(user)) {
      await api.post('/auth/logout').catch(() => undefined);
      throw new PanelAccessError();
    }
    setState({ user, isAuthenticated: true, loading: false });
    return user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* oturum zaten yoksa sorun değil */
    }
    setState(ANON);
  }, []);

  const value = useMemo<AdminAuthContextValue>(
    () => ({
      ...state,
      isAdmin: String(state.user?.role ?? '').toUpperCase() === 'ADMIN',
      login,
      logout,
      refreshMe,
    }),
    [state, login, logout, refreshMe],
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
}
