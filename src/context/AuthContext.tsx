"use client";

import { createContext, useContext, useEffect, useCallback, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { usePathname } from "next/navigation";
import {
  setUser,
  clearUser,
  selectUser,
  selectIsLoggedIn,
  selectIsLoading,
} from "@/store/slices/authSlice";
import { reqGetSelf, reqLogout } from "@/services/auth.service";
import { clearSilentSSO } from "@/tools/sso.tools";
import { User } from "@/types/auth.types";
import Cookies from "js-cookie";
import { loginHref } from "@/tools/routing.tools";
import { clearLoggedInFlag, forgetRefresh } from "@/tools/session.tools";

interface AuthContextValue {
  user: User | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoggedIn: false,
  isLoading: true,
  logout: async () => {},
});

export const useAuthContext = () => useContext(AuthContext);

// Paths reachable without an authenticated session.
const PUBLIC_PATHS = ["/login", "/unauthorized", "/pending"];

// The third and last place that sends a user to /login, and it carries the
// deep link for the same reason the other two do: this fires when the session
// check fails on a page the user asked for by URL, and blanking it costs them
// the zone and project selector along with the page.
function redirectToLogin(pathname: string) {
  if (!PUBLIC_PATHS.includes(pathname)) {
    window.location.href = loginHref(pathname + window.location.search);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const dispatch = useDispatch();
  const pathname = usePathname();
  const user = useSelector(selectUser);
  const isLoggedIn = useSelector(selectIsLoggedIn);
  const isLoading = useSelector(selectIsLoading);
  const role = user?.role;

  /**
   * Whether this mount has already asked for /auth/self.
   *
   * ⚠️ ONCE PER MOUNT, NOT ONCE PER NAVIGATION. The single effect this replaced
   * was keyed on `pathname`, so every click in the navbar re-fetched the same
   * user: one extra request per navigation, queued on the same six HTTP/1.1
   * sockets as the page's own reads. Once is enough because every way the
   * answer can change is a FULL page load that remounts this provider: login
   * (`login/page.tsx` assigns `window.location`), logout (below), an ended
   * session (`endSession`, `redirectToLogin`). The server still validates the
   * session on every API call; this only decides what the chrome shows.
   *
   * Set when the request is SENT, not when it lands, so a navigation while it
   * is in flight does not send a second one. Deliberately no `cancelled` flag:
   * the provider sits in the root layout and outlives every page, and a flag
   * would make React's dev double-invoke drop the only answer. Reset on /login,
   * where the user is cleared, so leaving it client-side loads them again.
   */
  const selfLoadedRef = useRef(false);

  // The cheap per-navigation checks: the cookie, the public paths and the
  // pending redirect. NO API call here; see `selfLoadedRef`.
  useEffect(() => {
    // Never attempt auth on the login page itself.
    if (pathname === "/login") {
      selfLoadedRef.current = false;
      dispatch(clearUser());
      return;
    }

    // The JS-readable mon-logged-in cookie is the cheap gate before we hit
    // the API. Absent → not authenticated. Re-checked on every navigation, so
    // a session ended in another tab still sends this one to /login on its
    // next click, without a request.
    if (!Cookies.get("mon-logged-in")) {
      dispatch(clearUser());
      redirectToLogin(pathname);
      return;
    }

    // Pending users are parked on the pending page until an admin approves.
    // Keyed on the role as well as the path: this is also what fires when the
    // self request below lands with `pending`.
    if (role === "pending" && pathname !== "/pending") {
      window.location.href = "/pending";
    }
  }, [dispatch, pathname, role]);

  // Who the user is, fetched once per mount. Keyed on `pathname` only so a
  // mount that STARTED on /login (or without the cookie) still loads the user
  // once it reaches a page that needs one; the ref makes every later run a
  // no-op.
  useEffect(() => {
    if (selfLoadedRef.current) return;
    if (pathname === "/login" || !Cookies.get("mon-logged-in")) return;
    selfLoadedRef.current = true;

    void (async () => {
      const res = await reqGetSelf();
      if (res.success) {
        dispatch(setUser(res.data));
        return;
      }
      dispatch(clearUser());
      // The path at the moment the answer LANDS, not the one the request left
      // from: the user may have navigated while it was in flight, and the deep
      // link should be the page they are on.
      redirectToLogin(window.location.pathname);
    })();
  }, [dispatch, pathname]);

  const logout = useCallback(async () => {
    // DELIBERATELY UNBRANCHED — the one call in this app that should ignore its
    // own result. Whatever the server says, the user asked to be logged out, so
    // the local session is cleared and the redirect happens either way. Refusing
    // to log out because the logout endpoint 500'd would trap someone in a
    // session they have explicitly abandoned, on a shared machine.
    const res = await reqLogout();
    forgetRefresh();
    // The server's Set-Cookie clears mon-logged-in too, but not when the logout
    // request failed — and a stale flag sends the next visit past /login.
    clearLoggedInFlag();
    clearSilentSSO();
    dispatch(clearUser());
    // Ends only Monitor's session; Forta and other apps stay signed in.
    // signed_out=1 keeps /login from signing straight
    // back in silently.
    window.location.href = (res.success && res.data?.redirect_url) || "/login?signed_out=1";
  }, [dispatch]);

  return (
    <AuthContext.Provider value={{ user, isLoggedIn, isLoading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
