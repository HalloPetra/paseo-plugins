import { Platform } from "react-native";

// The plugin typechecks without the DOM library, so this module declares the little it uses.
// Everything here runs only on the desktop app (Electron); see `canInterceptLinks`.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any;
declare const window: any;
declare const navigator: { userAgent: string };

// The agent chat, plus any plugin view that opts in by rendering inside a View with
// `testID="link-opener-scope"` (the GitHub PR panel does this for comments and the description).
const SCOPE_SELECTOR = '[data-testid="agent-chat-scroll"], [data-testid="link-opener-scope"]';
const POPOVER_ATTR = "data-link-opener-popover";

export interface LinkTarget {
  url: string;
  /** Null when the current route does not name a workspace. */
  workspaceId: string | null;
}

export interface LinkHandlers {
  openSystem(target: LinkTarget): void | Promise<void>;
  openPaseo(target: LinkTarget & { workspaceId: string }): void | Promise<void>;
  copy(target: LinkTarget): void | Promise<void>;
}

/**
 * Paseo has no plugin hook for link presses, so this listens for clicks on links in the agent
 * chat before the app does. Only the desktop app has the Paseo browser, so other clients keep
 * Paseo's default behavior.
 */
export function canInterceptLinks(): boolean {
  return (
    Platform.OS === "web" &&
    typeof document !== "undefined" &&
    typeof navigator !== "undefined" &&
    /\bElectron\//.test(navigator.userAgent)
  );
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/[^\s/]/i.test(value);
}

/** Routes look like `/h/<server>/workspace/<workspace>`, as a path or after a `#`. */
export function currentWorkspaceId(): string | null {
  const location = window.location;
  for (const source of [location.pathname, location.hash]) {
    const match = /\/h\/[^/]+\/workspace\/([^/?#]+)/.exec(String(source ?? ""));
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

function isTransparent(color: string): boolean {
  return !color || color === "transparent" || /rgba\([^)]*,\s*0\)$/.test(color);
}

export interface PopoverTheme {
  surface: string;
  foreground: string;
  muted: string;
  border: string;
  hover: string;
}

let currentTheme: PopoverTheme | null = null;

/** Called by mounted plugin components with Paseo's active theme. */
export function setPopoverTheme(theme: PopoverTheme) {
  currentTheme = theme;
}

/**
 * Paseo's theme when a plugin component has reported it. Otherwise the link's own color stands
 * in for the foreground, since the chat container itself carries no text color.
 */
function readPalette(anchor: any): PopoverTheme {
  if (currentTheme) return currentTheme;
  const foreground: string = window.getComputedStyle(anchor).color || "#888";
  let surface = "";
  for (let node = anchor; node && node !== document.documentElement; node = node.parentElement) {
    const color = window.getComputedStyle(node).backgroundColor;
    if (!isTransparent(color)) {
      surface = color;
      break;
    }
  }
  if (!surface) surface = window.getComputedStyle(document.body).backgroundColor || "#fff";
  return {
    surface,
    foreground,
    muted: `color-mix(in srgb, ${foreground} 60%, ${surface})`,
    border: `color-mix(in srgb, ${foreground} 16%, ${surface})`,
    hover: `color-mix(in srgb, ${foreground} 9%, ${surface})`,
  };
}

export function interceptChatLinks(handlers: LinkHandlers): () => void {
  let popover: any = null;
  let removePopoverListeners: (() => void) | null = null;

  function closePopover() {
    removePopoverListeners?.();
    removePopoverListeners = null;
    popover?.remove();
    popover = null;
  }

  function showPopover(anchor: any, target: LinkTarget) {
    closePopover();
    const palette = readPalette(anchor);
    const root = document.createElement("div");
    root.setAttribute(POPOVER_ATTR, "");
    root.setAttribute("role", "menu");
    root.setAttribute("aria-label", "Open link");
    Object.assign(root.style, {
      position: "fixed",
      zIndex: "2147483000",
      minWidth: "220px",
      maxWidth: "360px",
      padding: "4px",
      borderRadius: "8px",
      border: `1px solid ${palette.border}`,
      background: palette.surface,
      color: palette.foreground,
      boxShadow: "0 8px 24px rgba(0, 0, 0, 0.24)",
      font: "13px/1.35 system-ui, -apple-system, sans-serif",
      visibility: "hidden",
    });

    const label = document.createElement("div");
    label.textContent = target.url;
    label.title = target.url;
    Object.assign(label.style, {
      padding: "6px 8px 6px",
      color: palette.muted,
      fontSize: "12px",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      borderBottom: `1px solid ${palette.border}`,
      marginBottom: "4px",
    });
    root.appendChild(label);

    const buttons: any[] = [];
    const addItem = (text: string, hint: string, run: (() => void | Promise<void>) | null) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.disabled = run === null;
      const title = document.createElement("span");
      title.textContent = text;
      const detail = document.createElement("span");
      detail.textContent = hint;
      Object.assign(detail.style, { color: palette.muted, fontSize: "12px", marginLeft: "12px" });
      button.append(title, detail);
      Object.assign(button.style, {
        display: "flex",
        width: "100%",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 8px",
        border: "0",
        borderRadius: "5px",
        background: "transparent",
        color: "inherit",
        font: "inherit",
        textAlign: "left",
        cursor: run ? "pointer" : "default",
        opacity: run ? "1" : "0.45",
        outline: "none",
      });
      const highlight = (on: boolean) => {
        if (run) button.style.background = on ? palette.hover : "transparent";
      };
      button.addEventListener("mouseenter", () => button.focus());
      button.addEventListener("focus", () => highlight(true));
      button.addEventListener("blur", () => highlight(false));
      button.addEventListener("click", (event: any) => {
        event.preventDefault();
        event.stopPropagation();
        if (!run) return;
        closePopover();
        Promise.resolve()
          .then(run)
          .catch((error: unknown) => console.error("[link-opener]", error));
      });
      root.appendChild(button);
      if (run) buttons.push(button);
    };

    const { workspaceId } = target;
    addItem("Open in Paseo browser", "↵", workspaceId ? () => handlers.openPaseo({ ...target, workspaceId }) : null);
    addItem("Open in system browser", "⌘↵", () => handlers.openSystem(target));
    addItem("Copy link", "⌘C", () => handlers.copy(target));

    document.body.appendChild(root);
    popover = root;

    // Below the clicked link, flipped above or clamped when it would leave the window.
    const rect = anchor.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    const margin = 8;
    let top = rect.bottom + 4;
    if (top + box.height > window.innerHeight - margin) top = Math.max(margin, rect.top - box.height - 4);
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - box.width - margin);
    Object.assign(root.style, { top: `${top}px`, left: `${left}px`, visibility: "visible" });
    buttons[0]?.focus();

    const onPointerDown = (event: any) => {
      if (!root.contains(event.target)) closePopover();
    };
    const onKeyDown = (event: any) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closePopover();
        anchor.focus?.();
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key === "Enter") {
        event.preventDefault();
        closePopover();
        void Promise.resolve(handlers.openSystem(target)).catch((error) => console.error("[link-opener]", error));
        return;
      }
      if (mod && event.key.toLowerCase() === "c" && !String(window.getSelection?.() ?? "")) {
        event.preventDefault();
        closePopover();
        void Promise.resolve(handlers.copy(target)).catch((error) => console.error("[link-opener]", error));
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const index = buttons.indexOf(document.activeElement);
        const step = event.key === "ArrowDown" ? 1 : -1;
        buttons[(index + step + buttons.length) % buttons.length]?.focus();
      }
    };
    const onDismiss = () => closePopover();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", onDismiss, true);
    window.addEventListener("resize", onDismiss);
    window.addEventListener("blur", onDismiss);
    removePopoverListeners = () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("resize", onDismiss);
      window.removeEventListener("blur", onDismiss);
    };
  }

  // Capture phase on the document runs before React's root listener, so the app's own link
  // handler never sees the click.
  const onClick = (event: any) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const element = event.target?.closest?.("a[href]");
    if (!element || element.closest(`[${POPOVER_ATTR}]`) || !element.closest(SCOPE_SELECTOR)) return;
    const url: string = element.href;
    if (!isHttpUrl(url)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showPopover(element, { url, workspaceId: currentWorkspaceId() });
  };
  document.addEventListener("click", onClick, true);

  return () => {
    document.removeEventListener("click", onClick, true);
    closePopover();
  };
}
