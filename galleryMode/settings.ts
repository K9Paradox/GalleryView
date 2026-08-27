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
    viewMode: {
        type: OptionType.SELECT,
        description: "Gallery window",
        options: [
            { label: "Overlay — focus entirely on the gallery", value: "overlay", default: true },
            { label: "Dock right — split-screen with chat", value: "dockRight" },
            { label: "Dock left — split-screen with chat", value: "dockLeft" }
        ]
    },
    performanceProfile: {
        type: OptionType.SELECT,
        description: "Experience preset",
        options: [
            { label: "Balanced — snappy default, pauses previews while scrolling", value: "balanced", default: true },
            { label: "Pretty — richer motion and glass treatment", value: "pretty" },
            { label: "Low-end — no blur/motion, static previews, no prefetch or session memory", value: "lightweight" }
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
    cardChrome: {
        type: OptionType.SELECT,
        description: "Card information density",
        options: [
            { label: "Full — badges and author footer", value: "full", default: true },
            { label: "Compact — badges only", value: "compact" },
            { label: "Minimal — clean media wall", value: "minimal" }
        ]
    },
    hideBotPosts: {
        type: OptionType.BOOLEAN,
        description: "Hide media posted by bots and webhooks",
        default: false
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
    },
    thumbnailQuality: {
        type: OptionType.SELECT,
        description: "Advanced: thumbnail quality",
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
        description: "Advanced: GIF and video previews",
        options: [
            { label: "Auto — follows the experience preset", value: "auto", default: true },
            { label: "Animated — GIFs animate, videos preview on hover", value: "animated" },
            { label: "Hover — animate/play only while hovered", value: "hover" },
            { label: "Static — only play when opened", value: "static" }
        ]
    },
    rememberSessions: {
        type: OptionType.BOOLEAN,
        description: "Advanced: remember filters, results and scroll position between gallery opens. Low-end preset overrides this off.",
        default: true
    }
});
