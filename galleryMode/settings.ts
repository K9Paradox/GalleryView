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
    nsfw: {
        type: OptionType.BOOLEAN,
        description: "Include NSFW results in the gallery",
        default: true
    }
});
