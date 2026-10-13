import { ChannelStore } from "@webpack/common";
import { CacheService } from "../services/cacheService";
import {
    DiscordEmbed,
    DiscordMessage,
    DiscordSearchResponse,
    MediaItem,
    MediaType,
    SearchParameters
} from "../types";

export type DiscordSearchHasType = "image" | "video" | "sound" | "file" | "embed";

export interface ExtractedSearchResult {
    items: MediaItem[];
    totalResults: number;
    hasMore: boolean;
    nextOffset: number;
    nextEmbedOffset?: number;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "svg", "bmp", "tif", "tiff", "avif"]);
const GIF_EXTENSIONS = new Set(["gif", "gifv"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "mkv", "avi", "flv"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "ogg", "oga", "wav", "flac", "m4a", "aac", "opus"]);

/**
 * Safely extract a clean file extension from a filename or URL without accidentally
 * returning a domain TLD (e.g. "COM" from `https://example.com/media/abc`).
 * Also inspects `?format=` query parameters used by modern CDNs (e.g. Twitter/X `pbs.twimg.com`).
 */
export function extractExtensionFromUrl(filenameOrUrl?: string): string | undefined {
    if (!filenameOrUrl) return undefined;
    const raw = filenameOrUrl.trim();
    if (!raw) return undefined;

    if (/^https?:\/\//i.test(raw)) {
        try {
            const parsed = new URL(raw);
            const formatParam = parsed.searchParams.get("format")?.trim().toLowerCase();
            if (formatParam && /^[a-z0-9]{1,8}$/.test(formatParam)) {
                return formatParam.toUpperCase();
            }
            const lastSegment = parsed.pathname.split("/").filter(Boolean).pop() || "";
            const dotIndex = lastSegment.lastIndexOf(".");
            if (dotIndex > 0 && dotIndex < lastSegment.length - 1) {
                const ext = lastSegment.slice(dotIndex + 1).replace(/[^a-z0-9]/gi, "").toUpperCase();
                if (ext.length >= 1 && ext.length <= 10) return ext;
            }
            return undefined;
        } catch {
            return undefined;
        }
    }

    // Plain filename (not a URL): strip any accidental query string or fragment first.
    const cleanName = raw.split(/[?#]/)[0];
    const lastSegment = cleanName.split("/").pop() || cleanName;
    const dotIndex = lastSegment.lastIndexOf(".");
    if (dotIndex > 0 && dotIndex < lastSegment.length - 1) {
        const ext = lastSegment.slice(dotIndex + 1).replace(/[^a-z0-9]/gi, "").toUpperCase();
        if (ext.length >= 1 && ext.length <= 10) return ext;
    }
    return undefined;
}

export function isLikelyImageUrl(url?: string): boolean {
    if (!url) return false;
    if (/\.(png|jpe?g|webp|gif|avif|bmp)(\?|$)/i.test(url)) return true;
    const ext = extractExtensionFromUrl(url)?.toLowerCase();
    return !!ext && (IMAGE_EXTENSIONS.has(ext) || GIF_EXTENSIONS.has(ext));
}

export function categorizeAttachment(filename: string, contentType?: string, url?: string): MediaType {
    const lowerType = (contentType || "").toLowerCase();

    if (lowerType.includes("gif")) return "gif";
    if (lowerType.startsWith("image/")) return "image";
    if (lowerType.startsWith("video/")) return "video";
    if (lowerType.startsWith("audio/")) return "audio";

    const ext = (extractExtensionFromUrl(filename) || extractExtensionFromUrl(url) || "").toLowerCase();
    if (GIF_EXTENSIONS.has(ext)) return "gif";
    if (IMAGE_EXTENSIONS.has(ext)) return "image";
    if (VIDEO_EXTENSIONS.has(ext)) return "video";
    if (AUDIO_EXTENSIONS.has(ext)) return "audio";

    return "file";
}

export function categorizeEmbed(embed: DiscordEmbed): MediaType | null {
    const rawMediaUrl = embed.image?.url || embed.video?.url || embed.thumbnail?.url || embed.url || "";
    const mediaUrl = rawMediaUrl ? normaliseExternalMediaUrl(rawMediaUrl) : "";
    const ext = extractExtensionFromUrl(mediaUrl)?.toLowerCase();

    if (embed.type === "gifv" || (ext && GIF_EXTENSIONS.has(ext)) || /\.(gif|gifv)(\?|$)/i.test(mediaUrl)) {
        return "gif";
    }
    if (embed.video || embed.type === "video" || (ext && VIDEO_EXTENSIONS.has(ext))) {
        return "video";
    }
    if (embed.image || embed.type === "image" || (ext && IMAGE_EXTENSIONS.has(ext))) {
        return "image";
    }
    if (embed.thumbnail || embed.url || embed.type === "link" || embed.type === "article" || embed.provider) {
        return "embed";
    }

    return null;
}

export function matchesRequestedType(type: MediaType, params: SearchParameters): boolean {
    const selected = params.filterTypes?.length ? params.filterTypes : [params.filterType || "all"];
    return selected.some(filter => {
        if (filter === "all") return true;
        // "image" covers static images and GIFs, matching the IMAGE tab's label.
        if (filter === "image") return type === "image" || type === "gif";
        if (filter === "file") return type === "file";
        return type === filter;
    });
}

export function resolveHasType(filterType: SearchParameters["filterType"]): DiscordSearchHasType {
    switch (filterType) {
        case "image":
            return "image";
        case "video":
            return "video";
        case "audio":
            return "sound";
        case "embed":
            return "embed";
        case "file":
        case "all":
        default:
            return "file";
    }
}

export function isDiscordMediaUrl(url: string): boolean {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return host === "cdn.discordapp.com" || host === "media.discordapp.net" || host.endsWith(".discordapp.net");
    } catch {
        return false;
    }
}

export function safePreviewUrl(url?: string): string | undefined {
    if (!url || !isDiscordMediaUrl(url)) return undefined;
    return url;
}

export function normaliseExternalMediaUrl(url: string): string {
    try {
        const parsed = new URL(url);
        // Old Twitter/X embeds often store image variants as /media/id.jpg:large,
        // which now returns 404. Convert it to the modern variant query format.
        if (parsed.hostname === "pbs.twimg.com") {
            const match = parsed.pathname.match(/^(\/media\/[^.]+)\.(jpg|jpeg|png|webp):(small|medium|large|orig)$/i);
            if (match) {
                parsed.pathname = match[1];
                parsed.search = `?format=${match[2].toLowerCase()}&name=${match[3].toLowerCase()}`;
                return parsed.toString();
            }
        }
    } catch {
        // Keep the original if URL parsing fails.
    }

    return url;
}

export function stableHash(value: string): string {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
}

export function transformAuthor(msg: DiscordMessage) {
    return {
        id: msg.author?.id || "0",
        username: msg.author?.username || "Unknown",
        globalName: msg.author?.global_name || msg.author?.username || "Unknown",
        avatar: msg.author?.avatar,
        avatarDecoration: msg.author?.avatar_decoration,
        bot: msg.author?.bot
    };
}

export function transformSearchResponse(
    response: DiscordSearchResponse,
    params: SearchParameters
): ExtractedSearchResult {
    const extractedItems: MediaItem[] = [];

    if (!response || !Array.isArray(response.messages)) {
        return { items: [], totalResults: 0, hasMore: false, nextOffset: params.offset || 0 };
    }

    const hitGroups = response.messages;
    const messages = hitGroups.flat().filter(Boolean) as DiscordMessage[];
    const seenMessageIds = new Set<string>();

    for (const msg of messages) {
        if (!msg?.id || seenMessageIds.has(msg.id)) continue;

        // Bot/webhook exclusion. Discord search has no author-type filter, but every
        // payload carries author.bot (and webhook messages carry webhook_id), so the
        // client-side filter is exact. Filtered messages still count towards
        // total_results/offset advancement — pagination is unaffected, and the gallery's
        // barren-page walker already handles pages that yield no renderable cards.
        if (params.excludeBots && (msg.author?.bot || msg.webhook_id)) continue;

        seenMessageIds.add(msg.id);

        // Age-restricted source channel — used to optionally blur previews.
        let isNsfwChannel = false;
        try {
            isNsfwChannel = !!ChannelStore?.getChannel(msg.channel_id)?.nsfw;
        } catch {
            // Channel not cached; treat as safe rather than blurring everything.
        }

        if (params.channelId && (!params.channelIds || params.channelIds.length === 0) && msg.channel_id !== params.channelId) {
            continue;
        }

        if (msg.attachments?.length) {
            for (const att of msg.attachments) {
                const detectedType = categorizeAttachment(att.filename, att.content_type, att.url);
                if (!matchesRequestedType(detectedType, params)) continue;

                const ext = extractExtensionFromUrl(att.filename) || extractExtensionFromUrl(att.url) || "FILE";
                // Discord flags spoilered attachments with a SPOILER_ filename prefix, and
                // newer payloads additionally set bit 1<<3 on attachment.flags.
                const isSpoiler = att.filename.startsWith("SPOILER_") || !!((att.flags ?? 0) & 8);

                extractedItems.push({
                    id: `att_${att.id}`,
                    messageId: msg.id,
                    channelId: msg.channel_id,
                    guildId: msg.guild_id || params.guildId,
                    url: att.url,
                    proxyUrl: att.proxy_url || att.url,
                    thumbnailUrl: detectedType === "image" || detectedType === "gif" ? (att.proxy_url || att.url) : undefined,
                    filename: att.filename,
                    type: detectedType,
                    fileExtension: ext,
                    fileSize: att.size,
                    width: att.width,
                    height: att.height,
                    timestamp: msg.timestamp,
                    content: msg.content,
                    isSpoiler,
                    isNsfwChannel,
                    author: transformAuthor(msg)
                });
            }
        }

        if (msg.embeds?.length) {
            for (let index = 0; index < msg.embeds.length; index++) {
                const embed = msg.embeds[index];
                const detectedType = categorizeEmbed(embed);
                if (!detectedType || !matchesRequestedType(detectedType, params)) continue;

                const rawMediaUrl = embed.image?.url || embed.video?.url || embed.thumbnail?.url || embed.url;
                if (!rawMediaUrl) continue;
                const mediaUrl = normaliseExternalMediaUrl(rawMediaUrl);

                const rawProxyUrl = embed.image?.proxy_url || embed.video?.proxy_url || embed.thumbnail?.proxy_url;
                const rawThumbUrl = embed.thumbnail?.proxy_url || embed.image?.proxy_url;
                const safeProxy = safePreviewUrl(rawProxyUrl ? normaliseExternalMediaUrl(rawProxyUrl) : undefined);
                const safeThumb = safePreviewUrl(rawThumbUrl ? normaliseExternalMediaUrl(rawThumbUrl) : undefined);
                const ext = extractExtensionFromUrl(mediaUrl);

                extractedItems.push({
                    id: `emb_${msg.id}_${index}_${stableHash(mediaUrl)}`,
                    messageId: msg.id,
                    channelId: msg.channel_id,
                    guildId: msg.guild_id || params.guildId,
                    url: mediaUrl,
                    proxyUrl: safeProxy,
                    thumbnailUrl: safeThumb,
                    filename: embed.title || embed.provider?.name || "Embedded Media",
                    type: detectedType,
                    fileExtension: ext,
                    width: embed.image?.width || embed.video?.width || embed.thumbnail?.width,
                    height: embed.image?.height || embed.video?.height || embed.thumbnail?.height,
                    timestamp: msg.timestamp,
                    content: msg.content,
                    embedTitle: embed.title,
                    embedDescription: embed.description,
                    embedSiteName: embed.provider?.name,
                    embedColor: embed.color,
                    // A link wrapped in || || spoils the embed it generates.
                    isSpoiler: /\|\|.*?\|\|/s.test(msg.content || ""),
                    isNsfwChannel,
                    author: transformAuthor(msg)
                });
            }
        }
    }

    const totalResults = response.total_results ?? extractedItems.length;
    const currentOffset = params.offset || 0;
    // Each group in response.messages is one matched message ("hit") plus its surrounding
    // context messages. The number of groups is therefore the number of results consumed on
    // this page, which is what Discord's `offset` pagination advances by.
    const returnedHits = hitGroups.length || messages.length;
    const nextOffset = currentOffset + returnedHits;
    const hasMore = returnedHits > 0 && nextOffset < totalResults;

    return {
        items: CacheService.deduplicateItems([], extractedItems),
        totalResults,
        hasMore,
        nextOffset
    };
}
