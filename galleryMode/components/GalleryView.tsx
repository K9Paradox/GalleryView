import {
    ActiveJoinedThreadsStore,
    ChannelStore,
    GuildChannelStore,
    GuildMemberStore,
    React,
    ReactDOM,
    SelectedChannelStore,
    SelectedGuildStore,
    SettingsRouter,
    UserStore,
    useStateFromStores,
    useEffect,
    useRef,
    useState
} from "@webpack/common";
import { settings } from "../settings";
import { useThemeTone } from "../useThemeTone";
import { CacheService, GallerySessionState } from "../services/cacheService";
import { SearchService } from "../services/searchService";
import { GallerySortOrder, MediaItem, SearchParameters } from "../types";
import { MediaCard } from "./MediaCard";
import { MasonryGrid } from "./MasonryGrid";
import { SkeletonGrid } from "./SkeletonCard";

interface GalleryViewProps {
    onClose?: () => void;
    initialQuery?: string;
}

interface AuthorPill {
    id: string;
    name: string;
}

type FilterType = "all" | "image" | "video" | "embed" | "file" | "audio";
// "channel" = the current channel (or the current thread when one is open)
// "parent"  = every thread/post under the current thread's parent channel
// "guild"   = the whole server
type ScopeType = "channel" | "parent" | "guild";

const PAGE_SIZE = 25;
// Minimum gap between two *automatic* (scroll-triggered) page loads. Manual "Load More"
// clicks bypass this.
const AUTO_LOAD_COOLDOWN_MS = 700;
// Extra spacing enforced between auto-loads that were NOT driven by the user actively
// scrolling. Guards against the trigger paths (observer, scroll handler, post-load re-check,
// deferred retry) re-arming each other into a free-running pagination loop.
const IDLE_AUTO_LOAD_COOLDOWN_MS = 2500;
// Upper bound on pages auto-skipped when a filter matches nothing, so a channel with thousands
// of non-matching messages can't loop indefinitely.
const MAX_BARREN_PAGES = 6;
const SEARCHABLE_GUILD_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12, 15, 16]);
// Discord's thread channel types: 10 = announcement thread, 11 = public thread,
// 12 = private thread. Forum (15) and media (16) channels hold "posts", which are
// themselves type-11 threads parented to the forum channel.
const THREAD_CHANNEL_TYPES = new Set([10, 11, 12]);
// Channel types that contain threads/posts rather than messages of their own.
const THREAD_PARENT_CHANNEL_TYPES = new Set([15, 16]);

function isThreadChannel(channel: any): boolean {
    return !!channel && THREAD_CHANNEL_TYPES.has(channel.type);
}

function isThreadParentChannel(channel: any): boolean {
    return !!channel && THREAD_PARENT_CHANNEL_TYPES.has(channel.type);
}

// Discord calls the collapsible groups in a server's channel list "categories" (channel
// type 4). The folders in the left-hand server rail group *servers*, not channels, so they
// are not relevant to a per-server channel picker.
const GUILD_CATEGORY_CHANNEL_TYPE = 4;

interface ChannelCategory {
    id: string;
    name: string;
    channels: any[];
}

/** Bucket channels under their parent category, preserving Discord's own ordering. */
function groupChannelsByCategory(channels: any[], resolveChannel: (id: string) => any): ChannelCategory[] {
    const categories = new Map<string, ChannelCategory>();
    const UNCATEGORISED = "__none__";

    for (const channel of channels) {
        // A thread's parent_id points at its channel, not a category, so walk up to the
        // owning channel first and use *its* category.
        const owner = THREAD_CHANNEL_TYPES.has(channel.type)
            ? resolveChannel(channel.parent_id) ?? channel
            : channel;

        const categoryId = owner?.parent_id ?? UNCATEGORISED;
        const existing = categories.get(categoryId);

        if (existing) {
            existing.channels.push(channel);
            continue;
        }

        const categoryChannel = categoryId === UNCATEGORISED ? null : resolveChannel(categoryId);
        categories.set(categoryId, {
            id: categoryId,
            name: categoryChannel?.type === GUILD_CATEGORY_CHANNEL_TYPE
                ? (categoryChannel.name || "Category")
                : "Uncategorised",
            channels: [channel]
        });
    }

    // Uncategorised channels sit at the top in Discord's own UI; mirror that.
    return [...categories.values()].sort((a, b) => {
        if (a.id === UNCATEGORISED) return -1;
        if (b.id === UNCATEGORISED) return 1;
        return 0;
    });
}

/**
 * Interleave threads beneath the channel that owns them.
 *
 * GuildChannelStore.getChannels() only returns SELECTABLE/VOCAL buckets — it contains no
 * threads at all, which is why threads never appeared in the server-wide channel picker.
 * Threads have to come from ActiveJoinedThreadsStore and be merged in manually.
 */
function interleaveThreads(channels: any[], threadsByParent: Map<string, any[]>): any[] {
    if (threadsByParent.size === 0) return channels;

    const result: any[] = [];
    for (const channel of channels) {
        result.push(channel);
        for (const thread of threadsByParent.get(channel.id) ?? []) result.push(thread);
    }
    return result;
}

function normaliseGuildChannels(raw: any): any[] {
    const buckets = [raw?.SELECTABLE, raw?.VOCAL, raw?.TEXTUAL, raw?.THREADS].filter(Boolean);
    const channels = buckets.flatMap(bucket => Array.isArray(bucket) ? bucket : Object.values(bucket));
    const seenChannelIds = new Set<string>();

    return channels
        .map((entry: any) => entry?.channel || entry)
        .filter((channel: any) => {
            if (!channel?.id || !SEARCHABLE_GUILD_CHANNEL_TYPES.has(channel.type)) return false;
            if (seenChannelIds.has(channel.id)) return false;
            seenChannelIds.add(channel.id);
            return true;
        })
        .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
}

interface SessionDefaults {
    cardSize?: string;
    scope?: ScopeType;
    filterType?: FilterType;
    sortOrder?: GallerySortOrder;
}

function createDefaultSessionState(initialQuery: string, defaults: SessionDefaults = {}): GallerySessionState {
    return {
        mediaItems: [],
        offset: 0,
        totalResults: 0,
        hasMore: true,
        scrollTop: 0,
        filterType: defaults.filterType || "all",
        selectedTypes: [],
        scope: defaults.scope || "channel",
        searchQuery: initialQuery,
        activeQuery: initialQuery,
        cardMinWidth: defaults.cardSize || "240px",
        beforeDate: "",
        afterDate: "",
        sortOrder: defaults.sortOrder || "desc",
        selectedAuthors: [],
        selectedChannelIds: [],
        selectedThreadIds: []
    };
}

function mergeSessionState(
    session: GallerySessionState | null,
    initialQuery: string,
    defaults: SessionDefaults = {}
): GallerySessionState {
    const fallback = createDefaultSessionState(initialQuery, defaults);
    if (!session) return fallback;

    return {
        ...fallback,
        ...session,
        mediaItems: session.mediaItems || [],
        beforeDate: session.beforeDate || "",
        afterDate: session.afterDate || "",
        sortOrder: session.sortOrder || defaults.sortOrder || "desc",
        selectedAuthors: session.selectedAuthors || [],
        selectedChannelIds: session.selectedChannelIds || []
    };
}

export const GalleryView: React.FC<GalleryViewProps> = ({ onClose, initialQuery = "" }) => {
    const {
        animations, defaultCardSize, defaultFilterType, defaultScope, defaultSortOrder,
        layout, nsfw, prefetchNextPage, rememberSessions, skeletonPlaceholders
    } = settings.use([
        "animations", "defaultCardSize", "defaultFilterType", "defaultScope", "defaultSortOrder",
        "layout", "nsfw", "prefetchNextPage", "rememberSessions", "skeletonPlaceholders"
    ]);
    const motion: string = animations || "full";
    // Measured from Discord's live background so custom/light themes are handled, not guessed.
    const themeTone = useThemeTone();
    // Subscribe to the store rather than reading it once per render. Previously this was a bare
    // getChannelId() call, so navigating between subthreads never re-rendered the gallery: the
    // component kept the channel id it happened to mount with, which is why opening a subthread
    // still showed the parent's media and the scope buttons looked "confused".
    // (Called unconditionally — a conditional hook would violate the rules of hooks. The
    // helper is always present in Vencord's webpack commons.)
    const channelId: string | undefined = useStateFromStores(
        [SelectedChannelStore],
        () => SelectedChannelStore?.getChannelId()
    );
    const currentChannel = channelId ? ChannelStore?.getChannel(channelId) : null;
    // NOTE: currentChannel.guild_id is undefined for DM / group-DM channels. We must NOT fall back
    // to SelectedGuildStore here — it returns the last-selected server from the left nav (which stays
    // selected even while browsing DMs), which would make us query a guild search endpoint with a DM
    // channel_id and fail to load any media. Only use the fallback when there is genuinely no channel.
    const guildId = currentChannel?.guild_id || (currentChannel ? undefined : SelectedGuildStore?.getGuildId());

    // Thread awareness. When the user is inside a thread (or a forum/media post, which is just
    // a thread parented to the forum channel), the gallery should default to that thread but
    // also offer "all threads in this channel".
    const inThread = isThreadChannel(currentChannel);
    const threadParentId: string | undefined = inThread ? currentChannel?.parent_id : undefined;
    const threadParentChannel = threadParentId ? ChannelStore?.getChannel(threadParentId) : null;
    // The channel whose threads we enumerate: the thread's parent, or the forum itself when
    // the user is looking at the forum channel rather than an individual post.
    const threadHostChannel = threadParentChannel ?? (isThreadParentChannel(currentChannel) ? currentChannel : null);
    const threadHostId: string | undefined = threadHostChannel?.id;
    const liveSessionKey = `${channelId || "nochan"}_${guildId || "noguild"}`;

    // If the gallery was closed by "jump to message", resume that session instead of the one
    // belonging to the channel we just landed in. Captured once on mount: it must not change
    // as the user navigates while the gallery is open.
    const resumeKeyRef = useRef<string | null | undefined>(undefined);
    if (resumeKeyRef.current === undefined) {
        const pending = CacheService.takeResumeSession();
        resumeKeyRef.current = pending && CacheService.getSession(pending) ? pending : null;
    }

    // Normally the session follows the selected channel, so switching channels/threads behind
    // the overlay re-targets the gallery (deliberate). When resuming after a jump we instead
    // stay pinned to the restored session, until the user navigates again with the gallery open.
    const [pinnedKeyState, setPinnedKeyState] = useState<string | null>(resumeKeyRef.current);

    // Mirrored in a ref because handleBeforeJump must take effect *synchronously*: React may
    // flush the SelectedChannelStore update (and therefore the session-swap effect) before a
    // setState from the same click has been applied.
    const pinnedKeyRef = useRef<string | null>(resumeKeyRef.current);
    const setPinnedKey = (key: string | null) => {
        pinnedKeyRef.current = key;
        setPinnedKeyState(key);
    };

    const pinnedKey = pinnedKeyRef.current;
    const sessionKey = pinnedKey ?? liveSessionKey;
    void pinnedKeyState;
    const sessionDefaults: SessionDefaults = {
        cardSize: defaultCardSize || "240px",
        // "parent" only makes sense where a thread host exists; the scope-guard effect below
        // corrects it otherwise, so this is safe to apply unconditionally.
        scope: (defaultScope as ScopeType) || "channel",
        filterType: (defaultFilterType as FilterType) || "all",
        sortOrder: (defaultSortOrder as GallerySortOrder) || "desc"
    };

    // `rememberSessions` off means always start from the configured defaults.
    const initialSession = mergeSessionState(
        // A resumed session is always restored, even with rememberSessions off — see persistSession.
        rememberSessions === false && !resumeKeyRef.current ? null : CacheService.getSession(sessionKey),
        initialQuery,
        sessionDefaults
    );

    const [mediaItems, setMediaItems] = useState<MediaItem[]>(initialSession.mediaItems);
    const [loading, setLoading] = useState<boolean>(initialSession.mediaItems.length === 0);
    const [loadingMore, setLoadingMore] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [filterType, setFilterType] = useState<FilterType>(initialSession.filterType);
    // Multi-select media types (shift/ctrl-click the tabs). Empty === use filterType alone.
    const [selectedTypes, setSelectedTypes] = useState<FilterType[]>(initialSession.selectedTypes || []);
    const [searchQuery, setSearchQuery] = useState<string>(initialSession.searchQuery);
    const [activeQuery, setActiveQuery] = useState<string>(initialSession.activeQuery);
    const [offset, setOffset] = useState<number>(initialSession.offset);
    const [totalResults, setTotalResults] = useState<number>(initialSession.totalResults);
    const [hasMore, setHasMore] = useState<boolean>(initialSession.hasMore);
    const [scope, setScope] = useState<ScopeType>(initialSession.scope);
    const [cardMinWidth, setCardMinWidth] = useState<string>(initialSession.cardMinWidth || defaultCardSize || "240px");
    const [showScrollTop, setShowScrollTop] = useState<boolean>((initialSession.scrollTop || 0) > 400);
    const [authorQuery, setAuthorQuery] = useState<string>("");
    const [debouncedAuthorQuery, setDebouncedAuthorQuery] = useState<string>("");
    const [selectedAuthors, setSelectedAuthors] = useState<AuthorPill[]>(initialSession.selectedAuthors || []);
    const [showChannelDropdown, setShowChannelDropdown] = useState<boolean>(false);
    const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>(initialSession.selectedChannelIds || []);
    const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>(initialSession.selectedThreadIds || []);
    const [showThreadDropdown, setShowThreadDropdown] = useState<boolean>(false);
    const [beforeDate, setBeforeDate] = useState<string>(initialSession.beforeDate || "");
    const [afterDate, setAfterDate] = useState<string>(initialSession.afterDate || "");
    const [sortOrder, setSortOrder] = useState<GallerySortOrder>(initialSession.sortOrder || "desc");
    const [authorMenuDismissed, setAuthorMenuDismissed] = useState<boolean>(false);
    const [rateLimitTick, setRateLimitTick] = useState<number>(0);

    const containerRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const observerTargetRef = useRef<HTMLDivElement>(null);
    const channelSelectRef = useRef<HTMLDivElement>(null);
    const threadSelectRef = useRef<HTMLDivElement>(null);
    const authorInputRef = useRef<HTMLDivElement>(null);
    const latestRequestRef = useRef<number>(0);
    const fetchingRef = useRef<boolean>(false);
    const lastAutoLoadRef = useRef<number>(0);
    // Consecutive pages that yielded no renderable cards (see fetchMedia).
    const barrenPagesRef = useRef<number>(0);
    const deferredAutoLoadRef = useRef<number | null>(null);
    // Timestamp of the last real user scroll, used to distinguish "user is browsing" from
    // "the layout settled and the sentinel happens to be visible".
    const lastUserScrollRef = useRef<number>(0);
    // Lets the deferred timer call the newest closure rather than a stale captured one.
    const loadNextPageRef = useRef<(source?: "auto" | "manual") => void>(() => { });
    // Cursor for the embed stream blended into the "all" filter. -1 means "exhausted, stop asking".
    const embedOffsetRef = useRef<number>(0);
    const mediaItemsRef = useRef<MediaItem[]>(mediaItems);
    const lastSessionKeyRef = useRef<string>(sessionKey);
    // Set by handleBeforeJump so the navigation it causes doesn't release the pin.
    const jumpPinnedRef = useRef<boolean>(false);
    // Blocks further session writes once the jump snapshot has been taken.
    const sessionSealedRef = useRef<boolean>(false);
    // Track the latest scroll top in a ref. During unmount React nulls DOM refs, so reading
    // scrollContainerRef.current there would always yield 0 and clobber the real scroll depth
    // that onScroll persisted — losing the user's position when they reopen the gallery.
    const lastScrollTopRef = useRef<number>(initialSession.scrollTop || 0);
    const pendingRestoreScrollRef = useRef<number | null>(initialSession.mediaItems.length > 0 ? initialSession.scrollTop : null);
    const skipAutoFetchRef = useRef<boolean>(initialSession.mediaItems.length > 0);
    const isHydratingSessionRef = useRef<boolean>(false);
    const stateSnapshotRef = useRef({
        mediaItems,
        offset,
        totalResults,
        hasMore,
        filterType,
        selectedTypes,
        scope,
        searchQuery,
        activeQuery,
        cardMinWidth,
        beforeDate,
        afterDate,
        sortOrder,
        selectedAuthors,
        selectedChannelIds,
        selectedThreadIds
    });

    mediaItemsRef.current = mediaItems;
    stateSnapshotRef.current = {
        mediaItems,
        offset,
        totalResults,
        hasMore,
        filterType,
        selectedTypes,
        scope,
        searchQuery,
        activeQuery,
        cardMinWidth,
        beforeDate,
        afterDate,
        sortOrder,
        selectedAuthors,
        selectedChannelIds,
        selectedThreadIds
    };

    const guildChannels = React.useMemo(() => {
        if (!guildId || !GuildChannelStore) return [];
        try {
            return normaliseGuildChannels(GuildChannelStore.getChannels(guildId));
        } catch (err) {
            console.warn("[GalleryMode] Failed to read guild channel list", err);
            return [];
        }
    }, [guildId]);

    // Threads under the current host channel, from the client store. This only contains threads
    // the user has actually joined/opened, which is why the picker used to look almost empty.
    const storeThreads = React.useMemo(() => {
        if (!guildId || !threadHostId || !ActiveJoinedThreadsStore) return [];
        try {
            const byParent = ActiveJoinedThreadsStore.getActiveJoinedThreadsForGuild(guildId) || {};
            const entries = byParent[threadHostId];
            if (!entries) return [];

            return Object.values(entries)
                .map((entry: any) => entry?.channel || entry)
                .filter((channel: any) => channel?.id);
        } catch (err) {
            console.warn("[GalleryMode] Failed to read thread list", err);
            return [];
        }
    }, [guildId, threadHostId]);

    // Threads fetched from Discord, covering ones the user has never opened (and archived ones).
    const [fetchedThreads, setFetchedThreads] = useState<any[]>([]);

    useEffect(() => {
        if (!threadHostId) {
            setFetchedThreads([]);
            return;
        }

        let cancelled = false;
        void SearchService.listThreads(threadHostId)
            .then(threads => { if (!cancelled) setFetchedThreads(threads); })
            .catch(() => { if (!cancelled) setFetchedThreads([]); });

        return () => { cancelled = true; };
    }, [threadHostId]);

    // Union of both sources, most recently active first.
    const siblingThreads = React.useMemo(() => {
        const byId = new Map<string, any>();
        for (const thread of [...fetchedThreads, ...storeThreads]) {
            if (thread?.id) byId.set(thread.id, thread);
        }
        // Always include the thread the user is currently in, even if neither source lists it.
        if (inThread && currentChannel?.id && !byId.has(currentChannel.id)) {
            byId.set(currentChannel.id, currentChannel);
        }

        return [...byId.values()].sort((a: any, b: any) =>
            String(a.name || "").localeCompare(String(b.name || ""))
        );
    }, [fetchedThreads, storeThreads, inThread, currentChannel]);

    // Stable list of ids for the search params, so buildSearchParams doesn't depend on object
    // identity churn from the two thread sources.
    const threadChannelIds = React.useMemo(
        () => siblingThreads.map((thread: any) => thread.id),
        [siblingThreads]
    );

    // Threads across the whole guild, keyed by the channel that owns them. GuildChannelStore
    // has no thread bucket, so without this the server-wide picker silently omits every thread.
    const guildThreadsByParent = React.useMemo(() => {
        const byParent = new Map<string, any[]>();
        if (!guildId || !ActiveJoinedThreadsStore) return byParent;

        try {
            const grouped = ActiveJoinedThreadsStore.getActiveJoinedThreadsForGuild(guildId) || {};
            for (const [parentId, entries] of Object.entries(grouped)) {
                const threads = Object.values(entries as Record<string, any>)
                    .map((entry: any) => entry?.channel || entry)
                    .filter((channel: any) => channel?.id)
                    .sort((a: any, b: any) => String(a.name || "").localeCompare(String(b.name || "")));

                if (threads.length > 0) byParent.set(parentId, threads);
            }
        } catch (err) {
            console.warn("[GalleryMode] Failed to read guild thread list", err);
        }

        return byParent;
    }, [guildId]);

    // Categories the user has collapsed in the picker. Collapsing is purely visual — it never
    // changes which channels are selected or searched.
    const [collapsedCategories, setCollapsedCategories] = useState<string[]>([]);
    // Free-text filter inside the channel picker — essential in servers with 100+ channels.
    const [channelFilter, setChannelFilter] = useState<string>("");

    const channelCategories = React.useMemo(() => {
        const withThreads = interleaveThreads(guildChannels, guildThreadsByParent);

        const needle = channelFilter.trim().toLowerCase();
        const visible = needle
            ? withThreads.filter((channel: any) => String(channel.name || "").toLowerCase().includes(needle))
            : withThreads;

        return groupChannelsByCategory(visible, (id: string) => (id ? ChannelStore?.getChannel(id) : null));
    }, [guildChannels, guildThreadsByParent, channelFilter]);


    const toggleCategoryCollapsed = (id: string) => {
        setCollapsedCategories(prev => prev.includes(id) ? prev.filter(entry => entry !== id) : [...prev, id]);
    };

    /** Select or clear every channel in one category at once. */
    const toggleCategorySelection = (category: ChannelCategory) => {
        const ids = category.channels.map((channel: any) => channel.id);
        const allSelected = ids.every(id => selectedChannelIds.includes(id));

        setSelectedChannelIds(prev => allSelected
            ? prev.filter(id => !ids.includes(id))
            : [...prev, ...ids.filter(id => !prev.includes(id))]);
    };

    // Must include threads: this set is used to validate (and prune) the user's selection, so
    // omitting them would silently discard any thread the user ticked in the picker.
    const availableGuildChannelIds = React.useMemo(() => {
        const ids = new Set<string>(guildChannels.map((channel: any) => channel.id));
        for (const threads of guildThreadsByParent.values()) {
            for (const thread of threads) ids.add(thread.id);
        }
        return ids;
    }, [guildChannels, guildThreadsByParent]);

    const effectiveSelectedChannelIds = React.useMemo(() => {
        if (selectedChannelIds.length === 0 || availableGuildChannelIds.size === 0) return selectedChannelIds;
        return selectedChannelIds.filter(id => availableGuildChannelIds.has(id));
    }, [selectedChannelIds, availableGuildChannelIds]);

    const channelPillLabel = React.useMemo(() => {
        const currentChannelName = currentChannel?.name
            || currentChannel?.rawRecipients?.map((recipient: any) => recipient.username).join(", ")
            || "Channel";

        if (effectiveSelectedChannelIds.length > 0) {
            const firstChan = guildChannels.find((channel: any) => channel.id === effectiveSelectedChannelIds[0]);
            const firstName = firstChan?.name || "channel";
            return effectiveSelectedChannelIds.length > 1 ? `#${firstName} +${effectiveSelectedChannelIds.length - 1}` : `#${firstName}`;
        }

        if (scope === "parent") {
            const host = threadHostChannel?.name || "channel";
            if (selectedThreadIds.length === 1) {
                const picked = siblingThreads.find((thread: any) => thread.id === selectedThreadIds[0]);
                return `🧵 ${picked?.name || "1 thread"}`;
            }
            if (selectedThreadIds.length > 1) return `🧵 ${selectedThreadIds.length} threads in #${host}`;
            // Nothing picked yet: the picker mode still searches everything under the host.
            return `🧵 All threads in #${host}`;
        }
        if (scope === "guild") return "Entire Server";
        // In a thread, name the thread itself — showing the parent channel here is what made it
        // look like the gallery had ignored the subthread.
        if (inThread) return `🧵 ${currentChannel?.name || "Thread"}`;
        // A forum/media channel's media all lives in its posts, so say so rather than implying
        // the search is limited to the channel surface itself.
        if (isThreadParentChannel(currentChannel)) return `🧵 All sub threads in #${currentChannelName}`;
        return guildId ? `#${currentChannelName}` : currentChannelName;
    }, [currentChannel, effectiveSelectedChannelIds, guildChannels, guildId, inThread, scope, selectedThreadIds, siblingThreads, threadHostChannel]);

    /**
     * Label for the default ("channel") scope, describing what the search actually covers:
     *
     *  - inside a thread  -> just that thread
     *  - on a forum/media channel -> every post in it, because a forum holds no messages of
     *    its own; all of its media lives in its posts. Calling that "This Channel" read as if
     *    it were narrower than it is.
     *  - anywhere else -> the plain channel
     */
    const defaultScopeLabel = React.useMemo(() => {
        if (inThread) return "This Thread";
        if (isThreadParentChannel(currentChannel)) return "All Sub Threads";
        return "This Channel";
    }, [inThread, currentChannel]);

    // Drop the resume pin as soon as the user navigates somewhere new with the gallery open;
    // from then on the gallery tracks the selected channel again, as it does normally.
    const mountedLiveKeyRef = useRef<string>(liveSessionKey);
    useEffect(() => {
        if (liveSessionKey === mountedLiveKeyRef.current) return;
        mountedLiveKeyRef.current = liveSessionKey;
        // A jump deliberately navigates away; that must not clear the pin it just set.
        if (jumpPinnedRef.current) return;
        setPinnedKey(null);
    }, [liveSessionKey]);

    const authorSuggestions = React.useMemo(() => {
        const q = debouncedAuthorQuery.trim().replace(/^@/, "").toLowerCase();
        if (!q || !UserStore) return [];

        try {
            let users: any[] = [];

            if (guildId && GuildMemberStore) {
                const rawMembers = GuildMemberStore.getMembers(guildId) || [];
                const members = Array.isArray(rawMembers) ? rawMembers : Object.values(rawMembers);
                users = members.map((member: any) => UserStore.getUser(member.userId || member.user_id || member.id));
            } else if (currentChannel?.recipients?.length) {
                // DMs / group DMs have no guild member list — suggest from the recipient list instead
                // so the author filter still works there.
                users = currentChannel.recipients.map((id: string) => UserStore.getUser(id));
            } else if (Array.isArray(currentChannel?.rawRecipients) && currentChannel.rawRecipients.length) {
                users = currentChannel.rawRecipients;
            }

            return users
                .filter((user: any) => user && !selectedAuthors.some(author => author.id === user.id))
                .filter((user: any) => {
                    const username = user.username?.toLowerCase() || "";
                    const globalName = (user.globalName || user.global_name || "").toLowerCase();
                    return username.includes(q) || globalName.includes(q) || user.id === q;
                })
                .slice(0, 8);
        } catch {
            return [];
        }
    }, [debouncedAuthorQuery, guildId, selectedAuthors, currentChannel]);

    // Debounce the author search so we don't filter every guild member on every keystroke.
    useEffect(() => {
        const t = setTimeout(() => setDebouncedAuthorQuery(authorQuery), 150);
        return () => clearTimeout(t);
    }, [authorQuery]);

    const persistSession = React.useCallback((
        targetSessionKey = sessionKey,
        scrollTop = lastScrollTopRef.current,
        { force = false }: { force?: boolean; } = {}
    ) => {
        // Honour the "don't remember sessions" preference at the write side too, so nothing is
        // left behind to restore later. `force` overrides it for the jump-and-return round trip:
        // that setting means "don't carry state between visits", not "lose my place when I click
        // Jump", and the entry is consumed immediately on return.
        if (rememberSessions === false && !force) return;

        // Once the jump snapshot is taken the session is sealed. Everything that runs during
        // teardown (the state-change effect, the unmount cleanup) would otherwise write over it
        // with state that React has already begun tearing down.
        if (sessionSealedRef.current && !force) return;
        const snapshot = stateSnapshotRef.current;

        CacheService.saveSession(targetSessionKey, {
            mediaItems: snapshot.mediaItems,
            offset: snapshot.offset,
            totalResults: snapshot.totalResults,
            hasMore: snapshot.hasMore,
            scrollTop,
            filterType: snapshot.filterType,
            selectedTypes: snapshot.selectedTypes,
            scope: snapshot.scope,
            searchQuery: snapshot.searchQuery,
            activeQuery: snapshot.activeQuery,
            cardMinWidth: snapshot.cardMinWidth,
            beforeDate: snapshot.beforeDate,
            afterDate: snapshot.afterDate,
            sortOrder: snapshot.sortOrder,
            selectedAuthors: snapshot.selectedAuthors,
            selectedChannelIds: snapshot.selectedChannelIds,
            selectedThreadIds: snapshot.selectedThreadIds
        });
    }, [rememberSessions, sessionKey]);

    /**
     * Snapshot the gallery so it can be restored after "jump to message".
     *
     * Must run before NavigationRouter.transitionTo(): that changes the selected channel, which
     * re-keys the session, so a save afterwards would be filed under the destination channel.
     */
    const handleBeforeJump = React.useCallback(() => {
        // Freeze this gallery's identity for the rest of its life.
        //
        // transitionTo() changes the selected channel while the overlay is still mounted, and
        // React flushes that store update before the unmount. Without pinning, sessionKey would
        // flip to the destination and three separate effects would fire in order:
        //   1. the session-swap effect re-saves the old key with scrollTop 0, then hydrates the
        //      destination channel's (empty) session over our state,
        //   2. the state-change effect saves that emptied state,
        //   3. the unmount cleanup saves it again.
        // The good snapshot taken here would be overwritten before the user ever reopened.
        // Pinning keeps sessionKey stable so all of those become no-ops against the same key.
        jumpPinnedRef.current = true;
        setPinnedKey(sessionKey);

        persistSession(sessionKey, lastScrollTopRef.current, { force: true });
        CacheService.markResumeSession(sessionKey);
        sessionSealedRef.current = true;
    }, [persistSession, sessionKey]);

    const applySessionState = React.useCallback((session: GallerySessionState | null) => {
        const next = mergeSessionState(session, initialQuery, {
            cardSize: defaultCardSize || "240px",
            scope: (defaultScope as ScopeType) || "channel",
            filterType: (defaultFilterType as FilterType) || "all",
            sortOrder: (defaultSortOrder as GallerySortOrder) || "desc"
        });

        latestRequestRef.current++;
        fetchingRef.current = false;
        mediaItemsRef.current = next.mediaItems;
        pendingRestoreScrollRef.current = next.mediaItems.length > 0 ? next.scrollTop || 0 : null;
        skipAutoFetchRef.current = next.mediaItems.length > 0;

        setMediaItems(next.mediaItems);
        setLoading(next.mediaItems.length === 0);
        setLoadingMore(false);
        setError(null);
        setFilterType(next.filterType);
        setSelectedTypes(next.selectedTypes || []);
        setSearchQuery(next.searchQuery);
        setActiveQuery(next.activeQuery);
        setOffset(next.offset);
        setTotalResults(next.totalResults);
        setHasMore(next.hasMore);
        setScope(next.scope);
        setCardMinWidth(next.cardMinWidth || defaultCardSize || "240px");
        setCollapsedCategories([]);
        setChannelFilter("");
        setBeforeDate(next.beforeDate || "");
        setAfterDate(next.afterDate || "");
        setSortOrder(next.sortOrder || "desc");
        setAuthorMenuDismissed(false);
        setShowScrollTop((next.scrollTop || 0) > 400);
        setAuthorQuery("");
        setSelectedAuthors(next.selectedAuthors || []);
        setShowChannelDropdown(false);
        setSelectedChannelIds(next.selectedChannelIds || []);
        setSelectedThreadIds(next.selectedThreadIds || []);
        setShowThreadDropdown(false);
    }, [defaultCardSize, defaultFilterType, defaultScope, defaultSortOrder, initialQuery]);

    /** Resolve the live Discord target. Returns null when there is nothing searchable. */
    const resolveSearchTarget = () => {
        // While pinned to a resumed session, keep querying the channel that session belongs to.
        // Reading the live selection here would silently retarget "Load More" at whatever
        // channel the jump landed in, so the user's next page would come from the wrong place.
        if (pinnedKey) {
            const [pinnedChannelId, pinnedGuildId] = pinnedKey.split("_");
            const activeChannelId = pinnedChannelId === "nochan" ? undefined : pinnedChannelId;
            const activeGuildId = pinnedGuildId === "noguild" ? undefined : pinnedGuildId;
            if (activeChannelId || activeGuildId) return { activeChannelId, activeGuildId };
        }

        const activeChannelId = SelectedChannelStore?.getChannelId();
        const activeChannel = activeChannelId ? ChannelStore?.getChannel(activeChannelId) : null;
        // Same DM-safe guard as above: only fall back to SelectedGuildStore when no channel is active.
        const activeGuildId = activeChannel?.guild_id || (activeChannel ? undefined : SelectedGuildStore?.getGuildId());
        if (!activeChannelId && !activeGuildId) return null;
        return { activeChannelId, activeGuildId };
    };

    const buildSearchParams = (
        target: { activeChannelId?: string; activeGuildId?: string; },
        fetchOffset: number,
        filter: FilterType,
        query: string,
        embedOffset: number
    ): SearchParameters => {
        // Which channel ids the search should be constrained to.
        //
        // Threads are the subtle case. A thread has its own channel id, but Discord's
        // /channels/:id/messages/search endpoint rejects thread surfaces (code 50024), so a
        // thread must be searched via the GUILD endpoint with channel_id set to the thread.
        // Passing `channelId` here would route us to the channel endpoint, which is what made
        // threads error out and fall back to the wrong results.
        let scopedChannelIds: string[] | undefined;

        if (scope === "parent") {
            // Every known thread under the host channel, plus the host itself so messages posted
            // directly in it are included (forums hold no messages of their own, so they are
            // excluded there).
            //
            // CRITICAL: this list must never be left undefined. `channelIds: undefined` means
            // "search the whole guild", which is why "All Threads" was returning the entire
            // server's media. Falling back to the host id alone keeps the search scoped even
            // when no individual threads are known yet.
            const ids = selectedThreadIds.length > 0
                ? [...selectedThreadIds]
                : threadChannelIds.slice();

            if (threadHostId && !isThreadParentChannel(threadHostChannel) && !ids.includes(threadHostId)) {
                ids.push(threadHostId);
            }

            scopedChannelIds = ids.length > 0
                ? ids
                : (threadHostId ? [threadHostId] : undefined);
        } else if (scope === "guild") {
            scopedChannelIds = effectiveSelectedChannelIds.length > 0 ? effectiveSelectedChannelIds : undefined;
        } else if (target.activeGuildId && target.activeChannelId) {
            // "This channel"/"This thread" inside a guild. Always go through the guild endpoint
            // constrained to the single channel id: it accepts thread, forum and media surfaces,
            // whereas the per-channel endpoint returns 50024 for several of them.
            scopedChannelIds = [target.activeChannelId];
        }

        // Only use the channel endpoint for real DM/group-DM surfaces, which have no guild.
        const useChannelEndpoint = scope === "channel" && !target.activeGuildId;

        return {
            channelId: useChannelEndpoint ? target.activeChannelId : undefined,
            guildId: target.activeGuildId,
            channelIds: scopedChannelIds,
            filterType: filter,
            filterTypes: selectedTypes.length > 1 ? selectedTypes : undefined,
            query,
            authorIds: selectedAuthors.length > 0 ? selectedAuthors.map(author => author.id) : undefined,
            offset: fetchOffset,
            embedOffset,
            limit: PAGE_SIZE,
            nsfw,
            beforeDate: beforeDate || undefined,
            afterDate: afterDate || undefined,
            sortOrder
        };
    };

    const fetchMedia = async (
        fetchOffset: number,
        filter: FilterType,
        query: string,
        isReset = false
    ) => {
        if (isReset) embedOffsetRef.current = 0;
        if (fetchingRef.current && !isReset) return;

        const requestId = ++latestRequestRef.current;
        fetchingRef.current = true;

        const target = resolveSearchTarget();
        if (!target) {
            setError("No active channel or server detected.");
            setLoading(false);
            setLoadingMore(false);
            fetchingRef.current = false;
            return;
        }

        const params = buildSearchParams(target, fetchOffset, filter, query, embedOffsetRef.current);

        // If the page is already cached (prefetch, or a filter that maps to the same Discord
        // query) resolve it without ever flipping on a loading state — the swap is instant and
        // the user never sees a spinner.
        const isWarm = CacheService.has(params);

        if (isReset) {
            setLoading(!isWarm);
            setLoadingMore(false);
        } else {
            setLoadingMore(!isWarm);
        }
        setError(null);

        try {
            const res = await SearchService.searchMedia(params);
            if (requestId !== latestRequestRef.current) return;

            // Discord search returns "hit groups" per page, so the correct next offset is the
            // number of results actually returned, not a fixed PAGE_SIZE step. This prevents
            // skipped media when a page returns fewer results than PAGE_SIZE.
            const nextOffset = res.nextOffset ?? (fetchOffset + PAGE_SIZE);
            if (res.nextEmbedOffset !== undefined) embedOffsetRef.current = res.nextEmbedOffset;

            const previousItems = mediaItemsRef.current;
            const updatedItems = isReset ? res.items : CacheService.deduplicateItems(previousItems, res.items);
            // How many cards this page actually contributed after client-side type filtering and
            // de-duplication. Discord counts a "hit" as a matching message, but a message can
            // yield zero renderable media for the active filter, so this is often 0 even though
            // the search reported 25 hits.
            const gained = isReset ? updatedItems.length : updatedItems.length - previousItems.length;

            mediaItemsRef.current = updatedItems;
            setMediaItems(updatedItems);
            setTotalResults(res.totalResults);
            setHasMore(res.hasMore);
            setOffset(nextOffset);
            setShowScrollTop((scrollContainerRef.current?.scrollTop || 0) > 400);

            // A page that produced nothing visible must not strand the user on a "Load More"
            // button that appears to do nothing. Keep walking the result set automatically
            // until we surface at least one card (or run out), bounded so a huge barren range
            // can't spin forever.
            if (gained === 0 && res.hasMore && nextOffset > fetchOffset) {
                if (barrenPagesRef.current < MAX_BARREN_PAGES) {
                    barrenPagesRef.current++;
                    fetchingRef.current = false;
                    void fetchMedia(nextOffset, filter, query, false);
                    return;
                }
                console.warn(`[GalleryMode] Stopped auto-skipping after ${MAX_BARREN_PAGES} pages with no matching media.`);
            }
            barrenPagesRef.current = 0;

            if (isReset) {
                scrollContainerRef.current?.scrollTo({ top: 0 });
            }

            CacheService.saveSession(sessionKey, {
                mediaItems: updatedItems,
                offset: nextOffset,
                totalResults: res.totalResults,
                hasMore: res.hasMore,
                scrollTop: isReset ? 0 : lastScrollTopRef.current,
                filterType: filter,
                selectedTypes,
                scope,
                searchQuery,
                activeQuery: query,
                cardMinWidth,
                beforeDate,
                afterDate,
                sortOrder,
                selectedAuthors,
                selectedChannelIds: effectiveSelectedChannelIds,
                selectedThreadIds
            });
        } catch (err: any) {
            if (requestId !== latestRequestRef.current) return;
            console.error("[GalleryMode] Fetch error:", err);

            if (err?.status === 429 || err?.body?.retry_after || err?.retry_after) {
                setError("Discord Search is rate limited right now. Wait a few seconds, then retry.");
            } else if (err?.body?.code === 50001) {
                // "Missing Access" — usually one selected channel the account can't read, rather
                // than the whole server being off limits.
                setError(scope === "guild" && effectiveSelectedChannelIds.length > 0
                    ? "You don't have access to one of the selected channels. Deselect it, or switch to this channel only."
                    : "You don't have permission to search this channel. Try another channel or the server scope.");
            } else if (err?.status === 403) {
                setError("Discord denied access to search this channel/server. Check your permissions.");
            } else if (err?.body?.code === 50024) {
                setError("Discord cannot search this channel surface directly. Try the server scope or select a normal text/thread/media channel.");
            } else {
                setError(err?.body?.message || err?.message || "Failed to fetch gallery media from Discord Search.");
            }
        } finally {
            if (requestId === latestRequestRef.current) {
                setLoading(false);
                setLoadingMore(false);
                fetchingRef.current = false;
                // Re-stamp so the auto-load cooldown counts from completion, not from the
                // moment the request was issued.
                lastAutoLoadRef.current = Date.now();
            }
        }
    };

    /**
     * Re-attempt an auto-load once the cooldown expires. Only one timer is ever pending; later
     * calls keep the earliest deadline so a stream of observer events can't stack timers.
     */
    const scheduleDeferredAutoLoad = (delayMs: number) => {
        if (deferredAutoLoadRef.current != null) return;
        deferredAutoLoadRef.current = window.setTimeout(() => {
            deferredAutoLoadRef.current = null;
            loadNextPageRef.current("auto");
        }, Math.max(0, delayMs) + 16);
    };

    const loadNextPage = (source: "auto" | "manual" = "manual") => {
        if (!hasMore || loading || loadingMore || fetchingRef.current || error) return;

        if (source === "auto") {
            const container = scrollContainerRef.current;
            // Guard against runaway auto-pagination. In masonry mode the grid can briefly be
            // shorter than the viewport while images are still decoding, which puts the sentinel
            // permanently on screen and chain-fires page after page until Discord rate-limits us.
            //
            // IMPORTANT: when the content is NOT yet taller than the scroll port we must still
            // keep paginating, otherwise a page whose hits are all filtered out client-side
            // (very common in DMs and quiet servers, where 25 hits can yield 0 renderable cards)
            // leaves a permanent "Load More" that scrolling can never dismiss — there is nothing
            // to scroll. In that case we fall through and auto-load, just on the cooldown.
            if (container) {
                const { scrollTop, scrollHeight, clientHeight } = container;
                const isScrollable = scrollHeight > clientHeight + 32;
                if (isScrollable && scrollHeight - (scrollTop + clientHeight) > clientHeight) {
                    return;
                }
            }

            // Rate-limit auto-loads so a layout reflow storm can't burn the search quota.
            //
            // A plain `return` here used to strand the user: scrolling fast fires the observer
            // once, the cooldown rejects it, and because IntersectionObserver only reports
            // *changes* in intersection, no further callback arrives while the sentinel stays
            // on screen — leaving a "Load More" button that scrolling never clears. Instead of
            // dropping the request, defer it to when the cooldown expires.
            //
            // The cooldown is measured from when the previous page FINISHED, not when it
            // started. Measuring from the start meant a ~350ms request only left ~350ms of
            // real gap, and the several trigger paths kept re-arming each other into a
            // free-running loop that reliably tripped Discord's 429.
            //
            // A longer cooldown also applies when the user isn't actively scrolling, so an
            // idle gallery sitting near the bottom cannot quietly page through a whole server.
            const scrolledRecently = Date.now() - lastUserScrollRef.current < 1200;
            const requiredGap = scrolledRecently ? AUTO_LOAD_COOLDOWN_MS : IDLE_AUTO_LOAD_COOLDOWN_MS;
            const sinceLast = Date.now() - lastAutoLoadRef.current;

            if (sinceLast < requiredGap) {
                scheduleDeferredAutoLoad(requiredGap - sinceLast);
                return;
            }
            lastAutoLoadRef.current = Date.now();
        }

        // `offset` now tracks the next offset to request (see fetchMedia).
        void fetchMedia(offset, filterType, activeQuery, false);
    };

    loadNextPageRef.current = loadNextPage;

    useEffect(() => () => {
        if (deferredAutoLoadRef.current != null) {
            clearTimeout(deferredAutoLoadRef.current);
            deferredAutoLoadRef.current = null;
        }
    }, []);

    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setActiveQuery(searchQuery.trim());
    };

    /**
     * Plain click selects exactly one type. Shift/Ctrl click builds a multi-type selection.
     * "ALL" is mutually exclusive with everything else — combining it with a specific type is
     * meaningless, so picking ALL clears the multi-selection.
     */
    const toggleFilterTab = (tab: FilterType, additive: boolean) => {
        if (!additive || tab === "all") {
            setSelectedTypes([]);
            setFilterType(tab);
            return;
        }

        setSelectedTypes(prev => {
            // Seed the multi-selection from the currently active single tab.
            const base = prev.length > 0 ? prev : (filterType === "all" ? [] : [filterType]);
            const next = base.includes(tab) ? base.filter(t => t !== tab) : [...base, tab];

            if (next.length === 0) {
                setFilterType("all");
                return [];
            }
            if (next.length === 1) {
                setFilterType(next[0]);
                return [];
            }
            return next;
        });
    };

    const toggleThreadSelection = (id: string) => {
        setSelectedThreadIds(prev => prev.includes(id) ? prev.filter(threadId => threadId !== id) : [...prev, id]);
    };

    const toggleChannelSelection = (id: string) => {
        setSelectedChannelIds(prev => prev.includes(id) ? prev.filter(channelId => channelId !== id) : [...prev, id]);
    };

    const addAuthorPill = (user: any) => {
        const pill: AuthorPill = { id: user.id, name: user.globalName || user.global_name || user.username };
        setSelectedAuthors(prev => prev.some(author => author.id === user.id) ? prev : [...prev, pill]);
        setAuthorQuery("");
    };

    const removeAuthorPill = (id: string) => {
        setSelectedAuthors(prev => prev.filter(author => author.id !== id));
    };

    const clearFilters = () => {
        setFilterType("all");
        setSelectedTypes([]);
        setSearchQuery("");
        setActiveQuery("");
        setAuthorQuery("");
        setBeforeDate("");
        setAfterDate("");
        setSortOrder("desc");
        setAuthorMenuDismissed(false);
        setSelectedAuthors([]);
        setSelectedChannelIds([]);
        setSelectedThreadIds([]);
        setShowChannelDropdown(false);
        setShowThreadDropdown(false);
    };

    const handleScroll = () => {
        const container = scrollContainerRef.current;
        const scrollTop = container?.scrollTop || 0;
        // Only count it as user activity if the position actually moved.
        if (Math.abs(scrollTop - lastScrollTopRef.current) > 1) lastUserScrollRef.current = Date.now();
        lastScrollTopRef.current = scrollTop;
        setShowScrollTop(scrollTop > 400);
        persistSession(sessionKey, scrollTop);

        // Safety net for fast scrolling. IntersectionObserver only fires when intersection
        // *changes*; if the user flings the list and the sentinel is already on screen when a
        // load finishes, no new callback arrives and pagination stalls behind a Load More
        // button. Checking proximity on scroll guarantees we notice. loadNextPage() re-applies
        // its own cooldown and in-flight guards, so this cannot cause extra requests.
        if (container && hasMore && !loading && !loadingMore && !error && !fetchingRef.current) {
            const remaining = container.scrollHeight - (container.scrollTop + container.clientHeight);
            if (remaining < container.clientHeight) loadNextPageRef.current("auto");
        }
    };

    const scrollToTop = () => {
        scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    };

    useEffect(() => {
        // Only tick while a rate limit is actually active — otherwise this re-renders the whole
        // gallery (and every card in it) once per second with zero visible benefit.
        const interval = setInterval(() => {
            if (SearchService.getRateLimitState().isRateLimited) setRateLimitTick(tick => tick + 1);
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    // Focus the dialog on open so Esc-to-close works immediately. The Escape handler lives on
    // the overlay element itself (not window), so Escape inside an image/video modal opened from
    // the gallery closes that modal first instead of tearing the gallery down behind it.
    useEffect(() => {
        containerRef.current?.focus();
    }, []);

    // Close the channel dropdown / author suggestions when clicking anywhere outside them.
    useEffect(() => {
        const onDocumentMouseDown = (e: MouseEvent) => {
            const target = e.target as Node | null;
            if (!target) return;
            if (channelSelectRef.current && !channelSelectRef.current.contains(target)) setShowChannelDropdown(false);
            if (threadSelectRef.current && !threadSelectRef.current.contains(target)) setShowThreadDropdown(false);
            if (authorInputRef.current && !authorInputRef.current.contains(target)) setAuthorMenuDismissed(true);
        };

        document.addEventListener("mousedown", onDocumentMouseDown);
        return () => document.removeEventListener("mousedown", onDocumentMouseDown);
    }, []);

    useEffect(() => {
        if (!guildId || availableGuildChannelIds.size === 0) return;
        setSelectedChannelIds(prev => {
            const next = prev.filter(id => availableGuildChannelIds.has(id));
            return next.length === prev.length ? prev : next;
        });
    }, [availableGuildChannelIds, guildId]);

    // "Entire Server" scope only makes sense when there is a guild. If the user navigates into a
    // DM while guild scope is active, fall back to channel scope so the gallery doesn't get stuck
    // trying to query a guild endpoint with a DM channel id.
    useEffect(() => {
        if (scope === "guild" && !guildId) setScope("channel");
        // "All threads" is only valid while a thread host exists; navigating to a plain
        // channel or DM must fall back rather than leaving an unsatisfiable scope.
        if (scope === "parent" && (!guildId || !threadHostId)) setScope("channel");
    }, [scope, guildId, threadHostId]);

    // Drop thread selections when the host channel changes, so picks made in one forum can't
    // leak into another (they would silently scope the search to unrelated channel ids).
    const lastThreadHostRef = useRef<string | undefined>(threadHostId);
    useEffect(() => {
        if (lastThreadHostRef.current === threadHostId) return;
        lastThreadHostRef.current = threadHostId;
        setSelectedThreadIds([]);
        setShowThreadDropdown(false);
    }, [threadHostId]);

    // Prune selections that are no longer present in the resolved thread list.
    useEffect(() => {
        if (selectedThreadIds.length === 0 || threadChannelIds.length === 0) return;
        const known = new Set(threadChannelIds);
        setSelectedThreadIds(prev => {
            const next = prev.filter(id => known.has(id));
            return next.length === prev.length ? prev : next;
        });
    }, [threadChannelIds, selectedThreadIds.length]);

    useEffect(() => {
        if (lastSessionKeyRef.current === sessionKey) return;
        // Mid-jump: the gallery is unmounting and its state is already snapshotted. Hydrating
        // another channel's session over it here is what wiped the restore.
        if (sessionSealedRef.current) return;

        persistSession(lastSessionKeyRef.current, scrollContainerRef.current?.scrollTop || 0);
        isHydratingSessionRef.current = true;
        lastSessionKeyRef.current = sessionKey;
        applySessionState(rememberSessions === false ? null : CacheService.getSession(sessionKey));
    }, [applySessionState, persistSession, rememberSessions, sessionKey]);

    useEffect(() => {
        const scrollTop = pendingRestoreScrollRef.current;
        if (scrollTop == null || !scrollContainerRef.current) return;

        pendingRestoreScrollRef.current = null;
        requestAnimationFrame(() => {
            if (scrollContainerRef.current) {
                scrollContainerRef.current.scrollTop = scrollTop;
                lastScrollTopRef.current = scrollTop;
            }
        });
    }, [mediaItems.length, sessionKey]);

    useEffect(() => {
        if (isHydratingSessionRef.current) {
            isHydratingSessionRef.current = false;
            return;
        }

        persistSession(sessionKey, scrollContainerRef.current?.scrollTop || 0);
    }, [
        activeQuery,
        afterDate,
        beforeDate,
        cardMinWidth,
        filterType,
        hasMore,
        mediaItems,
        offset,
        persistSession,
        scope,
        searchQuery,
        selectedAuthors,
        selectedChannelIds,
        selectedThreadIds,
        selectedTypes,
        sessionKey,
        sortOrder,
        totalResults
    ]);

    useEffect(() => {
        // Use lastScrollTopRef for the scroll position — the DOM ref is nulled during unmount, so
        // reading it directly would save 0 and wipe the user's saved scroll depth.
        // Capture the session key at registration time: this effect re-registers whenever
        // sessionKey changes, and its cleanup fires AFTER the session-swap effect above has
        // already updated lastSessionKeyRef. Reading the live ref would save the old session's
        // snapshot under the new channel's key, corrupting that channel's cached session.
        const keyAtRegistration = lastSessionKeyRef.current;
        return () => persistSession(keyAtRegistration, lastScrollTopRef.current);
    }, [persistSession]);

    useEffect(() => {
        if (skipAutoFetchRef.current) {
            skipAutoFetchRef.current = false;
            return;
        }

        latestRequestRef.current++;
        fetchingRef.current = false;
        setOffset(0);
        embedOffsetRef.current = 0;
        barrenPagesRef.current = 0;
        setMediaItems([]);
        mediaItemsRef.current = [];
        setHasMore(true);
        setTotalResults(0);
        void fetchMedia(0, filterType, activeQuery, true);
    }, [activeQuery, afterDate, beforeDate, channelId, effectiveSelectedChannelIds, filterType, guildId, nsfw, scope, selectedAuthors, selectedThreadIds, selectedTypes, sortOrder, threadChannelIds]);

    // After a page settles, the sentinel may still be on screen (short page, fast scroll, or a
    // filtered-down result set). The observer won't re-fire because intersection didn't change,
    // so re-evaluate once here. All the usual guards still apply inside loadNextPage.
    useEffect(() => {
        if (loading || loadingMore || error || !hasMore) return;
        const container = scrollContainerRef.current;
        if (!container) return;

        const remaining = container.scrollHeight - (container.scrollTop + container.clientHeight);
        if (remaining >= container.clientHeight) return;

        // Only continue automatically while the content still doesn't fill the viewport (the
        // genuinely stuck case this exists for) or the user is actively scrolling. Otherwise
        // leave the "Load More" button and let them ask — an idle gallery parked at the bottom
        // must not keep paging through the server on its own.
        const isScrollable = container.scrollHeight > container.clientHeight + 32;
        const scrolledRecently = Date.now() - lastUserScrollRef.current < 1200;
        if (isScrollable && !scrolledRecently) return;

        const timer = setTimeout(() => loadNextPageRef.current("auto"), AUTO_LOAD_COOLDOWN_MS);
        return () => clearTimeout(timer);
    }, [error, hasMore, loading, loadingMore, mediaItems.length]);

    // Keep one page ahead of the user at all times. When the current page settles, quietly warm
    // the next one into the cache so "Load More" / scrolling resolves instantly with no spinner.
    useEffect(() => {
        if (!prefetchNextPage) return;
        if (loading || loadingMore || error || !hasMore) return;
        if (mediaItems.length === 0) return;

        const target = resolveSearchTarget();
        if (!target) return;

        // Small delay so a burst of filter changes doesn't fire a prefetch per intermediate state.
        const timer = setTimeout(() => {
            SearchService.prefetchMedia(
                buildSearchParams(target, offset, filterType, activeQuery, embedOffsetRef.current)
            );
        }, 400);

        return () => clearTimeout(timer);
    }, [activeQuery, error, filterType, hasMore, loading, loadingMore, mediaItems.length, offset, prefetchNextPage]);

    useEffect(() => {
        const target = observerTargetRef.current;
        const root = scrollContainerRef.current;
        if (!target || !root || typeof IntersectionObserver === "undefined") return;

        const observer = new IntersectionObserver(
            entries => {
                if (entries[0]?.isIntersecting) loadNextPage("auto");
            },
            // 500px of pre-fetch margin was aggressive enough that a half-rendered masonry
            // column kept the sentinel inside the root. 250px still hides the load from the
            // user but needs real scrolling to trigger.
            { threshold: 0, root, rootMargin: "250px" }
        );

        observer.observe(target);
        return () => observer.disconnect();
    }, [activeQuery, error, filterType, hasMore, loading, loadingMore, mediaItems.length, offset]);

    const rateLimitState = SearchService.getRateLimitState();
    const retrySeconds = rateLimitState.isRateLimited ? Math.max(1, Math.ceil((rateLimitState.resetTimestamp - Date.now()) / 1000)) : 0;
    void rateLimitTick;

    const authorMenuOpen = authorSuggestions.length > 0 && !authorMenuDismissed;

    // Aspect ratios of media already on screen, so placeholder cards mimic the real content
    // instead of every fake tile being the same boring square.
    const recentRatios = React.useMemo(() => {
        const ratios: number[] = [];
        for (let i = mediaItems.length - 1; i >= 0 && ratios.length < 12; i--) {
            const { width, height } = mediaItems[i];
            if (width && height) ratios.push(width / height);
        }
        return ratios;
    }, [mediaItems]);

    const showSkeletons = skeletonPlaceholders && !error && (loading || loadingMore);
    // On a fresh query fill roughly a viewport; when appending, only show a page's worth.
    const skeletonCount = loading ? Math.min(PAGE_SIZE, 18) : Math.min(PAGE_SIZE, 8);


    const handleGalleryKeyDown = (e: React.KeyboardEvent) => {
        if (e.key !== "Escape") return;
        if (showChannelDropdown) {
            setShowChannelDropdown(false);
            return;
        }
        if (showThreadDropdown) {
            setShowThreadDropdown(false);
            return;
        }
        if (authorMenuOpen) {
            setAuthorMenuDismissed(true);
            return;
        }
        onClose?.();
    };

    const openGallerySettings = () => {
        // Vencord doesn't expose openPluginModal through @webpack/common, and userplugins can't
        // reliably import from @components/settings across forks/versions. Try the plugin modal
        // via the global Vencord object first (nicest: opens GalleryMode's own settings card),
        // then fall back to the Plugins settings tab.
        try {
            const vencord = (window as any).Vencord;
            const plugin = vencord?.Plugins?.plugins?.GalleryMode;
            const openPluginModal = vencord?.Components?.openPluginModal
                ?? vencord?.Util?.openPluginModal;

            if (plugin && typeof openPluginModal === "function") {
                openPluginModal(plugin);
                return;
            }
        } catch (err) {
            console.warn("[GalleryMode] Could not open the plugin modal directly.", err);
        }

        try {
            // Vencord registers its plugin list as the "vencord_plugins" entry, which the settings
            // router addresses as "<key>_panel". Older builds used the "VencordPlugins" section id.
            const router = SettingsRouter as any;
            if (typeof router?.openUserSettings === "function") {
                router.openUserSettings("vencord_plugins_panel");
            } else if (typeof router?.open === "function") {
                router.open("VencordPlugins");
            }
        } catch (err) {
            console.warn("[GalleryMode] Could not open Vencord plugin settings.", err);
        }
    };

    const keepFocusInsideGallery = () => {
        // Clicking bare overlay chrome would otherwise move focus to <body>, silently breaking
        // Esc-to-close until the user clicks a control again. Re-focus the container after any
        // click that didn't land on something focusable inside the gallery.
        window.setTimeout(() => {
            const container = containerRef.current;
            if (container && !container.contains(document.activeElement)) container.focus();
        }, 0);
    };

    const viewContent = (
        <div
            className={`gm-gallery-overlay-container gm-motion-${motion} gm-theme-${themeTone}`}
            ref={containerRef}
            tabIndex={-1}
            role="dialog"
            aria-label="Gallery Mode"
            onKeyDown={handleGalleryKeyDown}
            onMouseDown={keepFocusInsideGallery}
        >
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
                        {!!pinnedKey && (
                            <button
                                className="gm-scope-btn gm-resumed-pill"
                                onClick={() => setPinnedKey(null)}
                                title="Restored from before you jumped to a message. Click to switch to the channel you're viewing now."
                            >
                                ↩ Resumed · switch to current channel
                            </button>
                        )}
                        {/* Always rendered (just blank when empty) and given a fixed min-width, so
                            switching filters can't resize it and shove the whole header sideways.
                            The digits use tabular figures for the same reason: proportional digits
                            change width as the count ticks up during a load. */}
                        <span className="gm-count-badge">
                            {mediaItems.length > 0
                                ? `${mediaItems.length.toLocaleString()} loaded${totalResults > mediaItems.length ? ` of ${totalResults.toLocaleString()}` : ""}`
                                : ""}
                        </span>
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
                                {defaultScopeLabel}
                            </button>
                            {/* Only meaningful when the current channel is a thread/post, or the
                                user is viewing a forum/media channel that contains posts. */}
                            {!!guildId && !!threadHostId && (
                                <button
                                    className={`gm-scope-btn ${scope === "parent" ? "active" : ""}`}
                                    onClick={() => {
                                        setScope("parent");
                                        setShowChannelDropdown(false);
                                    }}
                                    title={`Choose which threads in #${threadHostChannel?.name || "this channel"} to search`}
                                >
                                    Selected Threads
                                </button>
                            )}
                            {!!guildId && (
                                <button className={`gm-scope-btn ${scope === "guild" ? "active" : ""}`} onClick={() => setScope("guild")}>
                                    Entire Server
                                </button>
                            )}
                        </div>

                        {!!guildId && scope === "parent" && (
                            <div className="gm-channel-select-wrap" ref={threadSelectRef}>
                                <button
                                    className={`gm-scope-btn gm-channel-select-btn ${selectedThreadIds.length > 0 ? "active" : ""}`}
                                    onClick={() => setShowThreadDropdown(value => !value)}
                                >
                                    🧵 {selectedThreadIds.length > 0 ? `${selectedThreadIds.length} Selected` : "Pick Threads"} ▼
                                </button>
                                {showThreadDropdown && (
                                    <div className="gm-channel-dropdown">
                                        <div className="gm-dropdown-title">
                                            Sub threads in #{threadHostChannel?.name || "channel"} ({siblingThreads.length})
                                        </div>
                                        {selectedThreadIds.length > 0 && (
                                            <button className="gm-dropdown-link" onClick={() => setSelectedThreadIds([])}>Clear selection (search all)</button>
                                        )}
                                        {siblingThreads.length === 0 ? (
                                            <div className="gm-dropdown-empty">
                                                No sub threads found yet. The search stays scoped to
                                                #{threadHostChannel?.name || "this channel"} in the meantime.
                                            </div>
                                        ) : siblingThreads.map((thread: any) => (
                                            <label key={thread.id} className="gm-channel-option">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedThreadIds.includes(thread.id)}
                                                    onChange={() => toggleThreadSelection(thread.id)}
                                                />
                                                <span>{thread.name || "Untitled thread"}</span>
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {!!guildId && scope === "guild" && (
                            <div className="gm-channel-select-wrap" ref={channelSelectRef}>
                                <button
                                    className={`gm-scope-btn gm-channel-select-btn ${effectiveSelectedChannelIds.length > 0 ? "active" : ""}`}
                                    onClick={() => {
                                        setShowChannelDropdown(value => !value);
                                        setChannelFilter("");
                                    }}
                                >
                                    # {effectiveSelectedChannelIds.length > 0 ? `${effectiveSelectedChannelIds.length} Selected` : "Select Channels"} ▼
                                </button>
                                {showChannelDropdown && (
                                    <div className="gm-channel-dropdown">
                                        <div className="gm-dropdown-title">
                                            Select Channels &amp; Threads ({channelCategories.reduce((total, category) => total + category.channels.length, 0)} shown)
                                        </div>
                                        <input
                                            type="text"
                                            className="gm-dropdown-filter"
                                            placeholder="Filter channels…"
                                            value={channelFilter}
                                            onChange={(e) => setChannelFilter(e.currentTarget.value)}
                                        />
                                        {effectiveSelectedChannelIds.length > 0 && (
                                            <button className="gm-dropdown-link" onClick={() => setSelectedChannelIds([])}>Clear selected channels</button>
                                        )}
                                        {guildChannels.length === 0 ? (
                                            <div className="gm-dropdown-empty">
                                                {channelFilter.trim()
                                                    ? "No channels or threads match that filter."
                                                    : "No searchable text, thread, forum, or media channels found in this server."}
                                            </div>
                                        ) : channelCategories.map(category => {
                                            const collapsed = collapsedCategories.includes(category.id);
                                            const selectedInCategory = category.channels.filter(
                                                (channel: any) => effectiveSelectedChannelIds.includes(channel.id)
                                            ).length;

                                            return (
                                                <div key={category.id} className="gm-channel-category">
                                                    <div className="gm-category-header">
                                                        <button
                                                            type="button"
                                                            className="gm-category-toggle"
                                                            onClick={() => toggleCategoryCollapsed(category.id)}
                                                            aria-expanded={!collapsed}
                                                            title={collapsed ? "Expand category" : "Collapse category"}
                                                        >
                                                            <span className={`gm-category-caret${collapsed ? " collapsed" : ""}`}>▾</span>
                                                            <span className="gm-category-name">{category.name}</span>
                                                            <span className="gm-category-count">
                                                                {selectedInCategory > 0
                                                                    ? `${selectedInCategory}/${category.channels.length}`
                                                                    : category.channels.length}
                                                            </span>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="gm-category-all"
                                                            onClick={() => toggleCategorySelection(category)}
                                                            title="Select or clear every channel in this category"
                                                        >
                                                            {selectedInCategory === category.channels.length ? "None" : "All"}
                                                        </button>
                                                    </div>

                                                    {!collapsed && category.channels.map((channel: any) => {
                                                        const thread = THREAD_CHANNEL_TYPES.has(channel.type);
                                                        return (
                                                            <label
                                                                key={channel.id}
                                                                className={`gm-channel-option${thread ? " gm-thread-option" : ""}`}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    checked={effectiveSelectedChannelIds.includes(channel.id)}
                                                                    onChange={() => toggleChannelSelection(channel.id)}
                                                                />
                                                                <span>{thread ? `🧵 ${channel.name}` : `#${channel.name}`}</span>
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div
                        className={`gm-filter-tabs${selectedTypes.length > 1 ? " gm-multi-select" : ""}`}
                        title="Click to pick one type — Shift or Ctrl click to combine several"
                    >
                        {(["all", "image", "video", "embed", "file", "audio"] as const).map(tab => {
                            const isMulti = selectedTypes.length > 1;
                            const active = isMulti ? selectedTypes.includes(tab) : filterType === tab;

                            return (
                                <button
                                    key={tab}
                                    className={`gm-tab-btn ${active ? "active" : ""}`}
                                    aria-pressed={active}
                                    onClick={(e) => toggleFilterTab(tab, e.shiftKey || e.ctrlKey || e.metaKey)}
                                >
                                    {tab.toUpperCase()}
                                </button>
                            );
                        })}
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

                    <div className="gm-header-actions">
                        <button className="gm-scope-btn gm-reset-btn" onClick={clearFilters} title="Clear search/filter/author/channel selections">Reset</button>

                        <button
                            className="gm-icon-btn"
                            onClick={openGallerySettings}
                            title="Open GalleryMode plugin settings"
                            aria-label="Open GalleryMode plugin settings"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d="M19.14 12.94a7.6 7.6 0 0 0 .06-.94 7.6 7.6 0 0 0-.06-.94l2.03-1.58a.48.48 0 0 0 .12-.61l-1.92-3.32a.48.48 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.73 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94 0 .31.02.63.06.94l-2.03 1.58a.48.48 0 0 0-.12.61l1.92 3.32c.12.22.38.3.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.04.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.03-1.58ZM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2Z" />
                            </svg>
                        </button>

                        {!!onClose && <button className="gm-close-btn" onClick={onClose} title="Exit Gallery Mode (Esc)">✕</button>}
                    </div>
                </div>

                <div className="gm-header-row gm-header-row-search">
                    <div className="gm-author-search-wrap">
                        {selectedAuthors.map(author => (
                            <span key={author.id} className="gm-channel-pill gm-author-pill" onClick={() => removeAuthorPill(author.id)} title="Click to remove author">
                                👤 {author.name} ✕
                            </span>
                        ))}

                        <div className="gm-author-input-wrap" ref={authorInputRef}>
                            <input
                                type="text"
                                className="gm-search-input gm-author-input"
                                placeholder="Add author @name..."
                                value={authorQuery}
                                onChange={(e) => {
                                    setAuthorQuery(e.currentTarget.value);
                                    setAuthorMenuDismissed(false);
                                }}
                                onKeyDown={(e) => {
                                    // Enter instantly picks the top suggestion instead of requiring a click.
                                    if (e.key === "Enter" && authorMenuOpen && authorSuggestions[0]) {
                                        e.preventDefault();
                                        addAuthorPill(authorSuggestions[0]);
                                    }
                                }}
                            />

                            {authorMenuOpen && (
                                <div className="gm-author-suggestions">
                                    {authorSuggestions.map((user: any) => (
                                        <button key={user.id} className="gm-author-suggestion" onClick={() => addAuthorPill(user)}>
                                            <span>{user.globalName || user.global_name || user.username}</span>
                                            <small>@{user.username}</small>
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
                        {!!searchQuery && (
                            <button type="button" className="gm-search-clear-btn" onClick={() => { setSearchQuery(""); setActiveQuery(""); }}>×</button>
                        )}
                        <button type="submit" className="gm-search-submit-btn">Search</button>
                    </form>

                    <div className="gm-date-range-wrap" title="Only show media sent within this date range">
                        <input
                            type="date"
                            className="gm-date-input"
                            aria-label="Media sent on or after this date"
                            value={afterDate}
                            max={beforeDate || undefined}
                            onChange={(e) => setAfterDate(e.currentTarget.value)}
                        />
                        <span className="gm-date-separator">→</span>
                        <input
                            type="date"
                            className="gm-date-input"
                            aria-label="Media sent on or before this date"
                            value={beforeDate}
                            min={afterDate || undefined}
                            onChange={(e) => setBeforeDate(e.currentTarget.value)}
                        />
                    </div>

                    <button
                        className={`gm-scope-btn gm-sort-btn ${sortOrder === "asc" ? "active" : ""}`}
                        onClick={() => setSortOrder(order => order === "desc" ? "asc" : "desc")}
                        title="Toggle between newest-first and oldest-first results"
                    >
                        {sortOrder === "desc" ? "↓ Newest" : "↑ Oldest"}
                    </button>
                </div>
            </div>

            {rateLimitState.isRateLimited && (
                <div className="gm-rate-limit-banner">
                    ⚠️ Discord Search is throttling requests. Retrying in {retrySeconds}s…
                </div>
            )}

            <div className="gm-gallery-content" ref={scrollContainerRef} onScroll={handleScroll}>
                {error && !loading && (
                    <div className="gm-error-state">
                        <div className="gm-empty-title">Couldn’t load media</div>
                        <p>{error}</p>
                        <button className="gm-action-btn primary" onClick={() => void fetchMedia(0, filterType, activeQuery, true)}>Retry Query</button>
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

                {/* The grid stays mounted across loads. A fresh query paints placeholder cards in
                    the same shape as the results, and appended pages add placeholders at the end,
                    so the layout never collapses to an empty "Loading…" screen. */}
                {(mediaItems.length > 0 || showSkeletons) && !error && (
                    layout === "masonry" ? (
                        <MasonryGrid
                            items={loading ? [] : mediaItems}
                            columnWidth={parseInt(cardMinWidth, 10) || 240}
                            renderItem={item => (
                                <MediaCard
                                    key={item.id}
                                    item={item}
                                    onCloseGallery={onClose}
                                    onBeforeJump={handleBeforeJump}
                                />
                            )}
                            trailing={showSkeletons ? <SkeletonGrid count={skeletonCount} ratios={recentRatios} /> : null}
                        />
                    ) : (
                        <div
                            className="gm-media-grid"
                            style={{ "--gm-card-min-width": cardMinWidth, "--gm-col-width": cardMinWidth } as React.CSSProperties}
                        >
                            {!loading && mediaItems.map(item => (
                                <MediaCard
                                    key={item.id}
                                    item={item}
                                    onCloseGallery={onClose}
                                    onBeforeJump={handleBeforeJump}
                                />
                            ))}
                            {showSkeletons && (
                                <SkeletonGrid count={skeletonCount} ratios={recentRatios} />
                            )}
                        </div>
                    )
                )}

                {loading && !skeletonPlaceholders && (
                    <div className="gm-loading-state">
                        <div className="gm-spinner-icon gm-spinner-large" />
                        <p>Querying Discord Search…</p>
                    </div>
                )}

                <div ref={observerTargetRef} className="gm-scroll-sentinel">
                    {loadingMore && !skeletonPlaceholders && (
                        <div className="gm-infinite-spinner-wrapper">
                            <div className="gm-spinner-icon" />
                            <span>Loading more media…</span>
                        </div>
                    )}
                    {!loading && !loadingMore && !error && mediaItems.length > 0 && hasMore && (
                        <button className="gm-load-more-btn" onClick={() => loadNextPage("manual")}>Load More</button>
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
