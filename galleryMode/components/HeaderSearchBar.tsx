import { React } from "@webpack/common";

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

export const GalleryHeaderButton: React.FC<GalleryHeaderButtonProps> = ({ active, onToggle }) => {
    return (
        <button
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
