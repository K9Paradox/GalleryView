import { RestAPI } from "@webpack/common";
import {
    DiscordEmbed,
    DiscordMessage,
    DiscordSearchResponse,
    MediaItem,
    MediaType,
    RateLimitState,
    SearchParameters
} from "../types";
import { CacheService } from "./cacheService";

type SearchResult = {
    items: MediaItem[];
    totalResults: number;
    hasMore: boolean;
    nextOffset: number;
    /** Cursor for the embed stream that "all" blends in — tracked separately from nextOffset. */
    nextEmbedOffset?: number;
};
type DiscordSearchHasType = "image" | "video" | "sound" | "file" | "embed";

export class SearchService {
    private static requestQueue: Array<() => Promise<void>> = [];
    private static isProcessingQueue = false;
    private static lastRequestTimestamp = 0;
    private static readonly BASE_REQUEST_INTERVAL_MS = 350;
    private static readonly MAX_REQUEST_INTERVAL_MS = 2500;
    /**
     * Adaptive spacing between search requests. Starts at BASE, doubles every time Discord
     * throttles us, and decays back down after a run of clean responses. This keeps normal
     * browsing fast while stopping the gallery from repeatedly walking into the same 429.
     */
    private static requestIntervalMs = 350;
    private static cleanResponseStreak = 0;
    private static readonly MAX_RETRIES = 3;

    private static rateLimitState: RateLimitState = {
        isRateLimited: false,
        retryAfterMs: 0,
        resetTimestamp: 0
    };

    private static inFlightRequests = new Map<string, Promise<SearchResult>>();

    /**
     * Negative cache: search targets that returned zero results for a given `has:` stream.
     * Lets us skip requests that are guaranteed to come back empty (e.g. the embed blend in a
     * channel that has never had a link embed). Cleared when the plugin/gallery is reset.
     */
    private static emptyStreams = new Set<string>();

    /**
     * Raw HTTP response cache, keyed by endpoint + serialized query. Distinct gallery filters
     * frequently produce byte-identical Discord requests (e.g. ALL and FILE both send `has=file`),
     * so this collapses them into a single network round-trip. Short TTL keeps results fresh.
     */
    private static rawResponseCache = new Map<string, { timestamp: number; data: DiscordSearchResponse; }>();
    private static inFlightRaw = new Map<string, Promise<DiscordSearchResponse>>();
    private static readonly RAW_CACHE_TTL_MS = 60 * 1000;
    private static readonly MAX_RAW_CACHE_ENTRIES = 60;

    public static resetNegativeCache(): void {
        this.emptyStreams.clear();
        this.rawResponseCache.clear();
    }

    public static getRateLimitState(): RateLimitState {
        if (this.rateLimitState.isRateLimited && Date.now() >= this.rateLimitState.resetTimestamp) {
            this.rateLimitState = { isRateLimited: false, retryAfterMs: 0, resetTimestamp: 0 };
        }

        return this.rateLimitState;
    }

    public static async searchMedia(params: SearchParameters): Promise<SearchResult> {
        const cacheKey = CacheService.getCacheKey(params);

        const cached = CacheService.get(params);
        if (cached) {
            return {
                items: cached.items,
                totalResults: cached.totalResults,
                hasMore: cached.hasMore,
                nextOffset: cached.nextOffset ?? ((params.offset || 0) + cached.items.length),
                nextEmbedOffset: cached.nextEmbedOffset
            };
        }

        const inFlight = this.inFlightRequests.get(cacheKey);
        if (inFlight) return inFlight;

        const requestPromise = new Promise<SearchResult>((resolve, reject) => {
            this.enqueueRequest(async () => {
                try {
                    const result = await this.executeSearchRequest(params);
                    CacheService.set(params, result.items, result.totalResults, result.hasMore, result.nextOffset, result.nextEmbedOffset);
                    resolve(result);
                } catch (err) {
                    reject(err);
                } finally {
                    this.inFlightRequests.delete(cacheKey);
                }
            });
        });

        this.inFlightRequests.set(cacheKey, requestPromise);
        return requestPromise;
    }

    private static enqueueRequest(task: () => Promise<void>): void {
        this.requestQueue.push(task);
        void this.processQueue();
    }

    private static async processQueue(): Promise<void> {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;

        try {
            while (this.requestQueue.length > 0) {
                if (this.rateLimitState.isRateLimited) {
                    const waitTime = this.rateLimitState.resetTimestamp - Date.now();
                    if (waitTime > 0) await this.sleep(waitTime);
                    this.rateLimitState = { isRateLimited: false, retryAfterMs: 0, resetTimestamp: 0 };
                }

                const timeSinceLast = Date.now() - this.lastRequestTimestamp;
                if (timeSinceLast < this.requestIntervalMs) {
                    await this.sleep(this.requestIntervalMs - timeSinceLast);
                }

                const task = this.requestQueue.shift();
                if (!task) continue;

                this.lastRequestTimestamp = Date.now();
                await task();
            }
        } finally {
            this.isProcessingQueue = false;
        }
    }

    private static async executeSearchRequest(params: SearchParameters): Promise<SearchResult> {
        const isAll = (params.filterType ?? "all") === "all";

        // "All" should feel like a real gallery, not just attachments. Discord search only accepts
        // one has: type per request, so we run two streams (attachments + embeds) and blend them.
        //
        // Each stream keeps its OWN cursor. Previously both used params.offset, so as soon as one
        // stream ran out the other kept re-requesting an already-consumed page — burning a request
        // per "Load More" that could never return anything new. embedOffset < 0 marks the embed
        // stream as exhausted, which skips the second HTTP request entirely from then on.
        const embedOffset = params.embedOffset ?? params.offset ?? 0;
        const embedExhausted = isAll && embedOffset < 0;

        const attachmentTarget = this.searchTargetKey(params);
        const skipEmbedStream = embedExhausted || this.emptyStreams.has(`${attachmentTarget}|embed`);

        const primary = await this.executeSingleSearchRequest(params, this.resolveHasType(params.filterType));

        if (isAll && !skipEmbedStream) {
            try {
                await this.enforceRequestSpacing();
                const embeds = await this.executeSingleSearchRequest(
                    { ...params, filterType: "all", offset: embedOffset },
                    "embed"
                );
                const items = CacheService.deduplicateItems(primary.items, embeds.items);

                // Remember channel/guild+filter combinations that have zero embed results at all,
                // so subsequent pages in this session don't pay for a guaranteed-empty request.
                if (embedOffset === 0 && embeds.totalResults === 0) {
                    this.emptyStreams.add(`${attachmentTarget}|embed`);
                }

                return {
                    items,
                    totalResults: Math.max(primary.totalResults, embeds.totalResults, items.length),
                    hasMore: primary.hasMore || embeds.hasMore,
                    nextOffset: primary.nextOffset,
                    nextEmbedOffset: embeds.hasMore ? embeds.nextOffset : -1
                };
            } catch (err) {
                console.warn("[GalleryMode] Failed to include embed results in all-media query; continuing with attachments only.", err);
            }
        }

        return isAll ? { ...primary, nextEmbedOffset: skipEmbedStream ? -1 : primary.nextEmbedOffset } : primary;
    }

    /** Identity of the thing being searched, ignoring pagination — used for negative caching. */
    private static searchTargetKey(params: SearchParameters): string {
        const target = params.guildId ? `g:${params.guildId}` : `c:${params.channelId ?? ""}`;
        const channels = params.channelIds?.length ? [...params.channelIds].sort().join(",") : "";
        const authors = params.authorIds?.length ? [...params.authorIds].sort().join(",") : (params.authorId ?? "");
        return [
            target,
            channels,
            authors,
            (params.query ?? "").trim().toLowerCase(),
            params.beforeDate ?? "",
            params.afterDate ?? "",
            params.nsfw === false ? "0" : "1"
        ].join("|");
    }

    private static async executeSingleSearchRequest(
        params: SearchParameters,
        hasType: DiscordSearchHasType
    ): Promise<SearchResult> {
        let endpoint: string;
        const queryParams: Record<string, any> = {
            include_nsfw: params.nsfw ?? true,
            context_size: 0,
            offset: params.offset || 0,
            has: hasType
        };

        if (params.guildId) {
            // Use the guild search endpoint for every guild-backed channel search.
            // Discord returns 400 / code 50024 for /channels/:id/messages/search on
            // forum/media/thread and some announcement-like channel surfaces, while the
            // guild endpoint accepts channel_id filtering for the same target.
            endpoint = `/guilds/${params.guildId}/messages/search`;
            if (params.channelIds?.length) {
                queryParams.channel_id = params.channelIds.length === 1 ? params.channelIds[0] : params.channelIds;
            } else if (params.channelId) {
                queryParams.channel_id = params.channelId;
            }
        } else if (params.channelId) {
            // DM and group DM searches do not have a guild endpoint.
            endpoint = `/channels/${params.channelId}/messages/search`;
        } else {
            throw new Error("No target channel or guild specified for media search.");
        }

        if (params.authorIds?.length) {
            queryParams.author_id = params.authorIds.length === 1 ? params.authorIds[0] : params.authorIds;
        } else if (params.authorId) {
            queryParams.author_id = params.authorId;
        }

        if (params.query?.trim()) {
            queryParams.content = params.query.trim();
        }

        // Date range filters: the search API only understands snowflake boundaries, so convert
        // the YYYY-MM-DD values from the date pickers into min/max message ids (local time).
        const minId = params.afterDate ? this.dateToSnowflake(params.afterDate, false) : undefined;
        if (minId) queryParams.min_id = minId;
        const maxId = params.beforeDate ? this.dateToSnowflake(params.beforeDate, true) : undefined;
        if (maxId) queryParams.max_id = maxId;

        if (params.sortOrder) {
            queryParams.sort_by = "timestamp";
            queryParams.sort_order = params.sortOrder;
        }

        const responseData = await this.requestDiscordSearch(endpoint, queryParams);
        return this.transformSearchResponse(responseData, params);
    }

    private static async requestDiscordSearch(
        endpoint: string,
        queryParams: Record<string, any>,
        attempt = 0
    ): Promise<DiscordSearchResponse> {
        if (attempt === 0) {
            const rawKey = `${endpoint}?${JSON.stringify(Object.entries(queryParams).sort())}`;

            const cached = this.rawResponseCache.get(rawKey);
            if (cached && Date.now() - cached.timestamp <= this.RAW_CACHE_TTL_MS) return cached.data;
            if (cached) this.rawResponseCache.delete(rawKey);

            // Collapse concurrent identical requests (two filters resolving the same has: type).
            const pending = this.inFlightRaw.get(rawKey);
            if (pending) return pending;

            const promise = this.performDiscordSearch(endpoint, queryParams, attempt)
                .then(data => {
                    if (this.rawResponseCache.size >= this.MAX_RAW_CACHE_ENTRIES) {
                        const oldest = this.rawResponseCache.keys().next().value;
                        if (oldest !== undefined) this.rawResponseCache.delete(oldest);
                    }
                    this.rawResponseCache.set(rawKey, { timestamp: Date.now(), data });
                    return data;
                })
                .finally(() => this.inFlightRaw.delete(rawKey));

            this.inFlightRaw.set(rawKey, promise);
            return promise;
        }

        return this.performDiscordSearch(endpoint, queryParams, attempt);
    }

    private static async performDiscordSearch(
        endpoint: string,
        queryParams: Record<string, any>,
        attempt: number
    ): Promise<DiscordSearchResponse> {
        try {
            const response: any = await RestAPI.get({
                url: endpoint,
                query: queryParams,
                oldFormErrors: true
            });

            const responseData: any = response?.body || response;

            // Discord can return a retry_after payload while a channel/server search index warms up.
            // Treat it as a transient loading state instead of surfacing a permanent error.
            if (responseData?.retry_after && !responseData?.messages && attempt < this.MAX_RETRIES) {
                const retryMs = this.normaliseRetryAfter(responseData.retry_after);
                this.onThrottled();
                this.rateLimitState = {
                    isRateLimited: true,
                    retryAfterMs: retryMs,
                    resetTimestamp: Date.now() + retryMs
                };
                await this.sleep(retryMs);
                this.rateLimitState = { isRateLimited: false, retryAfterMs: 0, resetTimestamp: 0 };
                return this.requestDiscordSearch(endpoint, queryParams, attempt + 1);
            }

            this.onCleanResponse();
            return responseData as DiscordSearchResponse;
        } catch (err: any) {
            const retryAfter = err?.body?.retry_after ?? err?.retry_after;
            if ((err?.status === 429 || retryAfter) && attempt < this.MAX_RETRIES) {
                const retryMs = this.normaliseRetryAfter(retryAfter || 3);
                this.onThrottled();
                this.rateLimitState = {
                    isRateLimited: true,
                    retryAfterMs: retryMs,
                    resetTimestamp: Date.now() + retryMs
                };
                await this.sleep(retryMs);
                this.rateLimitState = { isRateLimited: false, retryAfterMs: 0, resetTimestamp: 0 };
                return this.requestDiscordSearch(endpoint, queryParams, attempt + 1);
            }

            throw err;
        }
    }

    private static transformSearchResponse(response: DiscordSearchResponse, params: SearchParameters): SearchResult {
        const extractedItems: MediaItem[] = [];

        if (!response || !Array.isArray(response.messages)) {
            return { items: [], totalResults: 0, hasMore: false, nextOffset: params.offset || 0 };
        }

        const hitGroups = response.messages;
        const messages = hitGroups.flat().filter(Boolean) as DiscordMessage[];
        const seenMessageIds = new Set<string>();

        for (const msg of messages) {
            if (!msg?.id || seenMessageIds.has(msg.id)) continue;
            seenMessageIds.add(msg.id);

            if (params.channelId && (!params.channelIds || params.channelIds.length === 0) && msg.channel_id !== params.channelId) {
                continue;
            }

            if (msg.attachments?.length) {
                for (const att of msg.attachments) {
                    const detectedType = this.categorizeAttachment(att.filename, att.content_type);
                    if (!this.matchesRequestedType(detectedType, params.filterType)) continue;

                    const ext = att.filename.includes(".") ? att.filename.split(".").pop()?.toUpperCase() : "FILE";

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
                        author: this.transformAuthor(msg)
                    });
                }
            }

            if (msg.embeds?.length) {
                for (let index = 0; index < msg.embeds.length; index++) {
                    const embed = msg.embeds[index];
                    const detectedType = this.categorizeEmbed(embed);
                    if (!detectedType || !this.matchesRequestedType(detectedType, params.filterType)) continue;

                    const rawMediaUrl = embed.image?.url || embed.video?.url || embed.thumbnail?.url || embed.url;
                    if (!rawMediaUrl) continue;
                    const mediaUrl = this.normaliseExternalMediaUrl(rawMediaUrl);

                    const safeProxyUrl = this.safePreviewUrl(embed.image?.proxy_url || embed.video?.proxy_url || embed.thumbnail?.proxy_url);
                    const safeThumbnailUrl = this.safePreviewUrl(embed.thumbnail?.proxy_url || embed.image?.proxy_url);

                    extractedItems.push({
                        id: `emb_${msg.id}_${index}_${this.stableHash(mediaUrl)}`,
                        messageId: msg.id,
                        channelId: msg.channel_id,
                        guildId: msg.guild_id || params.guildId,
                        url: mediaUrl,
                        proxyUrl: safeProxyUrl,
                        thumbnailUrl: safeThumbnailUrl,
                        filename: embed.title || embed.provider?.name || "Embedded Media",
                        type: detectedType,
                        width: embed.image?.width || embed.video?.width || embed.thumbnail?.width,
                        height: embed.image?.height || embed.video?.height || embed.thumbnail?.height,
                        timestamp: msg.timestamp,
                        content: msg.content,
                        embedTitle: embed.title,
                        embedDescription: embed.description,
                        embedSiteName: embed.provider?.name,
                        embedColor: embed.color,
                        author: this.transformAuthor(msg)
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

    private static transformAuthor(msg: DiscordMessage) {
        return {
            id: msg.author?.id || "0",
            username: msg.author?.username || "Unknown",
            globalName: msg.author?.global_name || msg.author?.username || "Unknown",
            avatar: msg.author?.avatar,
            avatarDecoration: msg.author?.avatar_decoration,
            bot: msg.author?.bot
        };
    }

    private static matchesRequestedType(type: MediaType, filterType: SearchParameters["filterType"]): boolean {
        const filter = filterType || "all";
        if (filter === "all") return true;
        if (filter === "image") return type === "image" || type === "gif";
        if (filter === "file") return type === "file";
        return type === filter;
    }

    private static resolveHasType(filterType: SearchParameters["filterType"]): DiscordSearchHasType {
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

    private static categorizeAttachment(filename: string, contentType?: string): MediaType {
        const lowerName = filename.toLowerCase();
        const lowerType = (contentType || "").toLowerCase();

        if (lowerType.includes("gif") || /\.gif$/i.test(lowerName)) return "gif";
        if (lowerType.startsWith("image/") || /\.(png|jpe?g|webp|svg|bmp|tiff?|avif)$/i.test(lowerName)) return "image";
        if (lowerType.startsWith("video/") || /\.(mp4|webm|mov|m4v|mkv|avi|flv)$/i.test(lowerName)) return "video";
        if (lowerType.startsWith("audio/") || /\.(mp3|ogg|oga|wav|flac|m4a|aac|opus)$/i.test(lowerName)) return "audio";

        return "file";
    }

    private static categorizeEmbed(embed: DiscordEmbed): MediaType | null {
        const imageUrl = embed.image?.url || embed.thumbnail?.url || embed.url || "";
        if (embed.type === "gifv" || /\.(gif|gifv)(\?|$)/i.test(imageUrl)) return "gif";
        if (embed.video || embed.type === "video") return "video";
        if (embed.image || embed.type === "image") return "image";
        if (embed.thumbnail || embed.url || embed.type === "link" || embed.type === "article" || embed.provider) return "embed";

        return null;
    }

    private static safePreviewUrl(url?: string): string | undefined {
        if (!url || !this.isDiscordMediaUrl(url)) return undefined;
        return url;
    }

    private static normaliseExternalMediaUrl(url: string): string {
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

    private static isDiscordMediaUrl(url: string): boolean {
        try {
            const host = new URL(url).hostname.toLowerCase();
            return host === "cdn.discordapp.com" || host === "media.discordapp.net" || host.endsWith(".discordapp.net");
        } catch {
            return false;
        }
    }

    private static async enforceRequestSpacing(): Promise<void> {
        const timeSinceLast = Date.now() - this.lastRequestTimestamp;
        if (timeSinceLast < this.requestIntervalMs) {
            await this.sleep(this.requestIntervalMs - timeSinceLast);
        }
        this.lastRequestTimestamp = Date.now();
    }

    private static onThrottled(): void {
        this.cleanResponseStreak = 0;
        this.requestIntervalMs = Math.min(this.MAX_REQUEST_INTERVAL_MS, Math.round(this.requestIntervalMs * 2));
    }

    private static onCleanResponse(): void {
        if (this.requestIntervalMs <= this.BASE_REQUEST_INTERVAL_MS) return;
        if (++this.cleanResponseStreak < 5) return;
        this.cleanResponseStreak = 0;
        this.requestIntervalMs = Math.max(this.BASE_REQUEST_INTERVAL_MS, Math.round(this.requestIntervalMs / 2));
    }

    private static normaliseRetryAfter(retryAfter: number): number {
        const retry = Number(retryAfter) || 3;
        // Discord sometimes returns seconds and sometimes milliseconds depending on the code path.
        return retry > 100 ? retry : retry * 1000;
    }

    // Discord snowflakes encode ms-since-the-Discord-epoch in their high bits.
    private static readonly DISCORD_EPOCH_MS = 1420070400000n;

    private static dateToSnowflake(date: string, endOfDay: boolean): string | undefined {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
        if (!match) return undefined;

        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (!year || !month || !day) return undefined;

        const ms = endOfDay
            ? new Date(year, month - 1, day, 23, 59, 59, 999).getTime()
            : new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
        if (!Number.isFinite(ms)) return undefined;

        return ((BigInt(ms) - this.DISCORD_EPOCH_MS) << 22n).toString();
    }

    private static sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
    }

    private static stableHash(value: string): string {
        let hash = 0;
        for (let i = 0; i < value.length; i++) {
            hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
        }
        return Math.abs(hash).toString(36);
    }
}
