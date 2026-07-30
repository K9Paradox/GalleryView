import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import { React, useEffect, useState } from "@webpack/common";
import { GalleryView } from "./components/GalleryView";
import { GalleryHeaderButton } from "./components/HeaderSearchBar";
import "./styles.css";

export const settings = definePluginSettings({
    defaultCardSize: {
        type: OptionType.SELECT,
        description: "Default Media Card Grid Density",
        options: [
            { label: "Compact (~180px - High Density)", value: "180px" },
            { label: "Standard (~240px - Balanced)", value: "240px", default: true },
            { label: "Large (~320px - Expanded)", value: "320px" },
            { label: "Showcase (~420px - High Detail)", value: "420px" }
        ]
    }
});

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

    // Wrapped in Vencord's ErrorBoundary to guarantee zero startup crashes
    renderHeaderButton: ErrorBoundary.wrap((props: any) => <HeaderButtonWrapper {...props} key="gallery-mode-header-btn" />, { noop: true }),

    start() {
        console.log("[GalleryMode] Plugin successfully initialized.");
    },

    stop() {
        setGalleryActive(false);
        console.log("[GalleryMode] Plugin stopped.");
    }
});
