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
        const read = () => {
            const button = buttonRef.current;
            const toolbar = button?.parentElement;
            if (!toolbar) return;

            // Prefer a real sibling icon button (Inbox, Help, Threads, …). Fall back to the
            // toolbar container itself, which is what those icons inherit from anyway.
            const sibling = Array.from(toolbar.children).find(
                child => child !== button && !!child.querySelector("svg")
            ) as HTMLElement | undefined;

            const source = sibling?.querySelector("svg") ?? sibling ?? toolbar;
            const resolved = getComputedStyle(source as Element).color;

            // Ignore fully transparent / unset values.
            if (resolved && !/rgba?\(0,\s*0,\s*0,\s*0\)/.test(resolved)) setColor(resolved);
        };

        read();

        // Re-read when the theme changes. Cheap: one getComputedStyle on one element.
        if (typeof MutationObserver === "undefined") return;
        const observer = new MutationObserver(read);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
        return () => observer.disconnect();
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
