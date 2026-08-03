import { GallerySortOrder, MediaItem, SearchCacheEntry, SearchParameters } from "../types";

export interface GallerySessionState {
    mediaItems: MediaItem[];
    offset: number;
    totalResults: number;
    hasMore: boolean;
    scrollTop: number;
    filterType: "all" | "image" | "video" | "embed" | "file" | "audio";
    selectedTypes?: Array<"all" | "image" | "video" | "embed" | "file" | "audio">;
    // "parent" = every thread under the current thread's parent channel.
    scope: "channel" | "parent" | "guild";
    searchQuery: string;
    activeQuery: string;
    cardMinWidth?: string;
    beforeDate?: string;
    afterDate?: string;
    sortOrder?: GallerySortOrder;
    selectedAuthors?: Array<{ id: string; name: string }>;
    selectedChannelIds?: string[];
    selectedThreadIds?: string[];
}

export class CacheService {
    private static cache: Map<string, SearchCacheEntry> = new Map();
    private static sessions: Map<string, GallerySessionState> = new Map();
    private static DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes cache TTL
    // Hard caps so a long Discord session can't grow memory without bound. Maps are insertion
    // ordered, so the oldest entry is always the first key — cheap LRU-by-recency via re-insert.
    private static MAX_CACHE_ENTRIES = 80;
    private static MAX_SESSIONS = 12;
    // Sessions retain their loaded media so reopening a channel is instant. Without a cap, a
    // user who scrolled deep through several large channels keeps every item alive: 12 sessions
    // times thousands of items is real memory. Restoring the first few pages is enough to feel
    // instant; anything beyond that is re-fetched on scroll (and usually still cached).
    private static MAX_SESSION_ITEMS = 300;
    // Hard ceiling applied even to a session the user has scrolled into, so memory still cannot
    // grow without bound during a very long browse.
    private static MAX_SESSION_ITEMS_HARD = 1200;

    /**
     * Generate a deterministic, fully unique cache key from search parameters
     */
    public static generateKey(params: SearchParameters): string {
        const target = params.channelId ? `channel:${params.channelId}` : `guild:${params.guildId || "global"}`;
        const channels = params.channelIds && params.channelIds.length > 0 
            ? `chans:${[...params.channelIds].sort().join(",")}` 
            : "all_chans";
        const query = (params.query || "").trim().toLowerCase();
        // Multi-select participates in the key: the same has: streams are fetched but the
        // client-side narrowing differs, so results are not interchangeable.
        const filter = params.filterTypes?.length
            ? [...params.filterTypes].sort().join("+")
            : (params.filterType || "all");
        const offset = params.offset || 0;
        // The "all" filter blends a second embed stream with its own cursor; two pages can share
        // an attachment offset but differ in embed offset, so it belongs in the key.
        const embedOffset = params.embedOffset ?? offset;
        const limit = params.limit || 25;
        const authors = params.authorIds && params.authorIds.length > 0 
            ? `authors:${[...params.authorIds].sort().join(",")}` 
            : (params.authorId ? `author:${params.authorId}` : "any_author");
        const before = params.beforeDate || "";
        const after = params.afterDate || "";
        // NSFW and sort order change the result set, so they must participate in the key —
        // otherwise toggling them would silently serve results cached with the old values.
        const sort = params.sortOrder || "desc";
        const nsfw = params.nsfw === false ? "0" : "1";

        return `${target}|${channels}|q:${query}|f:${filter}|a:${authors}|before:${before}|after:${after}|sort:${sort}|nsfw:${nsfw}|o:${offset}|eo:${embedOffset}|l:${limit}`;
    }

    /**
     * Alias for generateKey
     */
    public static getCacheKey(params: SearchParameters): string {
        return this.generateKey(params);
    }

    /**
     * Retrieve cached search results if valid and unexpired
     */
    public static get(params: SearchParameters): SearchCacheEntry | null {
        const key = this.generateKey(params);
        const entry = this.cache.get(key);

        if (!entry) return null;

        // Check if cache entry has expired
        if (Date.now() - entry.timestamp > this.DEFAULT_TTL_MS) {
            this.cache.delete(key);
            return null;
        }

        // Refresh recency so frequently used pages survive LRU eviction.
        this.cache.delete(key);
        this.cache.set(key, entry);

        return entry;
    }

    /**
     * Non-mutating "is this page already warm?" check. Used by the UI to decide whether it needs
     * to show a loading state at all — a cached page resolves instantly, so flashing a spinner for
     * it would be pure jank.
     */
    public static has(params: SearchParameters): boolean {
        const entry = this.cache.get(this.generateKey(params));
        return !!entry && Date.now() - entry.timestamp <= this.DEFAULT_TTL_MS;
    }

    /**
     * Store search results into the cache
     */
    public static set(
        params: SearchParameters,
        items: MediaItem[],
        totalResults: number,
        hasMore: boolean,
        nextOffset?: number,
        nextEmbedOffset?: number
    ): void {
        const key = this.generateKey(params);
        this.cache.delete(key); // move an existing key to most-recent position
        if (this.cache.size >= this.MAX_CACHE_ENTRIES) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey !== undefined) this.cache.delete(oldestKey);
        }
        this.cache.set(key, {
            timestamp: Date.now(),
            items,
            totalResults,
            hasMore,
            nextOffset: nextOffset ?? ((params.offset || 0) + items.length),
            nextEmbedOffset
        });
    }

    /**
     * Save active gallery viewing session state (including scroll position and card size)
     */
    public static saveSession(sessionKey: string, state: GallerySessionState): void {
        let trimmed = state;

        // Only trim when the user is near the top. Discarding the tail of a list they have
        // scrolled deep into would strand them: the retained slice cannot reach their saved
        // position, so the restore lands somewhere else entirely.
        //
        // This previously trimmed unconditionally and zeroed scrollTop, which silently threw
        // away the scroll position whenever the last save happened to hold more than
        // MAX_SESSION_ITEMS. Whether that occurred depended on where the user was in the
        // paging cycle, which is exactly why the "reset to top" looked random.
        const overCap = state.mediaItems.length > this.MAX_SESSION_ITEMS;
        const scrolledIntoTail = state.scrollTop > 0;

        if (overCap && !scrolledIntoTail) {
            // Truncating the items alone would leave `offset` pointing past the end, so the next
            // "Load More" after a restore would skip everything in between. Reset the cursor to
            // match the retained slice and mark it as having more to fetch.
            trimmed = {
                ...state,
                mediaItems: state.mediaItems.slice(0, this.MAX_SESSION_ITEMS),
                offset: this.MAX_SESSION_ITEMS,
                hasMore: true,
                scrollTop: 0
            };
        } else if (overCap && state.mediaItems.length > this.MAX_SESSION_ITEMS_HARD) {
            // Absolute ceiling so a very long browse still cannot grow without bound. Keep the
            // most recent items (the ones nearest the user's position) rather than the oldest,
            // and drop the scroll position honestly instead of pretending it still applies.
            trimmed = {
                ...state,
                mediaItems: state.mediaItems.slice(0, this.MAX_SESSION_ITEMS_HARD),
                offset: this.MAX_SESSION_ITEMS_HARD,
                hasMore: true,
                scrollTop: 0
            };
        }

        this.sessions.delete(sessionKey); // refresh recency
        if (this.sessions.size >= this.MAX_SESSIONS) {
            const oldestKey = this.sessions.keys().next().value;
            if (oldestKey !== undefined) this.sessions.delete(oldestKey);
        }
        this.sessions.set(sessionKey, trimmed);
    }

    /**
     * Retrieve active gallery viewing session state
     */
    /**
     * The session the user most recently had open, independent of which channel they are now
     * viewing. Lets "jump to message" restore the gallery exactly as it was, rather than
     * dropping them into the destination channel's (usually empty) session.
     */
    private static resumeSessionKey: string | null = null;

    /** Mark a session to be restored the next time the gallery opens. */
    public static markResumeSession(sessionKey: string): void {
        this.resumeSessionKey = sessionKey;
    }

    /**
     * Consume the pending resume target, if any. One-shot by design: jumping to a message and
     * reopening should return you to where you were, but closing the gallery normally and
     * browsing elsewhere should not resurrect a stale session later.
     */
    public static takeResumeSession(): string | null {
        const key = this.resumeSessionKey;
        this.resumeSessionKey = null;
        return key;
    }

    public static getSession(sessionKey: string): GallerySessionState | null {
        const session = this.sessions.get(sessionKey);
        if (!session) return null;

        // Refresh recency — the session the user is actively browsing should never be evicted.
        this.sessions.delete(sessionKey);
        this.sessions.set(sessionKey, session);
        return session;
    }

    /**
     * Deduplicate a list of media items based on unique media ID
     */
    public static deduplicateItems(existingItems: MediaItem[], newItems: MediaItem[]): MediaItem[] {
        const seenIds = new Set<string>();
        const result: MediaItem[] = [];

        for (const item of [...existingItems, ...newItems]) {
            const dedupeKey = item.id || `${item.messageId}:${item.url}`;
            if (seenIds.has(dedupeKey)) continue;
            seenIds.add(dedupeKey);
            result.push(item);
        }

        return result;
    }

    /**
     * Clear all cached entries or entries for a specific channel/guild
     */
    public static clear(targetId?: string): void {
        if (!targetId) {
            this.cache.clear();
        } else {
            for (const key of this.cache.keys()) {
                if (key.includes(targetId)) {
                    this.cache.delete(key);
                }
            }
        }
    }
}
