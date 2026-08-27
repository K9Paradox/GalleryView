import { React, useEffect, useLayoutEffect, useRef, useState } from "@webpack/common";
import { settings } from "../settings";
import { MediaItem } from "../types";

interface MasonryGridProps {
    items: MediaItem[];
    columnWidth: number;
    gap?: number;
    renderItem: (item: MediaItem) => React.ReactNode;
    trailingCount?: number;
    trailingRatios?: number[];
    renderTrailing?: (index: number, ratio: number) => React.ReactNode;
}

const DEFAULT_GAP = 16;
const RATIO_MIN = 0.4;
const RATIO_MAX = 3;
// Matches the 4/3 fallback used by the CSS for items Discord gave us no dimensions for.
const FALLBACK_RATIO = 4 / 3;
// Rough card chrome height (footer + borders) in units of column width. Only relative
// accuracy matters — it just biases the packer so short cards aren't treated as free.
const FOOTER_UNITS = 0.24;

function fallbackRatio(index: number) {
    const table = [1, 1.33, 0.75, 1, 1.5, 0.8, 1.2, 1];
    return table[index % table.length];
}

/**
 * Masonry that preserves reading order.
 *
 * CSS `columns` is the usual way to do this, but it fills each column top-to-bottom before
 * starting the next one. With a newest-first sort that means column 1 holds the newest third
 * of the page and column 3 holds the oldest — so scanning left-to-right shows wildly mixed
 * dates, which is exactly what the sort toggle is supposed to prevent.
 *
 * Instead we place items ourselves: walk them in order and drop each into whichever column is
 * currently shortest. Reading left-to-right, top-to-bottom now follows the sort order closely
 * while still producing a balanced, gap-free layout.
 */
export function MasonryGrid({ items, columnWidth, gap = DEFAULT_GAP, renderItem, trailingCount, trailingRatios, renderTrailing }: MasonryGridProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    // Measured synchronously below before first paint. Mounting at 1 column made the grid
    // several times taller than its real height for a frame or two, which clamped scroll
    // restoration to the wrong place.
    const [columnCount, setColumnCount] = useState<number>(0);
    // Cards are shorter without the author footer, so the packer must account for it or the
    // columns come out unbalanced. Card chrome is the human-facing setting that replaced the old
    // pair of separate badge/footer toggles: only the "Full" density keeps the footer.
    const { cardChrome } = settings.use(["cardChrome"]);
    const footerUnits = cardChrome === "full" || !cardChrome ? FOOTER_UNITS : 0;

    const measure = React.useCallback(() => {
        const element = containerRef.current;
        const width = element?.clientWidth;
        if (!width) return;
        // How many columns of at least `columnWidth` fit, accounting for the gaps between them.
        const fitted = Math.floor((width + gap) / (columnWidth + gap));
        setColumnCount(Math.max(1, fitted));
    }, [columnWidth, gap]);

    // Measure before the browser paints, so the very first rendered frame already has the right
    // number of columns and therefore roughly the right height. Doing this in a passive effect
    // let one wrong-height frame through, which was enough to break scroll restoration.
    useLayoutEffect(measure, [measure]);

    // Keep it correct as the window resizes, the sidebar collapses, or density changes.
    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;

        if (typeof ResizeObserver === "undefined") {
            window.addEventListener("resize", measure);
            return () => window.removeEventListener("resize", measure);
        }

        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [measure]);

    const columns = React.useMemo(() => {
        // Not measured yet — render nothing rather than a tall single column.
        if (columnCount < 1) return [];

        interface ColumnElement {
            type: "item" | "trailing";
            data: any;
        }

        const buckets: ColumnElement[][] = Array.from({ length: columnCount }, () => []);
        // Height is tracked in "column width" units so it stays resolution independent.
        const heights = new Array(columnCount).fill(0);

        for (const item of items) {
            const rawRatio = item.width && item.height ? item.width / item.height : FALLBACK_RATIO;
            const ratio = Math.min(Math.max(rawRatio, RATIO_MIN), RATIO_MAX);

            let shortest = 0;
            for (let i = 1; i < columnCount; i++) {
                if (heights[i] < heights[shortest]) shortest = i;
            }

            buckets[shortest].push({ type: "item", data: item });
            // A card of aspect ratio r occupies 1/r of its width in height, plus the footer.
            heights[shortest] += 1 / ratio + footerUnits;
        }

        if (trailingCount && trailingCount > 0) {
            for (let i = 0; i < trailingCount; i++) {
                const ratio = trailingRatios?.length ? trailingRatios[i % trailingRatios.length] : fallbackRatio(i);

                let shortest = 0;
                for (let j = 1; j < columnCount; j++) {
                    if (heights[j] < heights[shortest]) shortest = j;
                }

                buckets[shortest].push({ type: "trailing", data: { index: i, ratio } });
                heights[shortest] += 1 / ratio + footerUnits;
            }
        }

        return buckets;
    }, [items, columnCount, footerUnits, trailingCount, trailingRatios]);

    return (
        <div ref={containerRef} className="gm-media-grid gm-masonry" style={{ gap }}>
            {columns.map((column, index) => (
                <div className="gm-masonry-column" key={index} style={{ gap }}>
                    {column.map((element, elIndex) => {
                        if (element.type === "item") {
                            return renderItem(element.data as MediaItem);
                        } else if (element.type === "trailing" && renderTrailing) {
                            const t = element.data as { index: number; ratio: number };
                            return renderTrailing(t.index, t.ratio);
                        }
                        return null;
                    })}
                </div>
            ))}
        </div>
    );
}
