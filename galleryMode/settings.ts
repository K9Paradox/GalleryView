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
    lightweightMode: {
        type: OptionType.BOOLEAN,
        description: "Lightweight mode — for low-end hardware. Forces animations off, strips backdrop blur, disables next-page prefetching and session/scroll memory, shows static GIF & poster-only video thumbnails, and loads downscaled preview images. Individual settings below are overridden while this is on.",
        default: false
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
    gifPlayback: {
        type: OptionType.SELECT,
        description: "GIF playback",
        options: [
            { label: "Always animate", value: "always", default: true },
            { label: "Animate on hover", value: "hover" },
            { label: "Only when opened (static thumbnails)", value: "click" }
        ]
    },
    videoPlayback: {
        type: OptionType.SELECT,
        description: "Video previews",
        options: [
            { label: "Preview on hover (muted)", value: "hover", default: true },
            { label: "Autoplay all previews (muted)", value: "always" },
            { label: "Only when opened (poster frame only)", value: "click" }
        ]
    },
    respectSpoilers: {
        type: OptionType.BOOLEAN,
        description: "Blur media from spoiler-tagged messages until clicked",
        default: true
    },
    blurNsfwChannels: {
        type: OptionType.BOOLEAN,
        description: "Blur media originating from age-restricted channels until clicked",
        default: false
    },
    showMetaOverlay: {
        type: OptionType.BOOLEAN,
        description: "Show the date badge and type tag on cards",
        default: true
    },
    showAuthorFooter: {
        type: OptionType.BOOLEAN,
        description: "Show the author avatar and username under each card (off = pure gallery wall)",
        default: true
    },
    defaultScope: {
        type: OptionType.SELECT,
        description: "Default search scope when the gallery opens",
        options: [
            { label: "Current channel / thread", value: "channel", default: true },
            { label: "All sub threads (falls back to the channel)", value: "parent" },
            { label: "Entire server", value: "guild" }
        ]
    },
    defaultFilterType: {
        type: OptionType.SELECT,
        description: "Default media type filter",
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
        description: "Default result ordering",
        options: [
            { label: "Newest first", value: "desc", default: true },
            { label: "Oldest first", value: "asc" }
        ]
    },
    rememberSessions: {
        type: OptionType.BOOLEAN,
        description: "Restore your filters and scroll position when reopening a channel's gallery. Disable to keep memory usage lower on long sessions. Position memory for jump-to-message still works either way.",
        default: true
    },
    hideBotPosts: {
        type: OptionType.BOOLEAN,
        description: "Hide media posted by bots and webhooks",
        default: false
    },
    nsfw: {
        type: OptionType.BOOLEAN,
        description: "Include NSFW results in the gallery",
        default: true
    }
});
