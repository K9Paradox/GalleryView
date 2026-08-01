import { MediaItem, SearchCacheEntry, SearchParameters } from "../types";

export interface GallerySessionState {
    mediaItems: MediaItem[];
    offset: number;
    totalResults: number;
    hasMore: boolean;
    scrollTop: number;
    filterType: "all" | "image" | "video" | "embed" | "file" | "audio";
    scope: "channel" | "guild";
    searchQuery: string;
    activeQuery: string;
    cardMinWidth?: string;
    selectedAuthors?: Array<{ id: string; name: string }>;
    selectedChannelIds?: string[];
}

export class CacheService {
    private static cache: Map<string, SearchCacheEntry> = new Map();
    private static sessions: Map<string, GallerySessionState> = new Map();
    private static DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes cache TTL

    /**
     * Generate a deterministic, fully unique cache key from search parameters
     */
    public static generateKey(params: SearchParameters): string {
        const target = params.channelId ? `channel:${params.channelId}` : `guild:${params.guildId || "global"}`;
        const channels = params.channelIds && params.channelIds.length > 0 
            ? `chans:${[...params.channelIds].sort().join(",")}` 
            : "all_chans";
        const query = (params.query || "").trim().toLowerCase();
        const filter = params.filterType || "all";
        const offset = params.offset || 0;
        const limit = params.limit || 25;
        const authors = params.authorIds && params.authorIds.length > 0 
            ? `authors:${[...params.authorIds].sort().join(",")}` 
            : (params.authorId ? `author:${params.authorId}` : "any_author");
        const before = params.beforeDate || "";
        const after = params.afterDate || "";

        return `${target}|${channels}|q:${query}|f:${filter}|a:${authors}|before:${before}|after:${after}|o:${offset}|l:${limit}`;
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

        return entry;
    }

    /**
     * Store search results into the cache
     */
    public static set(params: SearchParameters, items: MediaItem[], totalResults: number, hasMore: boolean, nextOffset?: number): void {
        const key = this.generateKey(params);
        this.cache.set(key, {
            timestamp: Date.now(),
            items,
            totalResults,
            hasMore,
            nextOffset: nextOffset ?? ((params.offset || 0) + items.length)
        });
    }

    /**
     * Save active gallery viewing session state (including scroll position and card size)
     */
    public static saveSession(sessionKey: string, state: GallerySessionState): void {
        this.sessions.set(sessionKey, state);
    }

    /**
     * Retrieve active gallery viewing session state
     */
    public static getSession(sessionKey: string): GallerySessionState | null {
        return this.sessions.get(sessionKey) || null;
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
