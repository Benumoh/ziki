"use client";

import { useLayoutEffect } from "react";

/**
 * Keeps the page it is on in the light theme (#your-list is light only):
 * pins `data-theme="light"` on the root while mounted, which wins over both
 * the system preference and the toggle, and puts back what was there when
 * you leave.
 */
export function LightOnly() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const before = root.getAttribute("data-theme");
    root.setAttribute("data-theme", "light");
    return () => {
      if (before === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", before);
    };
  }, []);
  return null;
}
