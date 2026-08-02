// Shared type definitions for GalleryMode. Keep this file type-only —
// no runtime code belongs here.

export type MediaType = "image" | "gif" | "video" | "embed" | "file" | "audio";

export type GalleryFilterType = "all" | "image" | "video" | "embed" | "file" | "audio";

export type GallerySortOrder = "asc" | "desc";

export interface MediaAuthor {
    id: string;
    username: string;
    globalName?: string;
    avatar?: string;
    avatarDecoration?: string;
    bot?: boolean;
}

export interface MediaItem {
    id: string;
    messageId: string;
    channelId: string;
    guildId?: string;
    author: MediaAuthor;
    timestamp: string;
    content: string;
    type: MediaType;
    url: string;
    proxyUrl?: string;
    thumbnailUrl?: string;
    width?: number;
    height?: number;
    filename?: string;
    fileSize?: number;
    fileExtension?: string;
    embedTitle?: string;
    embedDescription?: string;
    embedSiteName?: string;
    embedColor?: number;
    isVideo?: boolean;
    /** Discord marks spoilered attachments with a SPOILER_ filename prefix. */
    isSpoiler?: boolean;
    /** Media that came from an age-restricted channel. */
    isNsfwChannel?: boolean;
}

export interface SearchParameters {
    channelId?: string;
    guildId?: string;
    channelIds?: string[];
    query?: string;
    filterType?: GalleryFilterType;
    /**
     * Multi-select media types. When present (and containing more than one entry) this takes
     * precedence over filterType: the union of the requested types is fetched and then filtered
     * client-side. A single entry behaves exactly like filterType.
     */
    filterTypes?: GalleryFilterType[];
    beforeDate?: string;
    afterDate?: string;
    hasImage?: boolean;
    hasVideo?: boolean;
    hasEmbed?: boolean;
    offset?: number;
    /** Separate cursor for the embed stream blended into the "all" filter (see SearchService). */
    embedOffset?: number;
    limit?: number;
    authorId?: string;
    authorIds?: string[];
    mentions?: string;
    nsfw?: boolean;
    /** Result ordering by message timestamp. Defaults to "desc" (newest first). */
    sortOrder?: GallerySortOrder;
}

export interface DiscordAttachment {
    id: string;
    /** Bit 1<<3 marks the attachment as a spoiler in newer payloads. */
    flags?: number;
    filename: string;
    size: number;
    url: string;
    proxy_url: string;
    height?: number;
    width?: number;
    content_type?: string;
}

export interface DiscordEmbedMedia {
    url: string;
    proxy_url?: string;
    height?: number;
    width?: number;
}

export interface DiscordEmbed {
    title?: string;
    type?: string;
    description?: string;
    url?: string;
    color?: number;
    timestamp?: string;
    provider?: {
        name?: string;
        url?: string;
    };
    author?: {
        name?: string;
        url?: string;
        icon_url?: string;
    };
    thumbnail?: DiscordEmbedMedia;
    image?: DiscordEmbedMedia;
    video?: DiscordEmbedMedia;
}

export interface DiscordUser {
    id: string;
    username: string;
    global_name?: string;
    avatar?: string;
    avatar_decoration?: string;
    bot?: boolean;
}

export interface DiscordMessage {
    id: string;
    channel_id: string;
    guild_id?: string;
    author: DiscordUser;
    content: string;
    timestamp: string;
    edited_timestamp?: string;
    attachments: DiscordAttachment[];
    embeds: DiscordEmbed[];
}

export interface DiscordSearchResponse {
    total_results: number;
    messages: DiscordMessage[][];
    analytics_id?: string;
    /** Present instead of results while the search index warms up. */
    retry_after?: number;
}

export interface SearchCacheEntry {
    timestamp: number;
    items: MediaItem[];
    totalResults: number;
    hasMore: boolean;
    nextOffset: number;
    nextEmbedOffset?: number;
}

export interface RateLimitState {
    isRateLimited: boolean;
    retryAfterMs: number;
    resetTimestamp: number;
}
