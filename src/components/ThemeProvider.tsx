"use client";

import { createContext, useContext, useState, useEffect } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
    theme: Theme;
    resolved: "light" | "dark";
    setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
    theme: "system",
    resolved: "light",
    setTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

const COOKIE_NAME = "forta-appearance";
const VALID: Theme[] = ["light", "dark", "system"];

function getCookie(name: string): string | undefined {
    if (typeof document === "undefined") return undefined;
    const match = document.cookie.split("; ").find((c) => c.startsWith(name + "="));
    return match?.split("=")[1];
}

function setCookie(name: string, value: string) {
    document.cookie = `${name}=${value};path=/;domain=.appleby.cloud;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;
}

function getStoredTheme(): Theme {
    if (typeof document === "undefined") return "system";
    const value = getCookie(COOKIE_NAME) as Theme | undefined;
    return value && VALID.includes(value) ? value : "system";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeState] = useState<Theme>(getStoredTheme);
    const [resolved, setResolved] = useState<"light" | "dark">("light");

    // Write default cookie on first mount if absent
    useEffect(() => {
        if (!getCookie(COOKIE_NAME)) {
            setCookie(COOKIE_NAME, theme);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Apply .dark class and listen to system preference changes
    useEffect(() => {
        const mq = window.matchMedia("(prefers-color-scheme: dark)");

        const resolve = () => {
            const r = theme === "system" ? (mq.matches ? "dark" : "light") : theme;
            setResolved(r);
            const root = document.documentElement;
            root.classList.add("theme-transitioning");
            root.classList.toggle("dark", r === "dark");
            setTimeout(() => root.classList.remove("theme-transitioning"), 300);
        };

        resolve();
        mq.addEventListener("change", resolve);
        return () => mq.removeEventListener("change", resolve);
    }, [theme]);

    const setTheme = (t: Theme) => {
        setThemeState(t);
        setCookie(COOKIE_NAME, t);
    };

    return (
        <ThemeContext.Provider value={{ theme, resolved, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}
