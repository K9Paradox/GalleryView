import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

// Lives in its own module so components can import settings without pulling in
// index.tsx — importing it from "../index" created an index ↔ GalleryView
// module cycle, which makes plugin startup order fragile.
export const settings = definePluginSettings({
    layout: {
        type: OptionType.SELECT,
        description: "Gallery Layout",
        options: [
            { label: "Grid — uniform square tiles", value: "grid", default: true },
            { label: "Masonry — natural image aspect ratios", value: "masonry" }
        ]
    },
    defaultCardSize: {
        type: OptionType.SELECT,
        description: "Card Width / Grid Density",
        options: [
            { label: "Compact (~180px - High Density)", value: "180px" },
            { label: "Standard (~240px - Balanced)", value: "240px", default: true },
            { label: "Large (~320px - Expanded)", value: "320px" },
            { label: "Showcase (~420px - High Detail)", value: "420px" }
        ]
    },
    animations: {
        type: OptionType.SELECT,
        description: "Motion & transitions",
        options: [
            { label: "Full — staggered card reveals, blur-up, hover lift", value: "full", default: true },
            { label: "Subtle — quick fades only, no movement", value: "subtle" },
            { label: "Off — no animation (best for low-end hardware)", value: "off" }
        ]
    },
    skeletonPlaceholders: {
        type: OptionType.BOOLEAN,
        description: "Show shimmering placeholder cards while a page loads instead of a spinner",
        default: true
    },
    prefetchNextPage: {
        type: OptionType.BOOLEAN,
        description: "Quietly pre-load the next page in the background so scrolling never stalls",
        default: true
    },
    nsfw: {
        type: OptionType.BOOLEAN,
        description: "Include NSFW results in the gallery",
        default: true
    }
});
