import { React } from "@webpack/common";

/**
 * Inline SVG icon set for the gallery chrome. The header used to be mostly text buttons,
 * which consumed a lot of horizontal room (forcing premature wrapping on smaller windows)
 * and mixed text sizes/styles. Icons keep the header compact and uniform; every icon-only
 * control carries a `title`/`aria-label` at its usage site so nothing becomes a mystery
 * meatball.
 *
 * Paths follow the Material 24x24 grid to stay visually consistent with the handful of
 * inline SVGs already in the plugin (title mark, settings gear).
 */

export interface GmIconProps {
    size?: number;
    className?: string;
}

function makeIcon(paths: string[], viewBox = "0 0 24 24") {
    const GmIcon: React.FC<GmIconProps> = ({ size = 16, className }) => (
        <svg
            width={size}
            height={size}
            viewBox={viewBox}
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
            className={className}
        >
            {paths.map((d, index) => <path key={index} d={d} />)}
        </svg>
    );
    return GmIcon;
}

export const IconSearch = makeIcon([
    "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
]);

export const IconReset = makeIcon([
    "M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
]);

export const IconClose = makeIcon([
    "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
]);

export const IconChevronDown = makeIcon([
    "M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"
]);

export const IconSortDesc = makeIcon([
    "M4 5h10v2H4zM4 10h7v2H4zM4 15h4v2H4z",
    "M15 5h2v9.17l2.59-2.58L21 13l-5 5-5-5 1.41-1.41L15 14.17z"
]);

export const IconSortAsc = makeIcon([
    "M4 5h10v2H4zM4 10h7v2H4zM4 15h4v2H4z",
    "M15 19h2V9.83l2.59 2.58L21 11l-5-5-5 5 1.41 1.41L15 9.83z"
]);

// --- Media filter tabs -----------------------------------------------------

export const IconAll = makeIcon([
    "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"
]);

export const IconImage = makeIcon([
    "M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"
]);

export const IconVideo = makeIcon([
    "M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"
]);

export const IconEmbed = makeIcon([
    "M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"
]);

export const IconFile = makeIcon([
    "M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z"
]);

export const IconAudio = makeIcon([
    "M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"
]);

// --- Scope -------------------------------------------------------------------

/** Hash mark — current channel / thread scope. */
export const IconChannel = makeIcon([
    "M20 10V8h-4V4h-2v4h-4V4H8v4H4v2h4v4H4v2h4v4h2v-4h4v4h2v-4h4v-2h-4v-4h4zm-6 4h-4v-4h4v4z"
]);

/** Two stacked chat bubbles — thread selection scope. */
export const IconThreads = makeIcon([
    "M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z"
]);

/** Server racks — whole-guild scope. */
export const IconServer = makeIcon([
    "M20 13H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1v-6c0-.55-.45-1-1-1zM7 19c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM20 3H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1zM7 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"
]);

/** Reply arrow — gallery was restored after "jump to message". */
export const IconReply = makeIcon([
    "M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"
]);

// --- Per-card actions ----------------------------------------------------------

/** Chat bubble with a right arrow — jump back to the source message. */
export const IconJump = makeIcon([
    "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z",
    "M9 11h4V9l3.5 2.5L13 14v-2H9v-1z"
]);

export const IconCopy = makeIcon([
    "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
]);

// --- Grid density ---------------------------------------------------------------

export type DensityVariant = "s" | "m" | "l" | "xl";

// [x, y, width, height] in a 24x24 box. More, smaller cells = denser grid.
const DENSITY_RECTS: Record<DensityVariant, Array<[number, number, number, number]>> = {
    s: [
        [3, 3, 5, 5], [10, 3, 5, 5], [17, 3, 5, 5],
        [3, 10, 5, 5], [10, 10, 5, 5], [17, 10, 5, 5],
        [3, 17, 5, 5], [10, 17, 5, 5], [17, 17, 5, 5]
    ],
    m: [[3, 3, 8, 8], [13, 3, 8, 8], [3, 13, 8, 8], [13, 13, 8, 8]],
    l: [[3, 3, 8, 18], [13, 3, 8, 18]],
    xl: [[3, 3, 18, 18]]
};

export function IconDensity({ variant, size = 16, className }: GmIconProps & { variant: DensityVariant; }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
            className={className}
        >
            {DENSITY_RECTS[variant].map((rect, index) => (
                <rect key={index} x={rect[0]} y={rect[1]} width={rect[2]} height={rect[3]} rx={1.5} />
            ))}
        </svg>
    );
}
