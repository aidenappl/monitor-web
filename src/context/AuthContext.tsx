"use client";

import { createContext, useContext, useEffect, useCallback } from "react";
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
import { User } from "@/types/auth.types";
import Cookies from "js-cookie";

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const dispatch = useDispatch();
  const pathname = usePathname();
  const user = useSelector(selectUser);
  const isLoggedIn = useSelector(selectIsLoggedIn);
  const isLoading = useSelector(selectIsLoading);

  const redirectToLogin = () => {
    if (!PUBLIC_PATHS.includes(pathname)) {
      window.location.href = "/login";
    }
  };

  useEffect(() => {
    const init = async () => {
      // Never attempt auth on the login page itself.
      if (pathname === "/login") {
        dispatch(clearUser());
        return;
      }

      // The JS-readable mon-logged-in cookie is the cheap gate before we hit
      // the API. Absent → not authenticated.
      const loggedIn = Cookies.get("mon-logged-in");
      if (!loggedIn) {
        dispatch(clearUser());
        redirectToLogin();
        return;
      }

      const res = await reqGetSelf();
      if (res.success) {
        dispatch(setUser(res.data));

        // Pending users are parked on the pending page until an admin approves.
        if (res.data.role === "pending") {
          if (pathname !== "/pending") {
            window.location.href = "/pending";
          }
          return;
        }
      } else {
        dispatch(clearUser());
        redirectToLogin();
      }
    };

    init();
  }, [dispatch, pathname]);

  const logout = useCallback(async () => {
    await reqLogout();
    dispatch(clearUser());
    window.location.href = "/login";
  }, [dispatch]);

  return (
    <AuthContext.Provider value={{ user, isLoggedIn, isLoading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
