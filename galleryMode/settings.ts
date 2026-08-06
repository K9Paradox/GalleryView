import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

// Lives in its own module so components can import settings without pulling in
// index.tsx — importing it from "../index" created an index ↔ GalleryView
// module cycle, which makes plugin startup order fragile.
export const settings = definePluginSettings({
    /**
     * The settings are intentionally ordered from "I just want the gallery to feel right" to
     * "power-user defaults". Vencord's built-in plugin settings UI is a flat list, so we collapse
     * redundant knobs into human-facing choices (preset, style, card chrome) instead of exposing
     * every implementation detail as another toggle.
     */
    viewMode: {
        type: OptionType.SELECT,
        description: "Gallery window",
        options: [
            { label: "Overlay — focus entirely on the gallery", value: "overlay", default: true },
            { label: "Dock right — split-screen with chat", value: "dockRight" },
            { label: "Dock left — split-screen with chat", value: "dockLeft" }
        ]
    },
    dockWidth: {
        type: OptionType.SELECT,
        description: "Docked gallery width",
        options: [
            { label: "Narrow — 360px", value: "360px" },
            { label: "Comfortable — 420px", value: "420px" },
            { label: "Wide — 520px", value: "520px", default: true },
            { label: "Showcase — 640px", value: "640px" }
        ]
    },
    performanceProfile: {
        type: OptionType.SELECT,
        description: "Experience preset",
        options: [
            { label: "Balanced — snappy motion, normal thumbnails, sensible prefetch", value: "balanced", default: true },
            { label: "Pretty — glass, richer animation and warmer prefetch", value: "pretty" },
            { label: "Low-end — no motion/blur, static previews, no prefetch or session memory", value: "lightweight" }
        ]
    },
    galleryStyle: {
        type: OptionType.SELECT,
        description: "Visual style",
        options: [
            { label: "Glass — translucent premium overlay", value: "glass", default: true },
            { label: "Solid — cleaner and cheaper to render", value: "solid" },
            { label: "Discord native — flatter, closer to the app", value: "native" }
        ]
    },
    layout: {
        type: OptionType.SELECT,
        description: "Gallery layout",
        options: [
            { label: "Grid — uniform square tiles", value: "grid", default: true },
            { label: "Masonry — natural image aspect ratios", value: "masonry" }
        ]
    },
    defaultCardSize: {
        type: OptionType.SELECT,
        description: "Card density",
        options: [
            { label: "Compact — 180px", value: "180px" },
            { label: "Standard — 240px", value: "240px", default: true },
            { label: "Large — 320px", value: "320px" },
            { label: "Showcase — 420px", value: "420px" }
        ]
    },
    thumbnailQuality: {
        type: OptionType.SELECT,
        description: "Thumbnail quality",
        options: [
            { label: "Auto — follows the experience preset", value: "auto", default: true },
            { label: "Original — highest detail, most memory", value: "original" },
            { label: "High — 720px", value: "720" },
            { label: "Medium — 480px", value: "480" },
            { label: "Low — 320px", value: "320" }
        ]
    },
    previewBehavior: {
        type: OptionType.SELECT,
        description: "GIF and video previews",
        options: [
            { label: "Auto — follows the experience preset", value: "auto", default: true },
            { label: "Animated — GIFs animate, videos preview on hover", value: "animated" },
            { label: "Hover — animate/play only while hovered", value: "hover" },
            { label: "Static — only play when opened", value: "static" }
        ]
    },
    cardChrome: {
        type: OptionType.SELECT,
        description: "Card information density",
        options: [
            { label: "Full — badges and author footer", value: "full", default: true },
            { label: "Compact — badges only", value: "compact" },
            { label: "Minimal — clean media wall", value: "minimal" }
        ]
    },
    defaultScope: {
        type: OptionType.SELECT,
        description: "Default search scope",
        options: [
            { label: "Current channel / thread", value: "channel", default: true },
            { label: "All sub threads when available", value: "parent" },
            { label: "Entire server", value: "guild" }
        ]
    },
    defaultFilterType: {
        type: OptionType.SELECT,
        description: "Default media type",
        options: [
            { label: "All", value: "all", default: true },
            { label: "Images & GIFs", value: "image" },
            { label: "Videos", value: "video" },
            { label: "Embeds", value: "embed" },
            { label: "Files", value: "file" },
            { label: "Audio", value: "audio" }
        ]
    },
    defaultSortOrder: {
        type: OptionType.SELECT,
        description: "Default sort order",
        options: [
            { label: "Newest first", value: "desc", default: true },
            { label: "Oldest first", value: "asc" }
        ]
    },
    rememberSessions: {
        type: OptionType.BOOLEAN,
        description: "Remember filters, results and scroll position between gallery opens. Low-end preset overrides this off.",
        default: true
    },
    hideBotPosts: {
        type: OptionType.BOOLEAN,
        description: "Hide media posted by bots and webhooks",
        default: false
    },
    respectSpoilers: {
        type: OptionType.BOOLEAN,
        description: "Blur spoiler-tagged media until clicked",
        default: true
    },
    blurNsfwChannels: {
        type: OptionType.BOOLEAN,
        description: "Blur media from age-restricted channels until clicked",
        default: false
    },
    nsfw: {
        type: OptionType.BOOLEAN,
        description: "Include NSFW results in the gallery",
        default: true
    }
});
