import { findComponentByCodeLazy } from "@webpack";
import { React } from "@webpack/common";

const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');

interface GalleryHeaderButtonProps {
    active: boolean;
    onToggle: () => void;
}

export function GalleryIcon({ active }: { active: boolean }) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM5 15l3.5-4.5 2.5 3.01L14.5 9l4.5 6H5z" />
        </svg>
    );
}

export const GalleryHeaderButton: React.FC<GalleryHeaderButtonProps> = ({ active, onToggle }) => {
    if (!HeaderBarIcon) {
        return (
            <div
                className={`gm-header-button ${active ? "active" : ""}`}
                onClick={onToggle}
                role="button"
                tabIndex={0}
                title={active ? "Exit Gallery Mode" : "Open Gallery Mode"}
            >
                <GalleryIcon active={active} />
            </div>
        );
    }

    return (
        <HeaderBarIcon
            className={`gm-header-button ${active ? "active" : ""}`}
            onClick={onToggle}
            tooltip={active ? "Exit Gallery Mode" : "Open Gallery Mode"}
            icon={() => <GalleryIcon active={active} />}
            selected={active}
        />
    );
};
