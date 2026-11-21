"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useServerTheme } from "@/components/theme-toggle";
import { isExternalPage } from "@/lib/external-pages";
import { parseTheme, themeAttribute } from "@/lib/theme";

/**
 * Keeps the public pages light (#external-pages-light) across client-side navigation: the server pins light on the
 * first load of one, and this puts the visitor's own theme back when they move into the app (and light again when
 * they come back).
 */
export function ExternalPageTheme() {
  const pathname = usePathname();
  const serverTheme = useServerTheme();
  useEffect(() => {
    const root = document.documentElement;
    if (isExternalPage(pathname)) {
      root.setAttribute("data-theme", "light");
      return;
    }
    let theme = serverTheme;
    try {
      const saved = window.localStorage.getItem("theme");
      if (saved) theme = parseTheme(saved);
    } catch { /* Storage may be unavailable in private browsing. */ }
    const attr = themeAttribute(theme);
    if (attr) root.setAttribute("data-theme", attr);
    else root.removeAttribute("data-theme");
  }, [pathname, serverTheme]);
  return null;
}
