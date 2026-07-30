import { 
    ChannelStore, 
    GuildChannelStore,
    GuildMemberStore, 
    GuildStore, 
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

export const GalleryView: React.FC<GalleryViewProps> = ({ onClose, initialQuery = "" }) => {
    const { defaultCardSize } = settings.use(["defaultCardSize"]);
    const channelId = SelectedChannelStore?.getChannelId();
    const currentChannel = channelId ? ChannelStore?.getChannel(channelId) : null;
    const guildId = currentChannel?.guild_id || SelectedGuildStore?.getGuildId();
    const sessionKey = `${channelId || "nochan"}_${guildId || "noguild"}`;

    // Restore session state if available
    const existingSession = CacheService.getSession(sessionKey);

    const [mediaItems, setMediaItems] = useState<MediaItem[]>(existingSession?.mediaItems || []);
    const [loading, setLoading] = useState<boolean>(!existingSession);
    const [loadingMore, setLoadingMore] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [filterType, setFilterType] = useState<"all" | "image" | "video" | "embed" | "file" | "audio">(existingSession?.filterType || "all");
    const [searchQuery, setSearchQuery] = useState<string>(existingSession?.searchQuery || initialQuery);
    const [activeQuery, setActiveQuery] = useState<string>(existingSession?.activeQuery || initialQuery);
    const [offset, setOffset] = useState<number>(existingSession?.offset || 0);
    const [totalResults, setTotalResults] = useState<number>(existingSession?.totalResults || 0);
    const [hasMore, setHasMore] = useState<boolean>(existingSession?.hasMore ?? true);
    const [scope, setScope] = useState<"channel" | "guild">(existingSession?.scope || "channel");
    const [cardMinWidth, setCardMinWidth] = useState<string>(existingSession?.cardMinWidth || defaultCardSize || "240px");
    const [showScrollTop, setShowScrollTop] = useState<boolean>(false);

    // Multi-Author Search
    const [authorQuery, setAuthorQuery] = useState<string>("");
    const [selectedAuthors, setSelectedAuthors] = useState<AuthorPill[]>([]);
    
    // Multi-Channel Selector Popout
    const [showChannelDropdown, setShowChannelDropdown] = useState<boolean>(false);
    const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const observerTargetRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const isFirstMountRef = useRef<boolean>(true);

    // Retrieve all selectable text channels for the current guild via GuildChannelStore
    const guildChannels = React.useMemo(() => {
        if (!guildId || !GuildChannelStore) return [];
        try {
            const raw = GuildChannelStore.getChannels(guildId);
            const selectable = raw?.SELECTABLE || [];
            const vocal = raw?.VOCAL || [];
            return [...selectable, ...vocal]
                .map((c: any) => c.channel || c)
                .filter((c: any) => c && (c.type === 0 || c.type === 5));
        } catch {
            return [];
        }
    }, [guildId]);

    // Format top-left channel pill label (e.g. #general +2)
    const channelPillLabel = React.useMemo(() => {
        if (selectedChannelIds.length > 0) {
            const firstChan = guildChannels.find(c => c.id === selectedChannelIds[0]);
            const firstName = firstChan?.name || "channel";
            if (selectedChannelIds.length > 1) {
                return `#${firstName} +${selectedChannelIds.length - 1}`;
            }
            return `#${firstName}`;
        }
        if (scope === "guild") {
            return "Entire Server";
        }
        return `#${currentChannel?.name || "Channel"}`;
    }, [selectedChannelIds, guildChannels, currentChannel, scope]);

    // Member autocomplete options for multi-author search
    const authorSuggestions = React.useMemo(() => {
        if (!authorQuery.trim() || !guildId || !GuildMemberStore) return [];
        try {
            const q = authorQuery.toLowerCase();
            const members = GuildMemberStore.getMembers(guildId) || [];
            return members
                .filter((m: any) => {
                    const user = UserStore?.getUser(m.userId);
                    return user && (user.username.toLowerCase().includes(q) || (user.globalName && user.globalName.toLowerCase().includes(q)));
                })
                .slice(0, 8)
                .map((m: any) => UserStore?.getUser(m.userId))
                .filter(Boolean);
        } catch {
            return [];
        }
    }, [authorQuery, guildId]);

    // Keyboard Shortcuts: Esc to close gallery
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (onClose) onClose();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    // Save current scroll position & session
    const saveCurrentSession = () => {
        if (!scrollContainerRef.current) return;
        const currentScroll = scrollContainerRef.current.scrollTop;
        setShowScrollTop(currentScroll > 400);

        const state: GallerySessionState = {
            mediaItems,
            offset,
            totalResults,
            hasMore,
            scrollTop: currentScroll,
            filterType,
            scope,
            searchQuery,
            activeQuery,
            cardMinWidth
        };
        CacheService.saveSession(sessionKey, state);
    };

    // Scroll to top handler
    const scrollToTop = () => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTo({ top: 0, behavior: "smooth" });
        }
    };

    // Restore scroll position when session exists
    useEffect(() => {
        if (existingSession && scrollContainerRef.current && mediaItems.length > 0) {
            scrollContainerRef.current.scrollTop = existingSession.scrollTop;
        }
    }, [mediaItems.length]);

    // Save session on unmount
    useEffect(() => {
        return () => {
            saveCurrentSession();
        };
    }, [mediaItems, offset, totalResults, hasMore, filterType, scope, searchQuery, activeQuery, cardMinWidth]);

    // Fetch routine trigger on filter/query/author/channel changes
    useEffect(() => {
        // Skip re-fetching on initial mount if session cache exists
        if (isFirstMountRef.current) {
            isFirstMountRef.current = false;
            if (existingSession && mediaItems.length > 0) {
                return;
            }
        }

        setOffset(0);
        setMediaItems([]);
        setHasMore(true);
        fetchMedia(0, filterType, activeQuery, true);
    }, [channelId, guildId, filterType, activeQuery, scope, selectedAuthors, selectedChannelIds]);

    // IntersectionObserver for Instant Infinite Scroll pagination
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (
                    entries[0].isIntersecting && 
                    hasMore && 
                    !loading && 
                    !loadingMore && 
                    !error
                ) {
                    loadNextPage();
                }
            },
            { threshold: 0.1, root: scrollContainerRef.current }
        );

        if (observerTargetRef.current) {
            observer.observe(observerTargetRef.current);
        }

        return () => observer.disconnect();
    }, [hasMore, loading, loadingMore, offset, filterType, activeQuery, error]);

    // Main fetch routine
    const fetchMedia = async (
        fetchOffset: number,
        filter: "all" | "image" | "video" | "embed" | "file" | "audio",
        query: string,
        isReset = false
    ) => {
        const activeChannelId = SelectedChannelStore?.getChannelId();
        const activeChannel = activeChannelId ? ChannelStore?.getChannel(activeChannelId) : null;
        const activeGuildId = activeChannel?.guild_id || SelectedGuildStore?.getGuildId();

        if (!activeChannelId && !activeGuildId) {
            setError("No active channel or server detected.");
            return;
        }

        if (isReset) {
            setLoading(true);
        } else {
            setLoadingMore(true);
        }
        setError(null);

        const params: SearchParameters = {
            channelId: scope === "channel" ? activeChannelId : undefined,
            guildId: activeGuildId,
            channelIds: selectedChannelIds.length > 0 ? selectedChannelIds : undefined,
            filterType: filter,
            query,
            authorIds: selectedAuthors.length > 0 ? selectedAuthors.map(a => a.id) : undefined,
            offset: fetchOffset
        };

        try {
            const res = await SearchService.searchMedia(params);
            
            let updatedItems: MediaItem[];
            if (isReset) {
                updatedItems = res.items;
            } else {
                updatedItems = CacheService.deduplicateItems(mediaItems, res.items);
            }

            setMediaItems(updatedItems);
            setTotalResults(res.totalResults);
            setHasMore(res.hasMore);
            setOffset(fetchOffset);

            CacheService.saveSession(sessionKey, {
                mediaItems: updatedItems,
                offset: fetchOffset,
                totalResults: res.totalResults,
                hasMore: res.hasMore,
                scrollTop: scrollContainerRef.current?.scrollTop || 0,
                filterType: filter,
                scope,
                searchQuery,
                activeQuery: query,
                cardMinWidth
            });
        } catch (err: any) {
            console.error("[GalleryMode] Fetch error:", err);
            if (err?.status === 429 || err?.retryAfter) {
                setError(`Rate limited by Discord API. Resuming requests automatically shortly...`);
            } else {
                setError("Failed to fetch gallery media from Discord Search API.");
            }
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    };

    const loadNextPage = () => {
        const nextOffset = offset + 25;
        fetchMedia(nextOffset, filterType, activeQuery, false);
    };

    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setActiveQuery(searchQuery);
    };

    const toggleChannelSelection = (id: string) => {
        const updated = selectedChannelIds.includes(id) 
            ? selectedChannelIds.filter(c => c !== id)
            : [...selectedChannelIds, id];
        
        setSelectedChannelIds(updated);
    };

    const addAuthorPill = (user: any) => {
        const pill: AuthorPill = {
            id: user.id,
            name: user.globalName || user.username
        };
        if (!selectedAuthors.some(a => a.id === user.id)) {
            setSelectedAuthors([...selectedAuthors, pill]);
        }
        setAuthorQuery("");
    };

    const removeAuthorPill = (id: string) => {
        setSelectedAuthors(selectedAuthors.filter(a => a.id !== id));
    };

    const rateLimitState = SearchService.getRateLimitState();

    const viewContent = (
        <div className="gm-gallery-overlay-container">
            {/* Header / Filter Toolbar */}
            <div className="gm-gallery-header">
                {/* Row 1: Title, Scope, Multi-Channel, Filter Tabs, Density, Close */}
                <div className="gm-header-row">
                    <div className="gm-header-left">
                        <h2 className="gm-plugin-title">
                            <svg width="22" height="24" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM5 15l3.5-4.5 2.5 3.01L14.5 9l4.5 6H5z"/>
                            </svg>
                            Gallery Mode
                        </h2>
                        <span className="gm-channel-pill">
                            {channelPillLabel}
                        </span>
                        {mediaItems.length > 0 && (
                            <span className="gm-count-badge">
                                ({mediaItems.length.toLocaleString()} loaded{totalResults > mediaItems.length ? ` of ${totalResults.toLocaleString()}` : ""})
                            </span>
                        )}
                    </div>

                    {/* Scope Switcher & Multi-Channel Dropdown */}
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", position: "relative" }}>
                        <div className="gm-scope-toggle">
                            <button
                                className={`gm-scope-btn ${scope === "channel" ? "active" : ""}`}
                                onClick={() => {
                                    setScope("channel");
                                    setSelectedChannelIds([]);
                                }}
                            >
                                This Channel
                            </button>
                            {guildId && (
                                <button
                                    className={`gm-scope-btn ${scope === "guild" ? "active" : ""}`}
                                    onClick={() => setScope("guild")}
                                >
                                    Entire Server
                                </button>
                            )}
                        </div>

                        {/* Multi-Channel Select Popout Button */}
                        {guildId && scope === "guild" && (
                            <button 
                                className="gm-scope-btn"
                                style={{
                                    background: selectedChannelIds.length > 0 ? "var(--brand-experiment)" : "rgba(0,0,0,0.5)",
                                    border: "1px solid rgba(255,255,255,0.2)",
                                    color: "#fff"
                                }}
                                onClick={() => setShowChannelDropdown(!showChannelDropdown)}
                            >
                                # {selectedChannelIds.length > 0 ? `${selectedChannelIds.length} Channels` : "Select Channels"} ▼
                            </button>
                        )}

                        {/* Floating Multi-Channel Popout */}
                        {showChannelDropdown && (
                            <div style={{
                                position: "absolute",
                                top: "42px",
                                left: 0,
                                width: "260px",
                                maxHeight: "300px",
                                overflowY: "auto",
                                background: "#111214",
                                border: "1px solid rgba(255,255,255,0.2)",
                                borderRadius: "10px",
                                padding: "10px",
                                zIndex: 1200,
                                boxShadow: "0 12px 32px rgba(0,0,0,0.8)"
                            }}>
                                <div style={{ fontSize: "12px", fontWeight: 700, color: "#fff", marginBottom: "8px" }}>
                                    Select Channels ({guildChannels.length} available):
                                </div>
                                {guildChannels.length === 0 ? (
                                    <div style={{ fontSize: "12px", color: "#949ba4", padding: "8px" }}>
                                        No text channels found in server.
                                    </div>
                                ) : (
                                    guildChannels.map((ch: any) => (
                                        <label
                                            key={ch.id}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "8px",
                                                padding: "6px 8px",
                                                cursor: "pointer",
                                                color: "#fff",
                                                fontSize: "13px",
                                                borderRadius: "4px"
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedChannelIds.includes(ch.id)}
                                                onChange={() => toggleChannelSelection(ch.id)}
                                            />
                                            <span>#{ch.name}</span>
                                        </label>
                                    ))
                                )}
                            </div>
                        )}
                    </div>

                    {/* Filter Tabs */}
                    <div className="gm-filter-tabs">
                        {(["all", "image", "video", "embed", "file", "audio"] as const).map(tab => (
                            <button
                                key={tab}
                                className={`gm-tab-btn ${filterType === tab ? "active" : ""}`}
                                onClick={() => setFilterType(tab)}
                            >
                                {tab.toUpperCase()}
                            </button>
                        ))}
                    </div>

                    {/* Grid Density / Card Size Switcher */}
                    <div className="gm-scope-toggle" title="Adjust Card Grid Density">
                        {[
                            { label: "S", value: "180px", title: "Compact Grid (~180px)" },
                            { label: "M", value: "240px", title: "Standard Grid (~240px)" },
                            { label: "L", value: "320px", title: "Large Grid (~320px)" },
                            { label: "XL", value: "420px", title: "Showcase Grid (~420px)" }
                        ].map(size => (
                            <button
                                key={size.value}
                                className={`gm-scope-btn ${cardMinWidth === size.value ? "active" : ""}`}
                                title={size.title}
                                onClick={() => setCardMinWidth(size.value)}
                            >
                                {size.label}
                            </button>
                        ))}
                    </div>

                    {onClose && (
                        <button className="gm-close-btn" onClick={onClose} title="Exit Gallery Mode (Esc)">
                            ✕
                        </button>
                    )}
                </div>

                {/* Row 2: Multi-Author Search & Keyword Search Bar */}
                <div className="gm-header-row">
                    {/* Multi-Author Search & Pills */}
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", position: "relative" }}>
                        {selectedAuthors.map((author) => (
                            <span 
                                key={author.id}
                                className="gm-channel-pill" 
                                style={{ background: "var(--brand-experiment)", cursor: "pointer" }}
                                onClick={() => removeAuthorPill(author.id)}
                                title="Click to remove author"
                            >
                                👤 {author.name} ✕
                            </span>
                        ))}

                        <div style={{ position: "relative" }}>
                            <input
                                type="text"
                                className="gm-search-input"
                                placeholder="Add Author @name..."
                                value={authorQuery}
                                onChange={(e) => setAuthorQuery(e.target.value)}
                                style={{ width: "200px" }}
                            />

                            {authorSuggestions.length > 0 && (
                                <div style={{
                                    position: "absolute",
                                    top: "42px",
                                    left: 0,
                                    width: "240px",
                                    background: "#111214",
                                    border: "1px solid rgba(255,255,255,0.2)",
                                    borderRadius: "8px",
                                    zIndex: 1100,
                                    maxHeight: "220px",
                                    overflowY: "auto",
                                    boxShadow: "0 8px 24px rgba(0,0,0,0.8)"
                                }}>
                                    {authorSuggestions.map((u: any) => (
                                        <div
                                            key={u.id}
                                            style={{
                                                padding: "8px 12px",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "8px",
                                                cursor: "pointer",
                                                color: "#fff",
                                                fontSize: "13px",
                                                borderBottom: "1px solid rgba(255,255,255,0.05)"
                                            }}
                                            onClick={() => addAuthorPill(u)}
                                        >
                                            <span style={{ fontWeight: 700 }}>{u.globalName || u.username}</span>
                                            <span style={{ fontSize: "11px", color: "#dbdee1" }}>@{u.username}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Search Form */}
                    <form className="gm-search-form" onSubmit={handleSearchSubmit}>
                        <input
                            ref={searchInputRef}
                            type="text"
                            className="gm-search-input"
                            placeholder="Search keywords..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        <button type="submit" className="gm-search-submit-btn">
                            Search
                        </button>
                    </form>
                </div>
            </div>

            {/* Rate Limit Warning Banner */}
            {rateLimitState.isRateLimited && (
                <div style={{ background: "var(--status-danger)", color: "#ffffff", padding: "8px 16px", textAlign: "center", fontSize: "12px", fontWeight: "600" }}>
                    ⚠️ Discord Search API Rate Limited. Resuming requests automatically in {Math.ceil(rateLimitState.retryAfterMs / 1000)}s...
                </div>
            )}

            {/* Media Content Area */}
            <div className="gm-gallery-content" ref={scrollContainerRef} onScroll={saveCurrentSession}>
                {loading && (
                    <div className="gm-loading-state">
                        <div className="gm-spinner-icon" style={{ width: "36px", height: "36px" }} />
                        <p style={{ marginTop: "12px" }}>Querying Discord Server Search Index...</p>
                    </div>
                )}

                {error && !loading && (
                    <div className="gm-error-state">
                        <p>{error}</p>
                        <button 
                            style={{ marginTop: "12px", padding: "8px 16px", borderRadius: "6px", background: "var(--brand-experiment)", color: "#fff", border: "none", cursor: "pointer" }}
                            onClick={() => fetchMedia(0, filterType, activeQuery, true)}
                        >
                            Retry Query
                        </button>
                    </div>
                )}

                {!loading && !error && mediaItems.length === 0 && (
                    <div className="gm-empty-state">
                        <span style={{ fontSize: "32px" }}>🖼️</span>
                        <div className="gm-empty-title">No Media Found</div>
                        <p>No media matching your current filter or keyword query was found in this {scope}.</p>
                    </div>
                )}

                {!loading && mediaItems.length > 0 && (
                    <div className="gm-media-grid" style={{ "--gm-card-min-width": cardMinWidth } as React.CSSProperties}>
                        {mediaItems.map((item) => (
                            <MediaCard 
                                key={item.id} 
                                item={item} 
                                onCloseGallery={onClose}
                            />
                        ))}
                    </div>
                )}

                {/* Infinite Scroll Bottom Sentinel */}
                <div ref={observerTargetRef}>
                    {loadingMore && (
                        <div className="gm-infinite-spinner-wrapper">
                            <div className="gm-spinner-icon" />
                            <span>Loading more media...</span>
                        </div>
                    )}
                </div>

                {/* Floating Back to Top Button */}
                {showScrollTop && (
                    <button 
                        onClick={scrollToTop}
                        style={{
                            position: "fixed",
                            bottom: "32px",
                            right: "32px",
                            width: "48px",
                            height: "48px",
                            borderRadius: "50%",
                            background: "var(--brand-experiment)",
                            color: "#ffffff",
                            border: "none",
                            boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                            fontSize: "20px",
                            cursor: "pointer",
                            zIndex: 1300,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center"
                        }}
                        title="Back to Top"
                    >
                        ↑
                    </button>
                )}
            </div>
        </div>
    );

    // Render directly onto document.body using Portal
    return ReactDOM.createPortal(viewContent, document.body);
};
