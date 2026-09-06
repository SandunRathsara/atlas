(() => {
  const requestMessage = (status) => {
    if (status === 0) return "The request could not reach Atlas. Check the connection and try again.";
    if (status === 401) return "Your sign-in expired. Sign in again to retry.";
    if (status === 403) return "The request was rejected. Refresh the page and try again.";
    return "Atlas could not complete the request. Try again.";
  };

  document.body.addEventListener("htmx:afterRequest", (event) => {
    if (!event.detail.failed) return;

    const element = event.detail.elt;
    const form = element instanceof HTMLFormElement ? element : element.closest("form");
    const status = form?.querySelector("[data-form-status]");
    if (!status) return;

    status.hidden = false;
    status.className = "alert alert-error mt-4 leading-normal";
    status.textContent = requestMessage(event.detail.xhr?.status ?? 0);
  });

  document.body.addEventListener("htmx:afterSwap", () => {
    requestAnimationFrame(() => {
      const target = document.querySelector("[data-focus-on-swap]");
      if (!target) return;
      target.removeAttribute("data-focus-on-swap");
      target.focus();
    });
  });

  document.body.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const navigation = event.target instanceof Element ? event.target.closest("[data-mobile-navigation]") : null;
    if (!navigation?.open) return;
    event.preventDefault();
    navigation.open = false;
    navigation.querySelector("[data-mobile-navigation-trigger]")?.focus();
  });

  window.addEventListener("DOMContentLoaded", () => {
    document.querySelector("[data-focus-on-swap], [data-page-heading]")?.focus();
  });
})();
