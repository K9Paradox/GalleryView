import { React, useEffect, useRef, useState } from "@webpack/common";

const DOCK_STORAGE_KEY = "GalleryMode:dockWidth";
const DOCK_DEFAULT_WIDTH = 520;
const DOCK_MIN_WIDTH = 320;
const DOCK_MAX_WIDTH = 760;
const DOCK_MIN_CHAT_WIDTH = 360;
const DOCK_RESERVE_GAP = 96;

export function clampDockWidth(width: number): number {
    let max = DOCK_MAX_WIDTH;
    try {
        max = Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, window.innerWidth - DOCK_MIN_CHAT_WIDTH - DOCK_RESERVE_GAP));
    } catch {
        // Module evaluated outside a browser-like context; keep the static max.
    }
    return Math.round(Math.min(Math.max(width, DOCK_MIN_WIDTH), max));
}

export function readSavedDockWidth(): number {
    try {
        const saved = Number(localStorage.getItem(DOCK_STORAGE_KEY));
        if (Number.isFinite(saved) && saved > 0) return clampDockWidth(saved);
    } catch {
        // Non-fatal; the default dock width is fine.
    }
    return clampDockWidth(DOCK_DEFAULT_WIDTH);
}

export function saveDockWidth(width: number): void {
    try {
        localStorage.setItem(DOCK_STORAGE_KEY, String(clampDockWidth(width)));
    } catch {
        // Non-fatal; the drag still works for this session.
    }
}

export function findDockReservationTarget(): HTMLElement | null {
    const appMount = document.getElementById("app-mount");
    if (!appMount) return null;

    // Resilient selector list: try Discord's obfuscated chat class prefix first, then fall back
    // to semantic main/chat region landmarks in case Discord renames its CSS module classes.
    const selectors = [
        '[class*="chat_"]',
        '[class*="chatContent_"]',
        'main[class*="chat"]',
        'main[aria-label]',
        'div[role="main"]'
    ];

    const seen = new Set<HTMLElement>();
    const rawElements: HTMLElement[] = [];
    for (const selector of selectors) {
        for (const el of Array.from(appMount.querySelectorAll<HTMLElement>(selector))) {
            if (!seen.has(el)) {
                seen.add(el);
                rawElements.push(el);
            }
        }
    }

    const candidates = rawElements
        .filter(element => {
            if (element.closest(".gm-gallery-overlay-container")) return false;
            const rect = element.getBoundingClientRect();
            // Prefer the main chat container, not a tiny nested bit of chat chrome.
            return rect.width >= 420 && rect.height >= 360;
        })
        .sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            return (br.width * br.height) - (ar.width * ar.height);
        });

    return candidates[0] || null;
}

export function useDockMode(
    effectiveViewMode: "overlay" | "dockRight" | "dockLeft",
    isDocked: boolean,
    liveSessionKey: string
) {
    const [dockWidth, setDockWidth] = useState<number>(() => readSavedDockWidth());
    const dockReservationRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        const handleResize = () => setDockWidth(width => clampDockWidth(width));
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useEffect(() => {
        if (!isDocked) return;

        const root = document.documentElement;
        const side = effectiveViewMode === "dockRight" ? "right" : "left";
        let frame = 0;
        let settleTimer = 0;

        const clearReservation = () => {
            dockReservationRef.current?.classList.remove("gm-discord-reserved-for-gallery");
            dockReservationRef.current = null;
        };

        const syncDockReservation = () => {
            clearReservation();

            // Measure the chat before adding the margin reservation. For left dock this is what
            // lets the panel sit between Discord's sidebars and chat instead of covering server /
            // channel navigation.
            const target = findDockReservationTarget();
            if (target) {
                const rect = target.getBoundingClientRect();
                if (side === "left") {
                    root.style.setProperty("--gm-dock-left-x", `${Math.max(8, Math.round(rect.left))}px`);
                } else {
                    root.style.removeProperty("--gm-dock-left-x");
                }
                target.classList.add("gm-discord-reserved-for-gallery");
                dockReservationRef.current = target;
            } else {
                root.style.removeProperty("--gm-dock-left-x");
            }
        };

        root.classList.add("gm-dock-active", `gm-dock-active-${side}`);
        syncDockReservation();
        // Discord often finishes moving channel/member columns one frame after route changes.
        // A second pass avoids the "dock is wrong until reopen" glitch without polling forever.
        frame = requestAnimationFrame(syncDockReservation);
        settleTimer = window.setTimeout(syncDockReservation, 250);
        window.addEventListener("resize", syncDockReservation);

        return () => {
            if (frame) cancelAnimationFrame(frame);
            if (settleTimer) clearTimeout(settleTimer);
            window.removeEventListener("resize", syncDockReservation);
            root.classList.remove("gm-dock-active", "gm-dock-active-left", "gm-dock-active-right");
            root.style.removeProperty("--gm-active-dock-width");
            root.style.removeProperty("--gm-dock-left-x");
            clearReservation();
        };
    }, [effectiveViewMode, isDocked, liveSessionKey]);

    useEffect(() => {
        if (!isDocked) return;
        document.documentElement.style.setProperty("--gm-active-dock-width", `${dockWidth}px`);
    }, [dockWidth, isDocked]);

    const startDockResize = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (!isDocked) return;
        e.preventDefault();
        e.stopPropagation();

        const startX = e.clientX;
        const startWidth = dockWidth;
        const direction = effectiveViewMode;
        let latestWidth = startWidth;

        document.body.classList.add("gm-resizing-dock");

        const handleMove = (event: MouseEvent) => {
            const delta = direction === "dockRight"
                ? startX - event.clientX
                : event.clientX - startX;
            latestWidth = clampDockWidth(startWidth + delta);
            setDockWidth(latestWidth);
        };

        const finish = () => {
            document.body.classList.remove("gm-resizing-dock");
            window.removeEventListener("mousemove", handleMove);
            window.removeEventListener("mouseup", finish);
            saveDockWidth(latestWidth);
        };

        window.addEventListener("mousemove", handleMove);
        window.addEventListener("mouseup", finish, { once: true });
    }, [dockWidth, effectiveViewMode, isDocked]);

    return { dockWidth, startDockResize };
}
