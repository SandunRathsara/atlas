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
    startSessionViewer();
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
      if (detail) detail.open = open;
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
    const badge = root.querySelector("[data-viewer-connection]");
    if (badge) {
      badge.textContent = state === "fresh" ? "Fresh" : state === "auth" ? "Sign-in expired" : state === "stale" ? "Stale" : "Partial";
      badge.className = `badge ${state === "fresh" ? "badge-success" : "badge-warning"}`;
    }
    if (state === "fresh") {
      root.querySelector("[data-viewer-connection-message]")?.remove();
      return;
    }
    const status = root.querySelector("[data-viewer-connection-message]");
    if (status) {
      status.textContent = reason || (state === "auth" ? "Your sign-in expired. Sign in again before refreshing this Session view." : "Live Session data is stale; visible content is retained while Atlas reconciles.");
      status.className = "alert alert-warning mt-6 leading-normal";
      status.setAttribute("role", "status");
    } else {
      const notice = document.createElement("div");
      notice.dataset.viewerConnectionMessage = "true";
      notice.className = "alert alert-warning mt-6 leading-normal";
      notice.setAttribute("role", "status");
      notice.textContent = reason || (state === "auth" ? "Your sign-in expired. Sign in again before refreshing this Session view." : "Live Session data is stale; visible content is retained while Atlas reconciles.");
      root.querySelector("[data-viewer-content]")?.before(notice);
    }
  };

  const replaceViewerMarkup = (root, replacement) => {
    [...root.attributes].forEach((attribute) => root.removeAttribute(attribute.name));
    [...replacement.attributes].forEach((attribute) => root.setAttribute(attribute.name, attribute.value));
    root.replaceChildren(...[...replacement.childNodes]);
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
        setViewerConnection(root, "stale");
        const source = new EventSource(root.dataset.sessionEventsUrl, { withCredentials: true });
        controller.source = source;
        source.addEventListener("connected", () => {
          controller.delay = 1000;
          controller.connectionState = "stale";
          controller.connectionReason = "OpenCode reconnected; Atlas is reconciling this Session view.";
          setViewerConnection(root, "stale", controller.connectionReason);
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

  window.addEventListener("pagehide", () => {
    [...sessionViewerRoots].forEach((root) => root._atlasViewerClose?.());
  });
})();
