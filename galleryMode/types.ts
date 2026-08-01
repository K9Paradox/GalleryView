export type MediaType = "image" | "gif" | "video" | "embed" | "file" | "audio";

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
}

export interface SearchParameters {
    channelId?: string;
    guildId?: string;
    channelIds?: string[];
    query?: string;
    filterType?: "all" | "image" | "video" | "embed" | "file" | "audio";
    beforeDate?: string;
    afterDate?: string;
    hasImage?: boolean;
    hasVideo?: boolean;
    hasEmbed?: boolean;
    offset?: number;
    limit?: number;
    authorId?: string;
    authorIds?: string[];
    mentions?: string;
}

export interface DiscordAttachment {
    id: string;
    filename: string;
    size: number;
    url: string;
    proxy_url: string;
    height?: number;
    width?: number;
    content_type?: string;
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
    thumbnail?: {
        url: string;
        proxy_url?: string;
        height?: number;
        width?: number;
    };
    image?: {
        url: string;
        proxy_url?: string;
        height?: number;
        width?: number;
    };
    video?: {
        url: string;
        proxy_url?: string;
        height?: number;
        width?: number;
    };
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
}

export interface SearchCacheEntry {
    timestamp: number;
    items: MediaItem[];
    totalResults: number;
    hasMore: boolean;
}

export interface RateLimitState {
    isRateLimited: boolean;
    retryAfterMs: number;
    resetTimestamp: number;
}
