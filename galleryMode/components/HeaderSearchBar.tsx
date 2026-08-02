import { React, useEffect, useRef, useState } from "@webpack/common";

interface GalleryHeaderButtonProps {
    active: boolean;
    onToggle: () => void;
}

export function GalleryIcon({ active }: { active: boolean }) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM5 15l3.5-4.5 2.5 3.01L14.5 9l4.5 6H5z" />
            {active && <circle cx="19" cy="5" r="3" />}
        </svg>
    );
}

/**
 * Copy the colour Discord is actually painting its own toolbar icons with.
 *
 * Every CSS approach here is unreliable: `--interactive-normal` is not consistently re-themed,
 * and a `<button>` gets a UA-stylesheet `color` so it does not inherit the toolbar's colour the
 * way a bare <svg> sibling does. The only thing guaranteed to match is the value the browser
 * has already resolved for a neighbouring Discord icon — so we read it directly.
 */
function useToolbarIconColor(buttonRef: React.RefObject<HTMLButtonElement>) {
    const [color, setColor] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        let attempts = 0;

        const read = (): boolean => {
            const button = buttonRef.current;
            if (!button) return false;

            // Walk up a few levels: Discord nests toolbar buttons in wrapper divs, so our
            // immediate parent often contains no sibling icons at all.
            let scope: HTMLElement | null = button.parentElement;
            for (let depth = 0; depth < 4 && scope; depth++) {
                const icons = Array.from(scope.querySelectorAll("svg"))
                    .filter(svg => !button.contains(svg));

                for (const svg of icons) {
                    // Prefer the colour actually painting the glyph. Discord sets fill on the
                    // <svg> (usually to currentColor, which resolves against the button), so
                    // read fill first and fall back to the inherited text colour.
                    const styles = getComputedStyle(svg);
                    const candidate = styles.fill && styles.fill !== "none" && !styles.fill.startsWith("url")
                        ? styles.fill
                        : styles.color;

                    if (!candidate) continue;
                    // Skip transparent and pure-black placeholder values.
                    if (/rgba?\(\s*0[,\s]+0[,\s]+0\s*[,)]/.test(candidate)) continue;
                    if (/^rgba\(.*,\s*0\)$/.test(candidate)) continue;

                    if (!cancelled) setColor(candidate);
                    return true;
                }

                scope = scope.parentElement;
            }

            return false;
        };

        // Discord's own toolbar icons may not be mounted yet on the first paint, so retry on a
        // short backoff until one is found (or we give up and keep the CSS fallback).
        let retryTimer: number | null = null;
        const attempt = () => {
            if (cancelled || read()) return;
            if (++attempts > 12) return;
            retryTimer = window.setTimeout(attempt, 100 * attempts);
        };
        attempt();

        const stopRetrying = () => {
            cancelled = true;
            if (retryTimer != null) clearTimeout(retryTimer);
        };

        if (typeof MutationObserver === "undefined") return stopRetrying;

        // Re-read on theme switches. Watches `class` only: Discord rewrites inline `style`
        // constantly, and reacting to that caused a measurable stall.
        let debounce: number | null = null;
        const schedule = () => {
            if (debounce != null) return;
            debounce = window.setTimeout(() => {
                debounce = null;
                read();
            }, 120);
        };

        const observer = new MutationObserver(schedule);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

        return () => {
            stopRetrying();
            if (debounce != null) clearTimeout(debounce);
            observer.disconnect();
        };
    }, [buttonRef]);

    return color;
}

export const GalleryHeaderButton: React.FC<GalleryHeaderButtonProps> = ({ active, onToggle }) => {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const iconColor = useToolbarIconColor(buttonRef);

    return (
        <button
            ref={buttonRef}
            style={active || !iconColor ? undefined : { color: iconColor }}
            className={`gm-header-button ${active ? "active" : ""}`}
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggle();
            }}
            type="button"
            title={active ? "Exit Gallery Mode" : "Open Gallery Mode"}
            aria-label={active ? "Exit Gallery Mode" : "Open Gallery Mode"}
            aria-pressed={active}
        >
            <GalleryIcon active={active} />
        </button>
    );
};
