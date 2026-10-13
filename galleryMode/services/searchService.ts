import { ChannelStore, RestAPI } from "@webpack/common";
import {
    DiscordSearchResponse,
    MediaItem,
    RateLimitState,
    SearchParameters
} from "../types";
import {
    DiscordSearchHasType,
    ExtractedSearchResult,
    resolveHasType,
    transformSearchResponse
} from "../utils/mediaExtractor";
import { CacheService } from "./cacheService";

type SearchResult = ExtractedSearchResult;

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

    /**
     * Warm the cache for a page the user hasn't asked for yet. Identical to searchMedia() except
     * that failures are swallowed — a prefetch must never surface an error or a spinner. The
     * result lands in CacheService, so the eventual real call resolves synchronously.
     */
    public static prefetchMedia(params: SearchParameters): void {
        if (this.getRateLimitState().isRateLimited) return;
        // Back off speculative work whenever Discord has recently throttled us. requestIntervalMs
        // only rises above the base value after a 429, so this stops the prefetch from adding a
        // third request per page at exactly the moment we're already over budget.
        if (this.requestIntervalMs > this.BASE_REQUEST_INTERVAL_MS) return;
        if (CacheService.get(params)) return;
        if (this.inFlightRequests.has(CacheService.getCacheKey(params))) return;

        void this.searchMedia(params).catch(() => {
            // Intentionally silent: a failed prefetch just means the real request pays full price.
        });
    }

    /**
     * List threads under a channel, including ones the user has never opened.
     *
     * The client store only holds *active joined* threads, so a picker built from it shows
     * almost nothing in a busy forum or server. Discord exposes the full set over REST:
     *   - /guilds/:id/threads/active covers all active threads across the server
     *   - /channels/:id/threads/search covers active + archived for forum/media channels
     *   - /channels/:id/threads/archived/public and /archived/private for text channels
     * Results are cached for the session; failures degrade to whatever the store knows.
     */
    private static threadListCache = new Map<string, { timestamp: number; threads: any[]; }>();
    private static guildActiveThreadsCache = new Map<string, { timestamp: number; threads: any[]; }>();
    private static readonly THREAD_CACHE_TTL_MS = 2 * 60 * 1000;

    public static async listGuildActiveThreads(guildId: string): Promise<any[]> {
        if (!guildId) return [];
        const cached = this.guildActiveThreadsCache.get(guildId);
        if (cached && Date.now() - cached.timestamp <= this.THREAD_CACHE_TTL_MS) return cached.threads;

        const collected: any[] = [];
        try {
            await this.enforceRequestSpacing();
            const response: any = await RestAPI.get({
                url: `/guilds/${guildId}/threads/active`,
                oldFormErrors: true
            });
            const data = response?.body ?? response;
            const threadList = Array.isArray(data?.threads) ? data.threads : Array.isArray(data) ? data : [];
            for (const thread of threadList) {
                if (thread?.id) collected.push(thread);
            }
        } catch {
            // Non-fatal — fall back to store data.
        }

        this.guildActiveThreadsCache.set(guildId, { timestamp: Date.now(), threads: collected });
        return collected;
    }

    public static async listThreads(
        channelId: string,
        guildId?: string | null,
        channelType?: number
    ): Promise<any[]> {
        if (!channelId) return [];
        const cached = this.threadListCache.get(channelId);
        if (cached && Date.now() - cached.timestamp <= this.THREAD_CACHE_TTL_MS) return cached.threads;

        const collected = new Map<string, any>();
        const absorb = (list: any) => {
            for (const thread of Array.isArray(list) ? list : []) {
                if (thread?.id) collected.set(thread.id, thread);
            }
        };

        // 1. Guild-level active threads matching this channel
        if (guildId) {
            try {
                const guildThreads = await this.listGuildActiveThreads(guildId);
                for (const thread of guildThreads) {
                    if (thread?.parent_id === channelId && thread?.id) {
                        collected.set(thread.id, thread);
                    }
                }
            } catch {
                // Ignore
            }
        }

        // Resolve channel type so we don't fire /threads/search (which returns 400 Bad Request on
        // standard text [0] and announcement [5] channels) unless the channel is actually a
        // forum (15) or media (16) channel (or unknown because ChannelStore hasn't cached it).
        const resolvedChannelType = channelType ?? ChannelStore?.getChannel(channelId)?.type;
        const mayBeForumOrMedia = resolvedChannelType === 15
            || resolvedChannelType === 16
            || resolvedChannelType === undefined;

        // 2. Forum/media channels: active and archived threads via search endpoint
        let isForum = resolvedChannelType === 15 || resolvedChannelType === 16;
        if (mayBeForumOrMedia) {
            try {
                await this.enforceRequestSpacing();
                const response: any = await RestAPI.get({
                    url: `/channels/${channelId}/threads/search`,
                    query: { archived: false, sort_by: "last_message_time", sort_order: "desc", limit: 50 },
                    oldFormErrors: true
                });
                const threads = (response?.body ?? response)?.threads;
                if (Array.isArray(threads)) {
                    isForum = true;
                    absorb(threads);
                }
            } catch {
                // Not a forum, or permission denied
            }

            if (isForum) {
                // Fetch archived forum posts as well
                try {
                    await this.enforceRequestSpacing();
                    const archivedResponse: any = await RestAPI.get({
                        url: `/channels/${channelId}/threads/search`,
                        query: { archived: true, sort_by: "last_message_time", sort_order: "desc", limit: 50 },
                        oldFormErrors: true
                    });
                    absorb((archivedResponse?.body ?? archivedResponse)?.threads);
                } catch {
                    // Ignore archived fetch error
                }
            }
        }

        // 3. Text/announcement channels: public and private archived threads
        if (!isForum) {
            try {
                await this.enforceRequestSpacing();
                const response: any = await RestAPI.get({
                    url: `/channels/${channelId}/threads/archived/public`,
                    query: { limit: 100 },
                    oldFormErrors: true
                });
                const data = response?.body ?? response;
                absorb(data?.threads);

                // Fetch an additional page of archived threads if more exist
                if (data?.has_more && Array.isArray(data?.threads) && data.threads.length > 0) {
                    const last = data.threads[data.threads.length - 1];
                    const before = last?.thread_metadata?.archive_timestamp || last?.id;
                    if (before) {
                        try {
                            await this.enforceRequestSpacing();
                            const page2: any = await RestAPI.get({
                                url: `/channels/${channelId}/threads/archived/public`,
                                query: { limit: 100, before },
                                oldFormErrors: true
                            });
                            absorb((page2?.body ?? page2)?.threads);
                        } catch {
                            // Ignore page 2 error
                        }
                    }
                }
            } catch {
                // Fine — fall back to other sources
            }

            // 4. Private archived threads
            try {
                await this.enforceRequestSpacing();
                const privateResponse: any = await RestAPI.get({
                    url: `/channels/${channelId}/threads/archived/private`,
                    query: { limit: 100 },
                    oldFormErrors: true
                });
                absorb((privateResponse?.body ?? privateResponse)?.threads);
            } catch {
                // Private threads may not be available or permitted
            }
        }

        // 5. Check in-memory channels from ChannelStore
        try {
            if (ChannelStore && typeof (ChannelStore as any).getChannels === "function" && guildId) {
                const map = (ChannelStore as any).getChannels(guildId);
                const values = Array.isArray(map) ? map : typeof map === "object" && map ? Object.values(map) : [];
                for (const entry of values) {
                    const c = (entry as any)?.channel || entry;
                    if (c?.parent_id === channelId && c?.id) {
                        collected.set(c.id, c);
                    }
                }
            }
        } catch {
            // Store inspection fallback
        }

        const threads = [...collected.values()];
        this.threadListCache.set(channelId, { timestamp: Date.now(), threads });
        return threads;
    }

    public static resetNegativeCache(): void {
        this.threadListCache.clear();
        this.guildActiveThreadsCache.clear();
        this.emptyStreams.clear();
        this.rawResponseCache.clear();
    }

    private static rateLimitListeners = new Set<(state: RateLimitState) => void>();

    public static addRateLimitListener(listener: (state: RateLimitState) => void): () => void {
        this.rateLimitListeners.add(listener);
        return () => this.rateLimitListeners.delete(listener);
    }

    private static notifyRateLimitListeners(): void {
        const state = this.getRateLimitState();
        this.rateLimitListeners.forEach(listener => {
            try { listener(state); } catch {}
        });
    }

    private static setRateLimit(retryMs: number): void {
        this.onThrottled();
        this.rateLimitState = {
            isRateLimited: true,
            retryAfterMs: retryMs,
            resetTimestamp: Date.now() + retryMs
        };
        this.notifyRateLimitListeners();
    }

    private static clearRateLimit(): void {
        this.rateLimitState = { isRateLimited: false, retryAfterMs: 0, resetTimestamp: 0 };
        this.notifyRateLimitListeners();
    }

    public static clearAll(): void {
        this.resetNegativeCache();
        this.inFlightRequests.clear();
        this.inFlightRaw.clear();
        this.requestQueue = [];
        this.isProcessingQueue = false;
        this.rateLimitState = { isRateLimited: false, retryAfterMs: 0, resetTimestamp: 0 };
        this.rateLimitListeners.clear();
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
                nextOffset: cached.nextOffset ?? ((params.offset || 0) + (params.limit || 25)),
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
        // A multi-type selection cannot be expressed in a single Discord `has:` parameter, so we
        // fetch the same broad streams as ALL (attachments + embeds) and narrow the results
        // client-side via matchesRequestedType. Request cost is identical to ALL.
        const isMultiSelect = (params.filterTypes?.length ?? 0) > 1;
        const needsEmbedPass = isMultiSelect || (params.filterType ?? "all") === "all";

        if (!needsEmbedPass) {
            return this.executeSingleSearchRequest(params, resolveHasType(params.filterType));
        }

        // Dual-stream mode ("all" or multi-select): run two independent streams (attachments + embeds)
        // and blend them. Each stream tracks its own cursor (`offset` for `has:file`, `embedOffset`
        // for `has:embed`), and `< 0` marks that stream as exhausted so we never re-fetch an already
        // consumed page when one stream runs out before the other.
        const fileOffset = params.offset ?? 0;
        const embedOffset = params.embedOffset ?? (params.offset ?? 0);
        const attachmentTarget = this.searchTargetKey(params);

        const skipFileStream = fileOffset < 0 || this.emptyStreams.has(`${attachmentTarget}|file`);
        const skipEmbedStream = embedOffset < 0 || this.emptyStreams.has(`${attachmentTarget}|embed`);

        let primary: SearchResult = {
            items: [],
            totalResults: 0,
            hasMore: false,
            nextOffset: -1
        };

        if (!skipFileStream) {
            primary = await this.executeSingleSearchRequest(
                { ...params, offset: fileOffset },
                "file"
            );
            if (fileOffset === 0 && primary.totalResults === 0) {
                this.emptyStreams.add(`${attachmentTarget}|file`);
            }
        }

        let embeds: SearchResult = {
            items: [],
            totalResults: 0,
            hasMore: false,
            nextOffset: -1
        };

        if (!skipEmbedStream) {
            try {
                if (!skipFileStream) {
                    await this.enforceRequestSpacing();
                }
                embeds = await this.executeSingleSearchRequest(
                    // Keep filterTypes so the embed page is narrowed client-side the same way.
                    { ...params, filterType: isMultiSelect ? params.filterType : "all", offset: embedOffset },
                    "embed"
                );
                if (embedOffset === 0 && embeds.totalResults === 0) {
                    this.emptyStreams.add(`${attachmentTarget}|embed`);
                }
            } catch (err) {
                console.warn("[GalleryMode] Failed to include embed results in all-media query; continuing with attachments only.", err);
            }
        }

        const merged = CacheService.deduplicateItems(primary.items, embeds.items);
        if (primary.items.length > 0 && embeds.items.length > 0) {
            merged.sort((a, b) => {
                const timeA = new Date(a.timestamp).getTime() || 0;
                const timeB = new Date(b.timestamp).getTime() || 0;
                return params.sortOrder === "asc" ? timeA - timeB : timeB - timeA;
            });
        }

        const nextFileOffset = !skipFileStream && primary.hasMore ? primary.nextOffset : -1;
        const nextEmbedOffset = !skipEmbedStream && embeds.hasMore ? embeds.nextOffset : -1;
        const hasMore = nextFileOffset >= 0 || nextEmbedOffset >= 0;
        const totalResults = Math.max(primary.totalResults + embeds.totalResults, merged.length);

        return {
            items: merged,
            totalResults,
            hasMore,
            nextOffset: nextFileOffset,
            nextEmbedOffset
        };
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
            params.nsfw === false ? "0" : "1",
            params.excludeBots ? "nobots" : "allauthors",
            params.filterTypes?.length ? [...params.filterTypes].sort().join("+") : (params.filterType ?? "all")
        ].join("|");
    }

    private static readonly MAX_CHANNELS_PER_QUERY = 25;

    private static async executeSingleSearchRequest(
        params: SearchParameters,
        hasType: DiscordSearchHasType
    ): Promise<SearchResult> {
        if (params.guildId && params.channelIds && params.channelIds.length > this.MAX_CHANNELS_PER_QUERY) {
            // Discord rejects query strings with too many channel_id parameters (400 Bad Request / Request Header Too Large).
            // Chunk channelIds into batches of at most MAX_CHANNELS_PER_QUERY and combine their results.
            const chunks: string[][] = [];
            for (let i = 0; i < params.channelIds.length; i += this.MAX_CHANNELS_PER_QUERY) {
                chunks.push(params.channelIds.slice(i, i + this.MAX_CHANNELS_PER_QUERY));
            }

            // Space chunk requests sequentially so a large channel selection does not burst
            // simultaneous search calls and trip Discord's rate limiter.
            const results: SearchResult[] = [];
            for (let i = 0; i < chunks.length; i++) {
                if (i > 0) await this.enforceRequestSpacing();
                const chunkResult = await this.executeDirectSearchRequest(
                    { ...params, channelIds: chunks[i] },
                    hasType
                );
                results.push(chunkResult);
            }

            // Merge items and deduplicate across all chunks in this offset window
            const seen = new Set<string>();
            const mergedItems: MediaItem[] = [];
            let totalResults = 0;

            for (const res of results) {
                totalResults += res.totalResults;
                for (const item of res.items) {
                    if (!seen.has(item.id)) {
                        seen.add(item.id);
                        mergedItems.push(item);
                    }
                }
            }

            // Sort merged items by timestamp according to sortOrder
            mergedItems.sort((a, b) => {
                const timeA = new Date(a.timestamp).getTime() || 0;
                const timeB = new Date(b.timestamp).getTime() || 0;
                return params.sortOrder === "asc" ? timeA - timeB : timeB - timeA;
            });

            // Keep all merged items from this offset window rather than slicing to `limit` and
            // permanently discarding items from the other chunks, and advance `nextOffset` by
            // the per-chunk message page step (`limit`).
            const step = params.limit || 25;
            const hasMore = results.some(r => r.hasMore);

            return {
                items: mergedItems,
                totalResults,
                hasMore,
                nextOffset: (params.offset || 0) + step
            };
        }

        return this.executeDirectSearchRequest(params, hasType);
    }

    private static async executeDirectSearchRequest(
        params: SearchParameters,
        hasType: DiscordSearchHasType
    ): Promise<SearchResult> {
        let endpoint: string;
        const queryParams: Record<string, any> = {
            include_nsfw: params.nsfw ?? true,
            context_size: 0,
            offset: Math.max(0, params.offset || 0),
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
        return transformSearchResponse(responseData, params);
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
        if (!RestAPI?.get) {
            throw new Error("Discord RestAPI module is not available.");
        }
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
                this.setRateLimit(retryMs);
                await this.sleep(retryMs);
                this.clearRateLimit();
                return this.requestDiscordSearch(endpoint, queryParams, attempt + 1);
            }

            this.onCleanResponse();
            return responseData as DiscordSearchResponse;
        } catch (err: any) {
            const retryAfter = err?.body?.retry_after ?? err?.retry_after;
            if ((err?.status === 429 || retryAfter) && attempt < this.MAX_RETRIES) {
                const retryMs = this.normaliseRetryAfter(retryAfter || 3);
                this.setRateLimit(retryMs);
                await this.sleep(retryMs);
                this.clearRateLimit();
                return this.requestDiscordSearch(endpoint, queryParams, attempt + 1);
            }

            throw err;
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
}
