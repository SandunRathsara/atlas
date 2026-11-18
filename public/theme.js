// Loaded without defer in <head> so the per-browser theme override applies before first paint.
// Auto (no stored value) leaves data-theme unset and the stylesheet follows prefers-color-scheme.
(() => {
  const root = document.documentElement;
  root.dataset.js = "";
  try {
    const mode = localStorage.getItem("atlas-theme");
    if (mode === "light" || mode === "dark") root.dataset.theme = `atlas-${mode}`;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); Auto still works.
  }
})();
