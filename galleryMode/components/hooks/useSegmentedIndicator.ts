import { React, useRef } from "@webpack/common";

export function useSegmentedControl(
    containerRef: React.RefObject<HTMLDivElement | null>,
    activeKey: any,
    isMultiSelect = false
): React.RefObject<HTMLDivElement | null> {
    const indicatorRef = useRef<HTMLDivElement>(null);
    const isInitialRef = useRef(true);

    // Instant pointer-down tracking: moves indicator with zero ms latency before heavy React re-renders
    React.useEffect(() => {
        const container = containerRef.current;
        const indicator = indicatorRef.current;
        if (!container || !indicator) return;

        const onPointerDown = (e: PointerEvent) => {
            const btn = (e.target as HTMLElement)?.closest<HTMLElement>(".gm-scope-btn, .gm-tab-btn");
            if (btn && container.contains(btn) && !isMultiSelect) {
                const left = btn.offsetLeft;
                const width = btn.offsetWidth;
                indicator.style.transform = `translate3d(${left}px, 0, 0)`;
                indicator.style.width = `${width}px`;
                indicator.style.opacity = "1";
            }
        };

        container.addEventListener("pointerdown", onPointerDown, { passive: true });
        return () => {
            container.removeEventListener("pointerdown", onPointerDown);
        };
    }, [isMultiSelect, containerRef]);

    React.useLayoutEffect(() => {
        const container = containerRef.current;
        const indicator = indicatorRef.current;
        if (!container || !indicator) return;

        if (isMultiSelect) {
            indicator.style.opacity = "0";
            return;
        }

        const update = (animate = true) => {
            const activeEl = container.querySelector<HTMLElement>(".active");
            if (activeEl) {
                const left = activeEl.offsetLeft;
                const width = activeEl.offsetWidth;
                if (!animate || isInitialRef.current) {
                    indicator.style.transition = "none";
                    indicator.style.transform = `translate3d(${left}px, 0, 0)`;
                    indicator.style.width = `${width}px`;
                    indicator.style.opacity = "1";
                    void indicator.offsetHeight;
                    indicator.style.transition = "";
                    isInitialRef.current = false;
                } else {
                    indicator.style.transform = `translate3d(${left}px, 0, 0)`;
                    indicator.style.width = `${width}px`;
                    indicator.style.opacity = "1";
                }
            } else {
                indicator.style.opacity = "0";
            }
        };

        update(true);
        const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => update(false)) : null;
        if (ro) ro.observe(container);
        return () => { ro?.disconnect(); };
    }, [activeKey, isMultiSelect, containerRef]);

    return indicatorRef;
}
