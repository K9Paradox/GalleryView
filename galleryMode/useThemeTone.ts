import { React, useEffect, useState } from "@webpack/common";

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
    const rgb = value.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];

    const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
        const h = hex[1].length === 3 ? hex[1].split("").map(c => c + c).join("") : hex[1];
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }

    return null;
}

/**
 * Detect whether Discord is currently rendering a light or dark surface.
 *
 * Deliberately measures the *computed* value of Discord's own background custom properties
 * rather than looking for a `theme-light` class. Custom themes (BetterDiscord/Vencord CSS,
 * midnight/AMOLED variants, etc.) frequently override the palette while keeping — or dropping —
 * the stock class names, so reading the resolved colour is the only approach that generalises.
 *
 * Falls back to "dark", which matches Discord's default and the plugin's original styling.
 */
export function useThemeTone(): ThemeTone {
    const [tone, setTone] = useState<ThemeTone>("dark");

    useEffect(() => {
        const detect = (): ThemeTone => {
            try {
                const probe = document.querySelector<HTMLElement>("[class*='appMount'], #app-mount") ?? document.body;
                const styles = getComputedStyle(probe);

                // Prefer Discord's semantic tokens; fall back to the element's real background.
                const candidates = [
                    styles.getPropertyValue("--background-base-lower"),
                    styles.getPropertyValue("--background-primary"),
                    styles.getPropertyValue("--background-secondary"),
                    styles.backgroundColor
                ];

                for (const candidate of candidates) {
                    const rgb = candidate && parseColor(candidate);
                    if (!rgb) continue;
                    // 0.45 sits comfortably between Discord's dark (~0.02) and light (~0.93)
                    // surfaces, so mid-grey custom themes resolve to whichever they're closer to.
                    return luminance(rgb[0], rgb[1], rgb[2]) > 0.45 ? "light" : "dark";
                }
            } catch {
                // Any DOM/CSS access failure just leaves the dark default in place.
            }
            return "dark";
        };

        setTone(detect());

        // Re-detect when the user switches themes.
        //
        // Only `class` is watched, deliberately. Discord mutates inline `style` on <html> and
        // #app-mount very frequently (custom properties, layout measurements), and each
        // notification triggered a getComputedStyle + setState. On a gallery holding hundreds
        // of cards, a burst of those re-rendered the whole tree repeatedly and locked the
        // client up for several seconds. Theme switches always change a class.
        if (typeof MutationObserver === "undefined") return;

        let timer: number | null = null;
        const schedule = () => {
            // Debounce rather than per-frame: a theme switch is a rare, coarse event, and this
            // guarantees at most one measurement per burst no matter how noisy the DOM is.
            if (timer != null) return;
            timer = window.setTimeout(() => {
                timer = null;
                // Only re-render when the tone genuinely flipped.
                setTone(previous => {
                    const next = detect();
                    return next === previous ? previous : next;
                });
            }, 150);
        };

        const observer = new MutationObserver(schedule);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

        const appMount = document.getElementById("app-mount");
        if (appMount) observer.observe(appMount, { attributes: true, attributeFilter: ["class"] });

        return () => {
            if (timer != null) clearTimeout(timer);
            observer.disconnect();
        };
    }, []);

    return tone;
}
