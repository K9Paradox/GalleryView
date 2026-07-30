import {
    ChannelStore,
    GuildChannelStore,
    GuildMemberStore,
    React,
    ReactDOM,
    SelectedChannelStore,
    SelectedGuildStore,
    UserStore,
    useEffect,
    useRef,
    useState
} from "@webpack/common";
import { settings } from "../index";
import { CacheService, GallerySessionState } from "../services/cacheService";
import { SearchService } from "../services/searchService";
import { MediaItem, SearchParameters } from "../types";
import { MediaCard } from "./MediaCard";

interface GalleryViewProps {
    onClose?: () => void;
    initialQuery?: string;
}

interface AuthorPill {
    id: string;
    name: string;
}

type FilterType = "all" | "image" | "video" | "embed" | "file" | "audio";
type ScopeType = "channel" | "guild";

const PAGE_SIZE = 25;

function normaliseGuildChannels(raw: any): any[] {
    const buckets = [raw?.SELECTABLE, raw?.VOCAL, raw?.TEXTUAL, raw?.THREADS].filter(Boolean);
    const channels = buckets.flatMap(bucket => Array.isArray(bucket) ? bucket : Object.values(bucket));

    return channels
        .map((entry: any) => entry?.channel || entry)
        .filter((channel: any) => channel && (channel.type === 0 || channel.type === 5 || channel.type === 15))
        .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
}

export const GalleryView: React.FC<GalleryViewProps> = ({ onClose, initialQuery = "" }) => {
    const { defaultCardSize } = settings.use(["defaultCardSize"]);
    const channelId = SelectedChannelStore?.getChannelId();
    const currentChannel = channelId ? ChannelStore?.getChannel(channelId) : null;
    const guildId = currentChannel?.guild_id || SelectedGuildStore?.getGuildId();
    const sessionKey = `${channelId || "nochan"}_${guildId || "noguild"}`;
    const existingSession = CacheService.getSession(sessionKey);

    const [mediaItems, setMediaItems] = useState<MediaItem[]>(existingSession?.mediaItems || []);
    const [loading, setLoading] = useState<boolean>(!existingSession || existingSession.mediaItems.length === 0);
    const [loadingMore, setLoadingMore] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [filterType, setFilterType] = useState<FilterType>(existingSession?.filterType || "all");
    const [searchQuery, setSearchQuery] = useState<string>(existingSession?.searchQuery || initialQuery);
    const [activeQuery, setActiveQuery] = useState<string>(existingSession?.activeQuery || initialQuery);
    const [offset, setOffset] = useState<number>(existingSession?.offset || 0);
    const [totalResults, setTotalResults] = useState<number>(existingSession?.totalResults || 0);
    const [hasMore, setHasMore] = useState<boolean>(existingSession?.hasMore ?? true);
    const [scope, setScope] = useState<ScopeType>(existingSession?.scope || "channel");
    const [cardMinWidth, setCardMinWidth] = useState<string>(existingSession?.cardMinWidth || defaultCardSize || "240px");
    const [showScrollTop, setShowScrollTop] = useState<boolean>((existingSession?.scrollTop || 0) > 400);
    const [authorQuery, setAuthorQuery] = useState<string>("");
    const [selectedAuthors, setSelectedAuthors] = useState<AuthorPill[]>(existingSession?.selectedAuthors || []);
    const [showChannelDropdown, setShowChannelDropdown] = useState<boolean>(false);
    const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>(existingSession?.selectedChannelIds || []);
    const [rateLimitTick, setRateLimitTick] = useState<number>(0);

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const observerTargetRef = useRef<HTMLDivElement>(null);
    const isFirstMountRef = useRef<boolean>(true);
    const latestRequestRef = useRef<number>(0);
    const fetchingRef = useRef<boolean>(false);
    const mediaItemsRef = useRef<MediaItem[]>(mediaItems);

    mediaItemsRef.current = mediaItems;

    const guildChannels = React.useMemo(() => {
        if (!guildId || !GuildChannelStore) return [];
        try {
            return normaliseGuildChannels(GuildChannelStore.getChannels(guildId));
        } catch (err) {
            console.warn("[GalleryMode] Failed to read guild channel list", err);
            return [];
        }
    }, [guildId]);

    const channelPillLabel = React.useMemo(() => {
        if (selectedChannelIds.length > 0) {
            const firstChan = guildChannels.find((c: any) => c.id === selectedChannelIds[0]);
            const firstName = firstChan?.name || "channel";
            return selectedChannelIds.length > 1 ? `#${firstName} +${selectedChannelIds.length - 1}` : `#${firstName}`;
        }
        if (scope === "guild") return "Entire Server";
        return `#${currentChannel?.name || "Channel"}`;
    }, [selectedChannelIds, guildChannels, currentChannel, scope]);

    const authorSuggestions = React.useMemo(() => {
        if (!authorQuery.trim() || !guildId || !GuildMemberStore || !UserStore) return [];
        try {
            const q = authorQuery.trim().replace(/^@/, "").toLowerCase();
            const rawMembers = GuildMemberStore.getMembers(guildId) || [];
            const members = Array.isArray(rawMembers) ? rawMembers : Object.values(rawMembers);

            return members
                .map((m: any) => UserStore.getUser(m.userId || m.user_id || m.id))
                .filter((user: any) => user && !selectedAuthors.some(a => a.id === user.id))
                .filter((user: any) => {
                    const username = user.username?.toLowerCase() || "";
                    const globalName = (user.globalName || user.global_name || "").toLowerCase();
                    return username.includes(q) || globalName.includes(q) || user.id === q;
                })
                .slice(0, 8);
        } catch {
            return [];
        }
    }, [authorQuery, guildId, selectedAuthors]);

    const saveSession = (scrollTop = scrollContainerRef.current?.scrollTop || 0) => {
        const state: GallerySessionState = {
            mediaItems: mediaItemsRef.current,
            offset,
            totalResults,
            hasMore,
            scrollTop,
            filterType,
            scope,
            searchQuery,
            activeQuery,
            cardMinWidth,
            selectedAuthors,
            selectedChannelIds
        };
        CacheService.saveSession(sessionKey, state);
    };

    const fetchMedia = async (
        fetchOffset: number,
        filter: FilterType,
        query: string,
        isReset = false
    ) => {
        if (fetchingRef.current && !isReset) return;

        const requestId = ++latestRequestRef.current;
        fetchingRef.current = true;

        const activeChannelId = SelectedChannelStore?.getChannelId();
        const activeChannel = activeChannelId ? ChannelStore?.getChannel(activeChannelId) : null;
        const activeGuildId = activeChannel?.guild_id || SelectedGuildStore?.getGuildId();

        if (!activeChannelId && !activeGuildId) {
            setError("No active channel or server detected.");
            setLoading(false);
            setLoadingMore(false);
            fetchingRef.current = false;
            return;
        }

        if (isReset) {
            setLoading(true);
            setLoadingMore(false);
        } else {
            setLoadingMore(true);
        }
        setError(null);

        const params: SearchParameters = {
            channelId: scope === "channel" ? activeChannelId : undefined,
            guildId: activeGuildId,
            channelIds: scope === "guild" && selectedChannelIds.length > 0 ? selectedChannelIds : undefined,
            filterType: filter,
            query,
            authorIds: selectedAuthors.length > 0 ? selectedAuthors.map(a => a.id) : undefined,
            offset: fetchOffset,
            limit: PAGE_SIZE
        };

        try {
            const res = await SearchService.searchMedia(params);
            if (requestId !== latestRequestRef.current) return;

            const updatedItems = isReset ? res.items : CacheService.deduplicateItems(mediaItemsRef.current, res.items);
            mediaItemsRef.current = updatedItems;
            setMediaItems(updatedItems);
            setTotalResults(res.totalResults);
            setHasMore(res.hasMore);
            setOffset(fetchOffset);

            if (isReset) {
                scrollContainerRef.current?.scrollTo({ top: 0 });
            }

            CacheService.saveSession(sessionKey, {
                mediaItems: updatedItems,
                offset: fetchOffset,
                totalResults: res.totalResults,
                hasMore: res.hasMore,
                scrollTop: isReset ? 0 : scrollContainerRef.current?.scrollTop || 0,
                filterType: filter,
                scope,
                searchQuery,
                activeQuery: query,
                cardMinWidth,
                selectedAuthors,
                selectedChannelIds
            });
        } catch (err: any) {
            if (requestId !== latestRequestRef.current) return;
            console.error("[GalleryMode] Fetch error:", err);
            if (err?.status === 429 || err?.body?.retry_after || err?.retry_after) {
                setError("Discord Search is rate limited right now. Wait a few seconds, then retry.");
            } else if (err?.status === 403) {
                setError("Discord denied access to search this channel/server. Check your permissions.");
            } else {
                setError(err?.message || "Failed to fetch gallery media from Discord Search.");
            }
        } finally {
            if (requestId === latestRequestRef.current) {
                setLoading(false);
                setLoadingMore(false);
                fetchingRef.current = false;
            }
        }
    };

    const loadNextPage = () => {
        if (!hasMore || loading || loadingMore || fetchingRef.current || error) return;
        void fetchMedia(offset + PAGE_SIZE, filterType, activeQuery, false);
    };

    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setActiveQuery(searchQuery.trim());
    };

    const toggleChannelSelection = (id: string) => {
        setSelectedChannelIds(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
    };

    const addAuthorPill = (user: any) => {
        const pill: AuthorPill = { id: user.id, name: user.globalName || user.global_name || user.username };
        setSelectedAuthors(prev => prev.some(a => a.id === user.id) ? prev : [...prev, pill]);
        setAuthorQuery("");
    };

    const removeAuthorPill = (id: string) => {
        setSelectedAuthors(prev => prev.filter(a => a.id !== id));
    };

    const clearFilters = () => {
        setFilterType("all");
        setSearchQuery("");
        setActiveQuery("");
        setSelectedAuthors([]);
        setSelectedChannelIds([]);
        setShowChannelDropdown(false);
    };

    const handleScroll = () => {
        const scrollTop = scrollContainerRef.current?.scrollTop || 0;
        setShowScrollTop(scrollTop > 400);
        saveSession(scrollTop);
    };

    const scrollToTop = () => {
        scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    };

    useEffect(() => {
        const interval = setInterval(() => setRateLimitTick(t => t + 1), 1000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            if (showChannelDropdown) {
                setShowChannelDropdown(false);
                return;
            }
            onClose?.();
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose, showChannelDropdown]);

    useEffect(() => {
        if (existingSession && scrollContainerRef.current && mediaItems.length > 0) {
            requestAnimationFrame(() => {
                if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = existingSession.scrollTop;
            });
        }
        // Restore only once per mount; repeated restoration fights normal scrolling.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        return () => saveSession(scrollContainerRef.current?.scrollTop || 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mediaItems, offset, totalResults, hasMore, filterType, scope, searchQuery, activeQuery, cardMinWidth, selectedAuthors, selectedChannelIds]);

    useEffect(() => {
        if (isFirstMountRef.current) {
            isFirstMountRef.current = false;
            if (existingSession && mediaItems.length > 0) return;
        }

        latestRequestRef.current++;
        fetchingRef.current = false;
        setOffset(0);
        setMediaItems([]);
        mediaItemsRef.current = [];
        setHasMore(true);
        setTotalResults(0);
        void fetchMedia(0, filterType, activeQuery, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [channelId, guildId, filterType, activeQuery, scope, selectedAuthors, selectedChannelIds]);

    useEffect(() => {
        const target = observerTargetRef.current;
        const root = scrollContainerRef.current;
        if (!target || !root || typeof IntersectionObserver === "undefined") return;

        const observer = new IntersectionObserver(
            entries => {
                if (entries[0]?.isIntersecting) loadNextPage();
            },
            { threshold: 0.1, root, rootMargin: "500px" }
        );

        observer.observe(target);
        return () => observer.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasMore, loading, loadingMore, offset, filterType, activeQuery, error, mediaItems.length]);

    const rateLimitState = SearchService.getRateLimitState();
    const retrySeconds = rateLimitState.isRateLimited ? Math.max(1, Math.ceil((rateLimitState.resetTimestamp - Date.now()) / 1000)) : 0;
    void rateLimitTick;

    const viewContent = (
        <div className="gm-gallery-overlay-container">
            <div className="gm-gallery-header">
                <div className="gm-header-row">
                    <div className="gm-header-left">
                        <h2 className="gm-plugin-title">
                            <svg width="22" height="24" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM5 15l3.5-4.5 2.5 3.01L14.5 9l4.5 6H5z" />
                            </svg>
                            Gallery Mode
                        </h2>
                        <span className="gm-channel-pill">{channelPillLabel}</span>
                        {mediaItems.length > 0 && (
                            <span className="gm-count-badge">
                                {mediaItems.length.toLocaleString()} loaded{totalResults > mediaItems.length ? ` of ${totalResults.toLocaleString()}` : ""}
                            </span>
                        )}
                    </div>

                    <div className="gm-header-controls">
                        <div className="gm-scope-toggle">
                            <button
                                className={`gm-scope-btn ${scope === "channel" ? "active" : ""}`}
                                onClick={() => {
                                    setScope("channel");
                                    setSelectedChannelIds([]);
                                    setShowChannelDropdown(false);
                                }}
                            >
                                This Channel
                            </button>
                            {guildId && (
                                <button className={`gm-scope-btn ${scope === "guild" ? "active" : ""}`} onClick={() => setScope("guild")}>
                                    Entire Server
                                </button>
                            )}
                        </div>

                        {guildId && scope === "guild" && (
                            <div className="gm-channel-select-wrap">
                                <button
                                    className={`gm-scope-btn gm-channel-select-btn ${selectedChannelIds.length > 0 ? "active" : ""}`}
                                    onClick={() => setShowChannelDropdown(v => !v)}
                                >
                                    # {selectedChannelIds.length > 0 ? `${selectedChannelIds.length} Channels` : "Select Channels"} ▼
                                </button>
                                {showChannelDropdown && (
                                    <div className="gm-channel-dropdown">
                                        <div className="gm-dropdown-title">Select Channels ({guildChannels.length} available)</div>
                                        {selectedChannelIds.length > 0 && (
                                            <button className="gm-dropdown-link" onClick={() => setSelectedChannelIds([])}>Clear selected channels</button>
                                        )}
                                        {guildChannels.length === 0 ? (
                                            <div className="gm-dropdown-empty">No text channels found in this server.</div>
                                        ) : guildChannels.map((ch: any) => (
                                            <label key={ch.id} className="gm-channel-option">
                                                <input type="checkbox" checked={selectedChannelIds.includes(ch.id)} onChange={() => toggleChannelSelection(ch.id)} />
                                                <span>#{ch.name}</span>
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="gm-filter-tabs">
                        {(["all", "image", "video", "embed", "file", "audio"] as const).map(tab => (
                            <button key={tab} className={`gm-tab-btn ${filterType === tab ? "active" : ""}`} onClick={() => setFilterType(tab)}>
                                {tab.toUpperCase()}
                            </button>
                        ))}
                    </div>

                    <div className="gm-scope-toggle" title="Adjust Card Grid Density">
                        {[
                            { label: "S", value: "180px", title: "Compact Grid" },
                            { label: "M", value: "240px", title: "Standard Grid" },
                            { label: "L", value: "320px", title: "Large Grid" },
                            { label: "XL", value: "420px", title: "Showcase Grid" }
                        ].map(size => (
                            <button key={size.value} className={`gm-scope-btn ${cardMinWidth === size.value ? "active" : ""}`} title={size.title} onClick={() => setCardMinWidth(size.value)}>
                                {size.label}
                            </button>
                        ))}
                    </div>

                    <button className="gm-scope-btn" onClick={clearFilters} title="Clear search/filter/author/channel selections">Reset</button>

                    {onClose && <button className="gm-close-btn" onClick={onClose} title="Exit Gallery Mode (Esc)">✕</button>}
                </div>

                <div className="gm-header-row gm-header-row-search">
                    <div className="gm-author-search-wrap">
                        {selectedAuthors.map(author => (
                            <span key={author.id} className="gm-channel-pill gm-author-pill" onClick={() => removeAuthorPill(author.id)} title="Click to remove author">
                                👤 {author.name} ✕
                            </span>
                        ))}

                        <div className="gm-author-input-wrap">
                            <input
                                type="text"
                                className="gm-search-input gm-author-input"
                                placeholder="Add author @name..."
                                value={authorQuery}
                                onChange={(e) => setAuthorQuery(e.currentTarget.value)}
                            />

                            {authorSuggestions.length > 0 && (
                                <div className="gm-author-suggestions">
                                    {authorSuggestions.map((u: any) => (
                                        <button key={u.id} className="gm-author-suggestion" onClick={() => addAuthorPill(u)}>
                                            <span>{u.globalName || u.global_name || u.username}</span>
                                            <small>@{u.username}</small>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <form className="gm-search-form" onSubmit={handleSearchSubmit}>
                        <input
                            type="text"
                            className="gm-search-input"
                            placeholder="Search keywords..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.currentTarget.value)}
                        />
                        {searchQuery && (
                            <button type="button" className="gm-search-clear-btn" onClick={() => { setSearchQuery(""); setActiveQuery(""); }}>×</button>
                        )}
                        <button type="submit" className="gm-search-submit-btn">Search</button>
                    </form>
                </div>
            </div>

            {rateLimitState.isRateLimited && (
                <div className="gm-rate-limit-banner">
                    ⚠️ Discord Search is throttling requests. Retrying in {retrySeconds}s…
                </div>
            )}

            <div className="gm-gallery-content" ref={scrollContainerRef} onScroll={handleScroll}>
                {loading && (
                    <div className="gm-loading-state">
                        <div className="gm-spinner-icon gm-spinner-large" />
                        <p>Querying Discord Search…</p>
                    </div>
                )}

                {error && !loading && (
                    <div className="gm-error-state">
                        <div className="gm-empty-title">Couldn’t load media</div>
                        <p>{error}</p>
                        <button className="gm-action-btn primary" onClick={() => fetchMedia(0, filterType, activeQuery, true)}>Retry Query</button>
                    </div>
                )}

                {!loading && !error && mediaItems.length === 0 && (
                    <div className="gm-empty-state">
                        <span className="gm-empty-icon">🖼️</span>
                        <div className="gm-empty-title">No Media Found</div>
                        <p>No media matching your current filters was found in this {scope === "guild" ? "server" : "channel"}.</p>
                        <button className="gm-action-btn secondary" onClick={clearFilters}>Clear Filters</button>
                    </div>
                )}

                {!loading && mediaItems.length > 0 && (
                    <div className="gm-media-grid" style={{ "--gm-card-min-width": cardMinWidth } as React.CSSProperties}>
                        {mediaItems.map(item => <MediaCard key={item.id} item={item} onCloseGallery={onClose} />)}
                    </div>
                )}

                <div ref={observerTargetRef} className="gm-scroll-sentinel">
                    {loadingMore && (
                        <div className="gm-infinite-spinner-wrapper">
                            <div className="gm-spinner-icon" />
                            <span>Loading more media…</span>
                        </div>
                    )}
                    {!loading && !loadingMore && !error && mediaItems.length > 0 && hasMore && (
                        <button className="gm-load-more-btn" onClick={loadNextPage}>Load More</button>
                    )}
                    {!loading && !loadingMore && !hasMore && mediaItems.length > 0 && (
                        <div className="gm-end-state">End of results</div>
                    )}
                </div>

                {showScrollTop && <button onClick={scrollToTop} className="gm-scroll-top-btn" title="Back to Top">↑</button>}
            </div>
        </div>
    );

    return ReactDOM.createPortal(viewContent, document.body);
};
