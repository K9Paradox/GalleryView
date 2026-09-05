import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

// Lives in its own module so components can import settings without pulling in
// index.tsx — importing it from "../index" created an index ↔ GalleryView
// module cycle, which makes plugin startup order fragile.
export const settings = definePluginSettings({
    /**
     * Vencord's userplugin settings surface is essentially a flat list, so the ordering below is
     * deliberate product design: common, human-facing choices first; defaults/content controls in
     * the middle; advanced performance tuning last. Avoid reintroducing one-off implementation
     * toggles unless they are meaningful to a normal user.
     */
    // --- Layout & Window ---
    viewMode: {
        type: OptionType.SELECT,
        description: "[Layout & Window] Window Mode: Full overlay or split-screen docked beside chat",
        options: [
            { label: "Overlay — full-screen focus over chat", value: "overlay", default: true },
            { label: "Dock Right — split-screen pinned to the right of chat", value: "dockRight" },
            { label: "Dock Left — split-screen pinned to the left of chat", value: "dockLeft" }
        ]
    },
    layout: {
        type: OptionType.SELECT,
        description: "[Layout & Window] Default Layout: Uniform grid tiles or natural aspect ratio masonry",
        options: [
            { label: "Grid — uniform square tiles", value: "grid", default: true },
            { label: "Masonry — natural image aspect ratios", value: "masonry" }
        ]
    },
    defaultCardSize: {
        type: OptionType.SELECT,
        description: "[Layout & Window] Card Density: Default width for media tiles",
        options: [
            { label: "Compact — 180px (more cards per row)", value: "180px" },
            { label: "Standard — 240px (balanced)", value: "240px", default: true },
            { label: "Large — 320px (enhanced detail)", value: "320px" },
            { label: "Showcase — 420px (large previews)", value: "420px" }
        ]
    },
    cardChrome: {
        type: OptionType.SELECT,
        description: "[Layout & Window] Card Details: Visibility of badges, author info, and action buttons",
        options: [
            { label: "Full — badges and author footer always visible", value: "full", default: true },
            { label: "Compact — badges only, footer on hover", value: "compact" },
            { label: "Minimal — clean media wall, controls on hover", value: "minimal" }
        ]
    },

    // --- Performance & Behavior ---
    performanceProfile: {
        type: OptionType.SELECT,
        description: "[Performance] Experience Preset: Balance visual polish with system resource usage",
        options: [
            { label: "Balanced — snappy default, pauses video previews during fast scroll", value: "balanced", default: true },
            { label: "Pretty — richer spring animations and glassmorphism blur", value: "pretty" },
            { label: "Low-end — no blur/motion, static previews, no prefetch (battery saver)", value: "lightweight" }
        ]
    },
    thumbnailQuality: {
        type: OptionType.SELECT,
        description: "[Performance] Thumbnail Quality: Maximum resolution requested from Discord CDN",
        options: [
            { label: "Auto — follows the experience preset", value: "auto", default: true },
            { label: "Original — highest detail, most network & memory usage", value: "original" },
            { label: "High — 720px", value: "720" },
            { label: "Medium — 480px", value: "480" },
            { label: "Low — 320px (fastest loading)", value: "320" }
        ]
    },
    previewBehavior: {
        type: OptionType.SELECT,
        description: "[Performance] Media Previews: Animated GIFs and video hover playback behavior",
        options: [
            { label: "Auto — follows the experience preset", value: "auto", default: true },
            { label: "Animated — GIFs animate automatically, videos preview on hover", value: "animated" },
            { label: "Hover — animate GIFs and play videos only when hovered", value: "hover" },
            { label: "Static — play only when opened in full viewer", value: "static" }
        ]
    },
    rememberSessions: {
        type: OptionType.BOOLEAN,
        description: "[Performance] Remember Sessions: Preserve filters, search query, and scroll depth across channels",
        default: true
    },

    // --- Search Defaults ---
    defaultScope: {
        type: OptionType.SELECT,
        description: "[Search Defaults] Initial Search Scope",
        options: [
            { label: "Current channel or thread", value: "channel", default: true },
            { label: "All sub-threads in channel when available", value: "parent" },
            { label: "Entire server", value: "guild" }
        ]
    },
    defaultFilterType: {
        type: OptionType.SELECT,
        description: "[Search Defaults] Initial Media Filter",
        options: [
            { label: "All Media", value: "all", default: true },
            { label: "Images & GIFs", value: "image" },
            { label: "Videos", value: "video" },
            { label: "Embeds", value: "embed" },
            { label: "Files & Documents", value: "file" },
            { label: "Audio", value: "audio" }
        ]
    },
    defaultSortOrder: {
        type: OptionType.SELECT,
        description: "[Search Defaults] Initial Sort Order",
        options: [
            { label: "Newest first", value: "desc", default: true },
            { label: "Oldest first", value: "asc" }
        ]
    },
    hideBotPosts: {
        type: OptionType.BOOLEAN,
        description: "[Search Defaults] Hide media posted by bots and webhooks",
        default: false
    },

    // --- Privacy & Spoilers ---
    respectSpoilers: {
        type: OptionType.BOOLEAN,
        description: "[Privacy & Spoilers] Blur spoiler-tagged media until clicked",
        default: true
    },
    blurNsfwChannels: {
        type: OptionType.BOOLEAN,
        description: "[Privacy & Spoilers] Blur media from age-restricted channels until clicked",
        default: false
    },
    nsfw: {
        type: OptionType.BOOLEAN,
        description: "[Privacy & Spoilers] Include NSFW channel media in server-wide search results",
        default: true
    }
});
