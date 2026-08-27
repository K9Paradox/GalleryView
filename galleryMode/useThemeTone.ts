import { useEffect, useState } from "@webpack/common";

export type ThemeTone = "dark" | "light";

/** Relative luminance (WCAG). 0 = black, 1 = white. */
function luminance(r: number, g: number, b: number) {
    const channel = (value: number) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function parseColor(value: string): [number, number, number] | null {
    const rgb = value.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,]+([\d.]+))?/i);
    if (rgb) {
        // If the color is fully transparent, ignore it so we can find a solid underlying color candidate
        if (rgb[4] !== undefined && Number(rgb[4]) === 0) return null;
        return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    }

    const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
        const h = hex[1].length === 3 ? hex[1].split("").map(c => c + c).join("") : hex[1];
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }

    return null;
}

/**
 * Measure whether Discord is currently rendering a light or dark surface.
 *
 * Deliberately reads the *computed* value of Discord's own background custom properties rather
 * than looking for a `theme-light` class. Custom themes frequently override the palette while
 * keeping — or dropping — the stock class names, so reading the resolved colour is the only
 * approach that generalises.
 */
function detectTone(): ThemeTone {
    try {
        const probe = document.querySelector<HTMLElement>("[class*='appMount'], #app-mount") ?? document.body;
        const styles = getComputedStyle(probe);

        const candidates = [
            styles.getPropertyValue("--background-base-lower"),
            styles.getPropertyValue("--background-primary"),
            styles.getPropertyValue("--background-secondary"),
            styles.backgroundColor
        ];

        for (const candidate of candidates) {
            const rgb = candidate && parseColor(candidate);
            if (!rgb) continue;
            // 0.45 sits comfortably between Discord's dark (~0.02) and light (~0.93) surfaces,
            // so mid-grey custom themes resolve to whichever they're closer to.
            return luminance(rgb[0], rgb[1], rgb[2]) > 0.45 ? "light" : "dark";
        }
    } catch {
        // Any DOM/CSS access failure just leaves the dark default in place.
    }
    return "dark";
}

/*
 * Module-level tone store.
 *
 * This deliberately lives OUTSIDE the React tree. Previously the detection ran in a
 * useEffect inside GalleryView, which only mounts when the user opens the gallery — so the
 * overlay always painted with the stale default first and visibly snapped to the real theme
 * a moment later. Starting the observer when the plugin starts means the tone is already
 * correct before the first open, and the overlay never flashes the wrong palette.
 */
let currentTone: ThemeTone = "dark";
let started = false;
let stopObserving: (() => void) | null = null;
const listeners = new Set<(tone: ThemeTone) => void>();

function setTone(next: ThemeTone) {
    if (next === currentTone) return;
    currentTone = next;
    listeners.forEach(listener => listener(next));
}

export function getThemeTone(): ThemeTone {
    return currentTone;
}

/** Begin watching for theme changes. Called from the plugin's start(), not from a component. */
export function startThemeToneWatcher() {
    if (started) return;
    started = true;

    setTone(detectTone());

    if (typeof MutationObserver === "undefined") return;

    // Only `class` is watched. Discord mutates inline `style` on <html> and #app-mount very
    // frequently, and reacting to that ran getComputedStyle in bursts, which stalled the
    // client. Theme switches always change a class.
    let timer: number | null = null;
    const schedule = () => {
        if (timer != null) return;
        timer = window.setTimeout(() => {
            timer = null;
            setTone(detectTone());
        }, 150);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    const appMount = document.getElementById("app-mount");
    if (appMount) observer.observe(appMount, { attributes: true, attributeFilter: ["class"] });

    stopObserving = () => {
        if (timer != null) clearTimeout(timer);
        observer.disconnect();
    };
}

export function stopThemeToneWatcher() {
    stopObserving?.();
    stopObserving = null;
    started = false;
}

/**
 * Subscribe a component to the shared tone. The initial value is whatever the watcher has
 * already measured, so the very first render is correct — no post-open snap.
 */
export function useThemeTone(): ThemeTone {
    const [tone, setLocalTone] = useState<ThemeTone>(() => {
        // Cover the case where a component mounts before start() ran (e.g. hot reload).
        if (!started) startThemeToneWatcher();
        return currentTone;
    });

    useEffect(() => {
        listeners.add(setLocalTone);
        // Re-sync in case the tone changed between render and effect.
        setLocalTone(currentTone);
        return () => { listeners.delete(setLocalTone); };
    }, []);

    return tone;
}
