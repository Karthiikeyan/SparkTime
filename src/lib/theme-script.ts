/**
 * Runs before first paint to apply the saved theme (no flash of the wrong
 * theme). It is a static constant with no user data; the admin CSP allows it
 * by SHA-256 hash (see proxy.ts), the public CSP by 'self'/'unsafe-inline'.
 */
export const THEME_STORAGE_KEY = "theme";

export const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem("${THEME_STORAGE_KEY}");var d=s==="dark"||((!s||s==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){document.documentElement.dataset.theme="light";}})();`;
