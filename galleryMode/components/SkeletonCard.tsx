import { React } from "@webpack/common";
import { settings } from "../settings";

interface SkeletonGridProps {
    /** How many placeholder cards to draw. */
    count: number;
    /** Reuse the aspect ratios of already-loaded media so the fake page matches the real one. */
    ratios?: number[];
}

// A deterministic pseudo-random sequence keyed on index — the placeholder heights stay stable
// across re-renders (a Math.random() call here would make every keystroke reshuffle the grid).
function fallbackRatio(index: number) {
    const table = [1, 1.33, 0.75, 1, 1.5, 0.8, 1.2, 1];
    return table[index % table.length];
}

/**
 * Fake page shown while the real one is in flight. Cards fade in with a staggered shimmer so the
 * gallery keeps its shape and the user never sees a blank "Loading…" screen. The boxes are sized
 * from the aspect ratios of media already on screen, so the placeholder page is a close visual
 * match for whatever is about to replace it.
 */
export function SkeletonGrid({ count, ratios }: SkeletonGridProps) {
    // Mirror the author-footer setting so placeholders are exactly as tall as the real cards
    // that replace them — otherwise the grid visibly jumps when the swap happens.
    const { showAuthorFooter } = settings.use(["showAuthorFooter"]);
    const cards: React.ReactNode[] = [];

    for (let i = 0; i < count; i++) {
        // Only masonry varies placeholder heights. In the uniform grid the wrapper's own 1:1
        // rule applies and --gm-item-ratio is simply never read, matching real MediaCards.
        const ratio = ratios?.length ? ratios[i % ratios.length] : fallbackRatio(i);

        cards.push(
            <div
                key={i}
                className="gm-media-card gm-skeleton-card"
                aria-hidden="true"
                // Cap the stagger so a 25-card page doesn't take 2s to finish appearing.
                style={{ animationDelay: `${Math.min(i, 12) * 28}ms` }}
            >
                <div
                    className="gm-media-preview-wrapper gm-skeleton-preview"
                    style={{ "--gm-item-ratio": `${Math.min(Math.max(ratio, 0.4), 3)}` } as React.CSSProperties}
                />
                {showAuthorFooter !== false && (
                    <div className="gm-card-footer gm-skeleton-footer">
                        <div className="gm-skeleton-avatar" />
                        <div className="gm-skeleton-lines">
                            <div className="gm-skeleton-line gm-skeleton-line-wide" />
                            <div className="gm-skeleton-line gm-skeleton-line-narrow" />
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return <>{cards}</>;
}
