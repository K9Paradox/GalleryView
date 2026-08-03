import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { React, useEffect, useState } from "@webpack/common";
import { GalleryView, setGalleryDebug } from "./components/GalleryView";
import { GalleryHeaderButton } from "./components/HeaderSearchBar";
import { settings } from "./settings";
import { startThemeToneWatcher, stopThemeToneWatcher } from "./useThemeTone";
import "./styles.css";

// Re-exported for backwards compatibility — the definition lives in ./settings.ts
// to break the index ↔ GalleryView module cycle.
export { settings };

// Reactive state store for Gallery Mode active status
let isGalleryActive = false;
const listeners = new Set<(active: boolean) => void>();

export function setGalleryActive(active: boolean) {
    isGalleryActive = active;
    listeners.forEach(fn => fn(active));
}

export function useGalleryActive() {
    const [active, setActive] = useState(isGalleryActive);
    useEffect(() => {
        listeners.add(setActive);
        return () => { listeners.delete(setActive); };
    }, []);
    return active;
}

// Header button wrapper component with crash protection. The patch replaces Discord's
// trailing header Fragment with this component, so we must preserve props.children.
export function HeaderButtonWrapper({ children }: { children?: React.ReactNode; }) {
    const active = useGalleryActive();
    return (
        <>
            {children}
            <GalleryHeaderButton
                active={active}
                onToggle={() => setGalleryActive(!active)}
            />
            {active && (
                <GalleryView
                    onClose={() => setGalleryActive(false)}
                />
            )}
        </>
    );
}

export default definePlugin({
    name: "GalleryMode",
    description: "Turns text channels and servers into a rich visual media gallery powered directly by Discord's native backend Search API.",
    tags: ["Media", "Utility"],
    searchTerms: ["gallery", "media", "images", "gifs", "videos", "search", "library"],
    authors: [
        {
            name: "K9 & ENI",
            id: 0n
        }
    ],
    settings,

    // Safe, single AST patch into Discord's header bar
    patches: [
        {
            find: '?"BACK_FORWARD_NAVIGATION":',
            replacement: {
                match: /(trailing:.{0,50}?)\i\.Fragment,(?=\{children:\[)/,
                replace: "$1$self.renderHeaderButton,"
            }
        }
    ],

    /**
     * Toggle diagnostic logging from the console:
     *   Vencord.Plugins.plugins.GalleryMode.debug(true)
     *
     * Exposed as a method because Discord removes window.localStorage from the console
     * context, so setting the flag directly there throws.
     */
    debug: setGalleryDebug,

    // Wrapped in Vencord's ErrorBoundary to guarantee zero startup crashes
    renderHeaderButton: ErrorBoundary.wrap((props: any) => <HeaderButtonWrapper {...props} key="gallery-mode-header-btn" />, { noop: true }),

    start() {
        // Begin measuring Discord's theme immediately, rather than when the gallery first
        // opens. Detecting on open meant the overlay painted with the default dark palette
        // and then visibly snapped to the correct one.
        startThemeToneWatcher();
        console.log("[GalleryMode] Plugin successfully initialized.");
    },

    stop() {
        setGalleryActive(false);
        stopThemeToneWatcher();
        console.log("[GalleryMode] Plugin stopped.");
    }
});
