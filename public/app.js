(() => {
  let inboxPollContext;

  const requestMessage = (status) => {
    if (status === 0) return "The request could not reach Atlas. Check the connection and try again.";
    if (status === 401) return "Your sign-in expired. Sign in again to retry.";
    if (status === 403) return "The request was rejected. Refresh the page and try again.";
    if (status === 503) return "Atlas could not durably record this change. Ownership remains held; keep the form and try again.";
    return "Atlas could not complete the request. Try again.";
  };

  document.body.addEventListener("htmx:afterRequest", (event) => {
    const element = event.detail.elt;
    if (element instanceof Element && element.id === "inbox-list" && (event.detail.failed || event.detail.xhr?.status === 0)) {
      inboxPollContext = undefined;
    }
    if (!event.detail.failed && event.detail.xhr?.status !== 0) return;

    // Inbox desktop pane: swap the skeleton for the error banner with a link to the real page.
    if (element instanceof Element && element.classList.contains("ix-pane-load")) {
      const error = element.closest(".ix-pane")?.querySelector(".ix-pane-error");
      if (error instanceof HTMLElement) {
        element.remove();
        error.hidden = false;
      }
      return;
    }

    const form = element instanceof HTMLFormElement ? element : element.closest("form");
    const status = form?.querySelector("[data-form-status]");
    if (!status) return;

    status.hidden = false;
    status.className = "ax-banner ax-error";
    status.textContent = requestMessage(event.detail.xhr?.status ?? 0);
  });

  // The Inbox desktop pane shows another page's content inside this one. Keep one page heading
  // (the Inbox h1): demote the pane's h1 to h2, drop its focus hooks and rename clashing ids.
  const adoptPane = (pane) => {
    const fresh = [...pane.querySelectorAll("[id]")];
    const outside = new Set([...document.querySelectorAll("[id]")].filter((node) => !pane.contains(node)).map((node) => node.id));
    const renamed = new Map();
    fresh.forEach((node) => {
      if (!outside.has(node.id)) return;
      renamed.set(node.id, `pane-${node.id}`);
      node.id = `pane-${node.id}`;
    });
    pane.querySelectorAll("[aria-labelledby], [aria-describedby], [aria-controls], label[for], a[href^='#']").forEach((node) => {
      ["aria-labelledby", "aria-describedby", "aria-controls", "for"].forEach((name) => {
        const value = node.getAttribute(name);
        if (value) node.setAttribute(name, value.split(/\s+/).map((id) => renamed.get(id) ?? id).join(" "));
      });
      const href = node.getAttribute("href");
      if (href?.startsWith("#") && renamed.has(href.slice(1))) node.setAttribute("href", `#${renamed.get(href.slice(1))}`);
    });
    pane.querySelectorAll("[data-focus-on-swap]").forEach((node) => node.removeAttribute("data-focus-on-swap"));
    pane.querySelectorAll("h1").forEach((h1) => {
      const h2 = document.createElement("h2");
      [...h1.attributes].forEach((attribute) => {
        if (attribute.name !== "data-page-heading" && attribute.name !== "tabindex") h2.setAttribute(attribute.name, attribute.value);
      });
      h2.append(...h1.childNodes);
      h1.replaceWith(h2);
    });
  };

  document.body.addEventListener("htmx:afterSwap", (event) => {
    // outerHTML swaps detach the requesting element, so look for a freshly loaded pane instead.
    const pane = document.querySelector(".ix-pane:not([data-adopted])");
    if (pane instanceof HTMLElement && !pane.querySelector(".ix-pane-load")) {
      pane.dataset.adopted = "";
      adoptPane(pane);
    }
    if (inboxPollContext && event.detail.elt instanceof Element && event.detail.elt.id === "inbox-list") {
      const root = document.getElementById("inbox-list");
      if (root instanceof HTMLElement) {
        const scroll = root.querySelector("[data-inbox-scroll]");
        if (scroll) scroll.scrollTop = inboxPollContext.scrollTop;
        inboxPollContext.details.forEach(({ id, open }) => {
          const detail = id ? document.getElementById(id) : null;
          if (detail instanceof HTMLDetailsElement && root.contains(detail)) detail.open = open;
        });
        if (inboxPollContext.focused) {
          const active = inboxPollContext.activeId ? document.getElementById(inboxPollContext.activeId) : null;
          if (active instanceof HTMLElement && root.contains(active)) active.focus({ preventScroll: true });
          else root.focus({ preventScroll: true });
        }
      }
      inboxPollContext = undefined;
    }
    requestAnimationFrame(() => {
      const target = document.querySelector("[data-focus-on-swap]");
      if (!target) return;
      target.removeAttribute("data-focus-on-swap");
      target.focus({ preventScroll: true });
    });
    startSessionViewer();
  });

  document.body.addEventListener("htmx:beforeRequest", (event) => {
    const element = event.detail.elt;
    if (!(element instanceof HTMLElement) || element.id !== "inbox-list") return;
    const active = document.activeElement instanceof HTMLElement && element.contains(document.activeElement)
      ? document.activeElement
      : null;
    inboxPollContext = {
      activeId: active?.id || null,
      focused: Boolean(active),
      details: [...element.querySelectorAll("details")].map((detail) => ({ id: detail.id, open: detail.open })),
      scrollTop: element.querySelector("[data-inbox-scroll]")?.scrollTop ?? 0,
    };
  });

  document.body.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const navigation = event.target instanceof Element ? event.target.closest("[data-mobile-navigation]") : null;
    if (!navigation?.open) return;
    event.preventDefault();
    navigation.open = false;
    navigation.querySelector("[data-mobile-navigation-trigger]")?.focus();
  });

  // ── Frame: menus, confirms, theme, exact times ───────────────────────
  const closeMenu = (menu, focusSummary) => {
    menu.open = false;
    if (focusSummary) menu.querySelector(":scope > summary")?.focus();
  };

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const open = event.target instanceof Element ? event.target.closest("details[data-menu][open], details[data-confirm][open]") : null;
    const menu = open || document.querySelector("details[data-menu][open], details[data-confirm][open]");
    if (!(menu instanceof HTMLDetailsElement)) return;
    event.preventDefault();
    closeMenu(menu, true);
  });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const close = target?.closest("[data-menu-close], [data-confirm-cancel]");
    if (close) {
      const menu = close.closest("details");
      if (menu) closeMenu(menu, true);
      return;
    }
    // Outside click closes open menus. The phone sheet backdrop is summary::before, so a click on
    // it lands on the summary and toggles the menu closed natively.
    document.querySelectorAll("details[data-menu][open]").forEach((menu) => {
      if (!target || !menu.contains(target)) menu.open = false;
    });
  });

  // Opening one menu closes the others.
  document.addEventListener("toggle", (event) => {
    const menu = event.target;
    if (!(menu instanceof HTMLDetailsElement) || !menu.open || !menu.hasAttribute("data-menu")) return;
    document.querySelectorAll("details[data-menu][open]").forEach((other) => {
      if (other !== menu && !other.contains(menu)) other.open = false;
    });
  }, true);

  const themeKey = "atlas-theme";
  const readTheme = () => {
    try {
      const mode = localStorage.getItem(themeKey);
      return mode === "light" || mode === "dark" ? mode : "auto";
    } catch {
      return "auto";
    }
  };
  const syncThemeControls = (mode) => {
    document.querySelectorAll("[data-theme-control] input[type='radio']").forEach((input) => {
      input.checked = input.value === mode;
    });
  };
  const applyTheme = (mode) => {
    try {
      if (mode === "auto") localStorage.removeItem(themeKey);
      else localStorage.setItem(themeKey, mode);
    } catch {
      // Storage unavailable: the choice still applies to this page.
    }
    if (mode === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = `atlas-${mode}`;
    syncThemeControls(mode);
  };
  document.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.closest("[data-theme-control]")) return;
    applyTheme(input.value);
  });

  const exactTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  const localizeTimes = (root) => {
    root.querySelectorAll("[data-exact-time]").forEach((time) => {
      const tip = time.querySelector(".ax-time-tip");
      const value = time.getAttribute("datetime");
      if (!tip || !value || time.dataset.exactTimeLocal) return;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return;
      tip.textContent = exactTimeFormat.format(date);
      time.dataset.exactTimeLocal = "";
    });
  };
  // Keep the exact-time tooltip inside the viewport (phones): pin it to the nearer edge if needed.
  const placeTimeTip = (event) => {
    const time = event.target instanceof Element ? event.target.closest(".ax-time") : null;
    const tip = time?.querySelector(".ax-time-tip");
    if (!tip) return;
    tip.classList.remove("ax-tip-start", "ax-tip-end");
    const box = tip.getBoundingClientRect();
    const edge = 8;
    if (box.right > document.documentElement.clientWidth - edge) tip.classList.add("ax-tip-end");
    else if (box.left < edge) tip.classList.add("ax-tip-start");
  };
  document.addEventListener("mouseover", placeTimeTip);
  document.addEventListener("focusin", placeTimeTip);

  document.body.addEventListener("htmx:afterSettle", (event) => {
    if (event.detail.elt instanceof Element) localizeTimes(event.detail.elt.parentElement ?? document);
  });

  window.addEventListener("DOMContentLoaded", () => {
    syncThemeControls(readTheme());
    localizeTimes(document);
    const swap = document.querySelector("[data-focus-on-swap]");
    if (swap instanceof HTMLElement) {
      swap.removeAttribute("data-focus-on-swap");
      swap.focus({ preventScroll: true });
    } else {
      const heading = document.querySelector("[data-page-heading]");
      if (heading instanceof HTMLElement) heading.focus({ preventScroll: true, focusVisible: false });
    }
    startSessionViewer();
  });

  const nodePath = (node, root) => {
    const path = [];
    let current = node;
    while (current && current !== root) {
      const parent = current.parentNode;
      if (!parent) return null;
      path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
      current = parent;
    }
    return current === root ? path : null;
  };

  const nodeAtPath = (root, path) => path.reduce((node, index) => node?.childNodes?.[index], root);
  const sessionViewerRoots = new Set();

  const captureContext = (root) => {
    const active = document.activeElement instanceof Element && root.contains(document.activeElement)
      ? document.activeElement
      : null;
    const selection = window.getSelection();
    const selected = selection && !selection.isCollapsed && root.contains(selection.anchorNode) && root.contains(selection.focusNode)
      ? {
          anchorPath: nodePath(selection.anchorNode, root),
          anchorOffset: selection.anchorOffset,
          focusPath: nodePath(selection.focusNode, root),
          focusOffset: selection.focusOffset,
        }
      : null;
    return {
      activePath: active ? nodePath(active, root) : null,
      activeId: active?.id || null,
      scrollTop: root.querySelector("[data-viewer-content]")?.scrollTop ?? 0,
      scrollY: window.scrollY,
      details: [...root.querySelectorAll("details")].map((detail) => detail.open),
      folds: Object.fromEntries([...root.querySelectorAll("details[data-fold-key]")].map((detail) => [detail.dataset.foldKey, detail.open])),
      selected,
      activeSelection: active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
        ? { start: active.selectionStart, end: active.selectionEnd }
        : null,
    };
  };

  const restoreContext = (root, context) => {
    const content = root.querySelector("[data-viewer-content]");
    if (content) content.scrollTop = context.scrollTop;
    context.details.forEach((open, index) => {
      const detail = root.querySelectorAll("details")[index];
      if (detail && !detail.dataset.foldKey) detail.open = open;
    });
    root.querySelectorAll("details[data-fold-key]").forEach((detail) => {
      const open = context.folds?.[detail.dataset.foldKey];
      if (open !== undefined) detail.open = open;
    });
    const active = (context.activeId && document.getElementById(context.activeId)) || (context.activePath ? nodeAtPath(root, context.activePath) : null);
    if (active instanceof HTMLElement && root.contains(active)) {
      active.focus({ preventScroll: true });
      if (context.activeSelection && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
        active.setSelectionRange(context.activeSelection.start ?? 0, context.activeSelection.end ?? 0);
      }
    }
    if (context.selected?.anchorPath && context.selected.focusPath) {
      const anchorOwner = nodeAtPath(root, context.selected.anchorPath);
      const focusOwner = nodeAtPath(root, context.selected.focusPath);
      if (anchorOwner && focusOwner) {
        const range = document.createRange();
        const anchorMax = anchorOwner.nodeType === Node.TEXT_NODE ? anchorOwner.textContent?.length ?? 0 : anchorOwner.childNodes.length;
        const focusMax = focusOwner.nodeType === Node.TEXT_NODE ? focusOwner.textContent?.length ?? 0 : focusOwner.childNodes.length;
        range.setStart(anchorOwner, Math.min(context.selected.anchorOffset, anchorMax));
        range.setEnd(focusOwner, Math.min(context.selected.focusOffset, focusMax));
        const nextSelection = window.getSelection();
        nextSelection?.removeAllRanges();
        nextSelection?.addRange(range);
      }
    }
    window.scrollTo({ top: context.scrollY, behavior: "auto" });
  };

  const setViewerConnection = (root, state, reason) => {
    if (state === "fresh" || state === "stale" || state === "partial") root.dataset.viewerFreshness = state;
    const status = root.querySelector("[data-viewer-connection-message]");
    if (status) {
      const text = state === "fresh" ? "" : state === "connecting" ? "Connecting to live updates…" : reason || (state === "auth" ? "Your sign-in expired. Sign in again before refreshing this Session view." : "Live Session data is stale; visible content is retained while Atlas reconciles.");
      if (status.dataset.viewerState !== state || status.textContent !== text) {
        status.dataset.viewerState = state;
        status.textContent = text;
      }
      status.className = state === "fresh" ? "sr-only" : state === "connecting" ? "sv-conn sv-conn-quiet" : "sv-conn";
    } else {
      const notice = document.createElement("div");
      notice.dataset.viewerConnectionMessage = "true";
      notice.className = "sv-conn";
      notice.setAttribute("role", "status");
      notice.textContent = reason || (state === "auth" ? "Your sign-in expired. Sign in again before refreshing this Session view." : "Live Session data is stale; visible content is retained while Atlas reconciles.");
      root.querySelector("[data-viewer-content]")?.before(notice);
    }
  };

  const replaceViewerMarkup = (root, replacement) => {
    const status = root.querySelector("[data-viewer-connection-message]");
    const replacementStatus = replacement.querySelector("[data-viewer-connection-message]");
    if (status && replacementStatus) replacementStatus.replaceWith(status);
    [...root.attributes].forEach((attribute) => root.removeAttribute(attribute.name));
    [...replacement.attributes].forEach((attribute) => root.setAttribute(attribute.name, attribute.value));
    root.replaceChildren(...[...replacement.childNodes]);
  };

  // Session page: the /view response also carries fresh status and Pull request cards.
  const applyLiveCards = (root, fragment) => {
    const page = root.closest("[data-session-page]");
    const cards = fragment.querySelector("template[data-sv-live-cards]");
    if (!page || !cards) return;
    const before = page.querySelector("[data-session-state]")?.dataset.sessionState;
    ["data-sv-pr-slot", "data-sv-status-slot"].forEach((name) => {
      const slot = page.querySelector(`[${name}]`);
      const fresh = cards.content.querySelector(`[${name}]`);
      if (slot && fresh) slot.replaceChildren(...fresh.childNodes);
    });
    const after = page.querySelector("[data-session-state]");
    if (after && before && after.dataset.sessionState !== before) {
      const status = document.getElementById("global-status");
      const title = after.querySelector(".sv-card-t");
      if (status && title?.firstChild) status.textContent = `Session status: ${title.firstChild.textContent.trim()}`;
    }
  };

  const refreshViewer = (root, controller) => {
    controller.requested += 1;
    if (controller.timer || controller.loading) {
      controller.invalidatedWhileReading = controller.loading;
      return;
    }
    controller.timer = window.setTimeout(async () => {
      controller.timer = 0;
      const generation = controller.requested;
      controller.loading = true;
      const context = captureContext(root);
      try {
        const response = await fetch(root.dataset.sessionViewerUrl, {
          credentials: "same-origin",
          headers: { "HX-Request": "true", Accept: "text/html" },
        });
        if (generation !== controller.requested) {
          controller.invalidatedWhileReading = true;
        } else if (response.status === 401) {
          root._atlasViewerClose?.();
          controller.connectionState = "auth";
          controller.connectionReason = undefined;
          setViewerConnection(root, "auth");
        } else if (!response.ok) {
          controller.connectionState = "stale";
          controller.connectionReason = "Atlas could not reconcile this Session view. Visible content is retained.";
          setViewerConnection(root, "stale", "Atlas could not reconcile this Session view. Visible content is retained.");
        } else {
          const html = await response.text();
          const template = document.createElement("template");
          template.innerHTML = html;
          const replacement = template.content.querySelector("[data-session-viewer]");
          if (replacement?.querySelector("[data-viewer-content]")) {
            if (replacement.dataset.viewerFreshness === "fresh") {
              replaceViewerMarkup(root, replacement);
              applyLiveCards(root, template.content);
              controller.connectionState = "fresh";
              controller.connectionReason = undefined;
              setViewerConnection(root, "fresh");
              restoreContext(root, context);
            } else {
              root.dataset.viewerFreshness = "stale";
              controller.connectionState = "stale";
              controller.connectionReason = "Atlas could not complete Session reconciliation. Visible content is retained.";
              setViewerConnection(root, "stale", controller.connectionReason);
            }
          }
        }
      } catch {
        controller.connectionState = "stale";
        controller.connectionReason = "Atlas could not reach the Session projection. Visible content is retained.";
        setViewerConnection(root, "stale", "Atlas could not reach the Session projection. Visible content is retained.");
      } finally {
        controller.loading = false;
        if (controller.invalidatedWhileReading || controller.requested > generation) {
          controller.invalidatedWhileReading = false;
          refreshViewer(root, controller);
        }
      }
    }, 100);
  };

  const startSessionViewer = () => {
    [...sessionViewerRoots].filter((root) => !root.isConnected).forEach((root) => root._atlasViewerClose?.());
    document.querySelectorAll("[data-session-viewer]").forEach((root) => {
      if (root._atlasViewerController) return;
      const controller = {
        source: null,
        reconnectTimer: 0,
        delay: 1000,
        requested: 0,
        timer: 0,
        loading: false,
        invalidatedWhileReading: false,
        connectionState: "stale",
        connectionReason: undefined,
        stopped: false,
      };
      root._atlasViewerController = controller;
      sessionViewerRoots.add(root);

      const close = () => {
        controller.stopped = true;
        if (controller.source) controller.source.close();
        if (controller.reconnectTimer) window.clearTimeout(controller.reconnectTimer);
        if (controller.timer) window.clearTimeout(controller.timer);
        controller.source = null;
        sessionViewerRoots.delete(root);
      };
      const connect = () => {
        if (controller.stopped || !root.isConnected) return;
        controller.connectionState = "stale";
        controller.connectionReason = undefined;
        setViewerConnection(root, controller.everConnected ? "stale" : "connecting");
        const source = new EventSource(root.dataset.sessionEventsUrl, { withCredentials: true });
        controller.source = source;
        source.addEventListener("connected", () => {
          controller.delay = 1000;
          controller.connectionState = "stale";
          controller.connectionReason = "OpenCode reconnected; Atlas is reconciling this Session view.";
          setViewerConnection(root, controller.everConnected ? "stale" : "connecting", controller.connectionReason);
          controller.everConnected = true;
          refreshViewer(root, controller);
        });
        source.addEventListener("refresh", () => refreshViewer(root, controller));
        source.addEventListener("reconcile", () => {
          controller.connectionState = "stale";
          controller.connectionReason = "OpenCode reconnected; Atlas is reconciling this Session view.";
          setViewerConnection(root, "stale", controller.connectionReason);
          refreshViewer(root, controller);
        });
        source.addEventListener("stale", (event) => {
          let reason;
          try { reason = JSON.parse(event.data).reason; } catch { reason = undefined; }
          controller.connectionState = "stale";
          controller.connectionReason = reason;
          setViewerConnection(root, "stale", reason);
        });
        source.addEventListener("auth-expired", () => {
          close();
          controller.connectionState = "auth";
          controller.connectionReason = undefined;
          setViewerConnection(root, "auth");
        });
        source.onerror = () => {
          source.close();
          controller.source = null;
          if (controller.stopped) return;
          controller.connectionState = "stale";
          controller.connectionReason = undefined;
          setViewerConnection(root, "stale");
          controller.reconnectTimer = window.setTimeout(connect, controller.delay);
          controller.delay = Math.min(controller.delay * 2, 30000);
        };
      };
      root._atlasViewerClose = close;
      connect();
    });
  };

  // Session page tabs: links work without JS (?tab=); with JS switch panels in place so the
  // live Activity viewer keeps its connection.
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest("[data-sv-tabs] a[href]") : null;
    const page = link?.closest("[data-session-page]");
    if (!link || !page) return;
    const tab = new URL(link.href, window.location.href).searchParams.get("tab") || "activity";
    const panel = page.querySelector(`[data-sv-panel="${tab}"]`);
    if (!panel) return;
    event.preventDefault();
    page.querySelectorAll("[data-sv-panel]").forEach((other) => { other.hidden = other !== panel; });
    link.parentElement?.querySelectorAll("a").forEach((other) => {
      if (other === link) other.setAttribute("aria-current", "page");
      else other.removeAttribute("aria-current");
    });
    const url = new URL(window.location.href);
    if (tab === "activity") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    try { history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`); } catch { /* ignore */ }
  });

  window.addEventListener("pagehide", () => {
    [...sessionViewerRoots].forEach((root) => root._atlasViewerClose?.());
  });
})();
