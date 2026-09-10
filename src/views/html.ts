export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );

export const safeExternalUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
};

export const formatTime = (value: string | null) => {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Unknown"
    : `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
};

const htmxConfig =
  '{"reportValidityOfForms":true,"includeIndicatorStyles":false,"historyRestoreAsHxRequest":false,"responseHandling":[{"code":"204","swap":false},{"code":"409","swap":true,"error":false},{"code":"422","swap":true,"error":false},{"code":"[23]..","swap":true},{"code":"[45]..","swap":false,"error":true},{"code":"...","swap":true}]}';

export const skipLink = `<a class="atlas-skip-link" href="#main-content">Skip to main content</a>`;

export const renderDocument = (title: string, content: string) => `<!doctype html>
<html lang="en" data-theme="atlas">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="htmx-config" content='${htmxConfig}'>
    <title>${escapeHtml(title)} | Atlas</title>
    <link rel="stylesheet" href="/assets/app.css">
    <script src="/assets/htmx.min.js" defer></script>
    <script src="/assets/app.js" defer></script>
  </head>
  <body class="min-h-screen bg-base-200 font-sans text-sm text-base-content">
    ${content}
  </body>
</html>`;
