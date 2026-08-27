import { openImageModal, openUserProfile } from "@utils/discord";
import { copyToClipboard } from "@utils/clipboard";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { ContextMenuApi, Menu, NavigationRouter, React, showToast, Toasts, useState } from "@webpack/common";
import { settings } from "../settings";
import { MediaItem } from "../types";
import { ICON_PATHS } from "./iconData";

function isDiscordCdnHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    return host === "cdn.discordapp.com" || host === "media.discordapp.net" || host.endsWith(".discordapp.net");
}

/**
 * Ask Discord's media proxy for a still frame of an animated image. media.discordapp.net honours
 * `format=webp` + `animated=false`; anything it doesn't recognise is returned unchanged, and a
 * non-proxy URL is passed through untouched.
 *
 * `allowCdn` (lightweight mode) extends the same treatment to cdn.discordapp.com attachment
 * URLs, which are fronted by the same media pipeline. If an edge case rejects the transform,
 * the card's retry-once fallback restores the untouched URL rather than erroring out.
 */
function staticFrameUrl(url: string | undefined, allowCdn = false): string | undefined {
    if (!url) return url;
    try {
        const parsed = new URL(url);
        if (parsed.hostname !== "media.discordapp.net" && !(allowCdn && isDiscordCdnHost(parsed.hostname))) return url;
        parsed.searchParams.set("format", "webp");
        parsed.searchParams.set("animated", "false");
        return parsed.toString();
    } catch {
        return url;
    }
}

type PerformanceProfile = "pretty" | "balanced" | "lightweight";
type PreviewBehavior = "auto" | "animated" | "hover" | "static";
type ThumbnailQuality = "auto" | "original" | "720" | "480" | "320";
type CardChrome = "full" | "compact" | "minimal";

function resolvePreviewBehavior(profile: PerformanceProfile, behavior: PreviewBehavior): Exclude<PreviewBehavior, "auto"> {
    if (behavior && behavior !== "auto") return behavior;
    if (profile === "lightweight") return "static";
    if (profile === "pretty") return "animated";
    return "hover";
}

function resolveThumbnailSize(profile: PerformanceProfile, quality: ThumbnailQuality): number | null {
    if (quality === "original") return null;
    if (quality === "720" || quality === "480" || quality === "320") return Number(quality);
    if (profile === "lightweight") return 480;
    return null;
}

function CardIcon({ name, size = 14 }: { name: "copy" | "jump"; size?: number; }) {
    const paths = ICON_PATHS[name];
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            {paths.map((d, index) => <path key={index} d={d} />)}
        </svg>
    );
}

/**
 * Ask Discord's CDN for a downscaled rendition of an image. Width/height parameters are
 * honoured by the same media proxy pipeline that serves attachment and embed URLs, so a
 * low-end gallery decodes tens of KB per card instead of multi-megabyte originals.
 * Non-Discord URLs pass through untouched.
 */
function downscaledThumbUrl(url: string, size: number): string {
    try {
        const parsed = new URL(url);
        if (!isDiscordCdnHost(parsed.hostname)) return url;
        parsed.searchParams.set("width", String(size));
        parsed.searchParams.set("height", String(size));
        return parsed.toString();
    } catch {
        return url;
    }
}

function copyWithToast(text: string, toastMsg = "Copied to clipboard!") {
    void copyToClipboard(text)
        .then(() => showToast(toastMsg, Toasts.Type.SUCCESS))
        .catch(() => showToast("Failed to copy", Toasts.Type.FAILURE));
}

async function downloadMedia(url: string, fallbackName: string) {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = fallbackName || "media";
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Revoking immediately can abort the download before the browser has finished reading
        // the blob, which showed up as silently truncated files for larger media. Defer it.
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        showToast("Downloaded media", Toasts.Type.SUCCESS);
    } catch (err) {
        console.warn("[GalleryMode] Download failed:", err);
        showToast("Download failed — open in browser to save", Toasts.Type.FAILURE);
    }
}

interface MediaCardProps {
    item: MediaItem;
    onCloseGallery?: () => void;
    /** Called immediately before navigating away, so the gallery can snapshot its state. */
    onBeforeJump?: () => void;
    /** Full overlay closes on jump; docked galleries stay open beside chat. */
    closeOnJump?: boolean;
    /** Temporarily pause hover previews while the parent gallery is actively scrolling. */
    previewsPaused?: boolean;
}

function formatDate(isoString?: string) {
    if (!isoString) return "";
    try {
        const date = new Date(isoString);
        return date.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined
        });
    } catch {
        return "";
    }
}

function formatSize(bytes?: number) {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function avatarUrl(item: MediaItem) {
    const avatar = item.author.avatar;
    if (!avatar) return null;
    const ext = avatar.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${item.author.id}/${avatar}.${ext}?size=64`;
}

function isCspSafeMediaUrl(url?: string): url is string {
    if (!url) return false;
    if (url.startsWith("blob:") || url.startsWith("data:")) return true;

    try {
        const host = new URL(url).hostname.toLowerCase();
        return host === "cdn.discordapp.com" || host === "media.discordapp.net" || host.endsWith(".discordapp.net");
    } catch {
        return false;
    }
}

function firstSafeMediaUrl(...urls: Array<string | undefined>) {
    return urls.find(isCspSafeMediaUrl);
}

function isLikelyImageUrl(url?: string) {
    return !!url && /\.(png|jpe?g|webp|gif|avif|bmp)(\?|$)/i.test(url);
}

function openExternal(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
}

function MediaViewerModal({ item, modalProps }: { item: MediaItem; modalProps: any; }) {
    const src = firstSafeMediaUrl(item.proxyUrl, item.url);
    const title = item.filename || item.embedTitle || "Media Preview";

    React.useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            const key = e.key.toLowerCase();
            if (key === "c" && !e.altKey) {
                copyWithToast(item.url, "Copied media link!");
            } else if (key === "d" && !e.ctrlKey && !e.metaKey && !e.altKey) {
                downloadMedia(item.url, item.filename || "media");
            } else if (key === "o" && !e.ctrlKey && !e.metaKey && !e.altKey) {
                openExternal(item.url);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [item]);

    return (
        <ModalRoot {...modalProps} size={ModalSize.DYNAMIC} className="gm-modal-root">
            <ModalHeader className="gm-modal-header">
                <div className="gm-modal-title" title={title}>{title}</div>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent className="gm-modal-content">
                {item.type === "video" && src ? (
                    <video className="gm-modal-media" src={src} poster={isLikelyImageUrl(item.thumbnailUrl) ? item.thumbnailUrl : undefined} controls autoPlay playsInline />
                ) : item.type === "audio" && src ? (
                    <div className="gm-modal-file-shell">
                        <div className="gm-modal-file-icon">🎵</div>
                        <div className="gm-modal-file-name">{title}</div>
                        <audio className="gm-modal-audio" src={src} controls autoPlay />
                    </div>
                ) : item.type === "file" ? (
                    <div className="gm-modal-file-shell">
                        <div className="gm-modal-file-icon">📄</div>
                        <div className="gm-modal-file-name">{title}</div>
                        <div className="gm-modal-file-meta">{item.fileExtension || "FILE"}{item.fileSize ? ` • ${formatSize(item.fileSize)}` : ""}</div>
                    </div>
                ) : src ? (
                    <img className="gm-modal-media" src={src} alt={title} />
                ) : (
                    <div className="gm-modal-file-shell">
                        <div className="gm-modal-file-icon">↗️</div>
                        <div className="gm-modal-file-name">External preview blocked by Discord CSP</div>
                        <div className="gm-modal-file-meta">Open the original link to view this media.</div>
                    </div>
                )}
                <div className="gm-modal-actions">
                    <button className="gm-action-btn primary" onClick={() => copyWithToast(item.url, "Copied media link!")}>Copy Link</button>
                    <button className="gm-action-btn secondary" onClick={() => downloadMedia(item.url, item.filename || "media")}>Download</button>
                    <button className="gm-action-btn secondary" onClick={() => openExternal(item.url)}>Open Original</button>
                </div>
            </ModalContent>
        </ModalRoot>
    );
}

function MediaCardImpl({ item, onCloseGallery, onBeforeJump, closeOnJump = true, previewsPaused = false }: MediaCardProps) {
    const [mediaLoaded, setMediaLoaded] = useState<boolean>(false);
    const [hasError, setHasError] = useState<boolean>(false);
    const [copySuccess, setCopySuccess] = useState<boolean>(false);
    const [hovered, setHovered] = useState<boolean>(false);

    const { performanceProfile, previewBehavior, thumbnailQuality, respectSpoilers, blurNsfwChannels, cardChrome } =
        settings.use([
            "performanceProfile", "previewBehavior", "thumbnailQuality",
            "respectSpoilers", "blurNsfwChannels", "cardChrome"
        ]);

    const profile = (performanceProfile || "balanced") as PerformanceProfile;
    const effectivePreview = resolvePreviewBehavior(profile, (previewBehavior || "auto") as PreviewBehavior);
    const thumbnailSize = resolveThumbnailSize(profile, (thumbnailQuality || "auto") as ThumbnailQuality);
    const chrome = (cardChrome || "full") as CardChrome;
    const showMetaOverlay = chrome !== "minimal";
    const showAuthorFooter = chrome === "full";

    const shouldBlur = (respectSpoilers !== false && item.isSpoiler) || (blurNsfwChannels === true && item.isNsfwChannel);
    const [revealed, setRevealed] = useState<boolean>(false);
    const isHidden = shouldBlur && !revealed;

    const videoRef = React.useRef<HTMLVideoElement>(null);

    /**
     * Images served from Discord's CDN are frequently already in the HTTP/memory cache, in which
     * case the browser fires `load` before React has attached onLoad. The handler then never runs,
     * `mediaLoaded` stays false and the element is stuck at opacity 0 — an invisible card. Any
     * repaint (such as hovering) made it appear, which is exactly the symptom.
     *
     * A ref callback runs synchronously on mount, so we can catch the already-complete case.
     * `naturalWidth > 0` distinguishes a genuinely decoded image from a broken one.
     */
    const imgRef = React.useRef<HTMLImageElement | null>(null);

    const markLoadedIfComplete = React.useCallback((img: HTMLImageElement | null) => {
        imgRef.current = img;
        if (img?.complete && img.naturalWidth > 0) setMediaLoaded(true);
    }, []);

    /**
     * Safety net for the "image stays blank until I hover it" class of bug.
     *
     * Between `loading="lazy"`, `content-visibility: auto` and compositor layer promotion,
     * Chromium can end up with an image that is fetched but never painted, or whose `load`
     * event we missed. Once the card scrolls into view we explicitly poll `complete` and, if
     * needed, call decode() — both are cheap no-ops for an image that is already fine.
     */
    React.useEffect(() => {
        if (mediaLoaded || hasError) return;
        const img = imgRef.current;
        if (!img || typeof IntersectionObserver === "undefined") return;

        const observer = new IntersectionObserver(entries => {
            if (!entries[0]?.isIntersecting) return;

            if (img.complete && img.naturalWidth > 0) {
                setMediaLoaded(true);
                return;
            }
            // decode() resolves once the bitmap is ready, covering the case where `load`
            // fired before React attached its handler.
            img.decode?.()
                .then(() => setMediaLoaded(true))
                .catch(() => { /* still loading, or genuinely broken; onError handles it */ });
        }, { rootMargin: "200px" });

        observer.observe(img);
        return () => observer.disconnect();
    }, [mediaLoaded, hasError, item.id]);

    // Hover-driven playback. Autoplay attributes alone can't express "play on hover", and
    // toggling the `src` would re-download the file, so we drive the element imperatively.
    React.useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        // Low-end/static mode never plays inline previews — the poster frame is all we render.
        const mode = effectivePreview === "static" ? "click" : "hover";
        const shouldPlay = !previewsPaused && !isHidden && mode === "hover" && hovered;

        if (shouldPlay) {
            void video.play().catch(() => { /* autoplay can be refused; harmless */ });
        } else {
            video.pause();
            // Rewind so the next hover starts from the beginning rather than mid-clip.
            if (mode === "hover" && !hovered) video.currentTime = 0;
        }
    }, [hovered, isHidden, effectivePreview, previewsPaused]);

    const jumpToMessage = () => {
        if (!item.channelId || !item.messageId) return;
        // Snapshot the gallery BEFORE navigating. transitionTo changes the selected channel,
        // which re-keys the gallery's session to the destination — so anything saved after this
        // point would land under the wrong key and the user's query/scope would be lost.
        onBeforeJump?.();
        NavigationRouter.transitionTo(`/channels/${item.guildId || "@me"}/${item.channelId}/${item.messageId}`);
        if (closeOnJump) onCloseGallery?.();
    };

    const handleJumpToMessage = (e: React.MouseEvent) => {
        e.stopPropagation();
        jumpToMessage();
    };

    const openAuthorProfile = () => {
        if (!item.author.id) return;
        // openUserProfile() throws when the user cannot be resolved (e.g. deleted account or not
        // cached yet). Guard against the unhandled promise rejection that would otherwise surface.
        openUserProfile(item.author.id).catch(() => {
            console.warn("[GalleryMode] Could not open author profile for", item.author.id);
        });
    };

    const handleOpenAuthorProfile = (e: React.MouseEvent) => {
        e.stopPropagation();
        openAuthorProfile();
    };

    const copyMediaLink = () => {
        copyWithToast(item.url, "Copied media link!");
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 1500);
    };

    const handleCardClick = () => {
        const previewUrl = firstSafeMediaUrl(item.proxyUrl, item.url);

        // Drop focus from the card before handing off to Discord's image modal. The modal marks
        // the page behind it aria-hidden; if our card still holds focus inside that subtree,
        // Chromium logs "Blocked aria-hidden on an element because its descendant retained
        // focus". Blurring first keeps the accessibility tree valid and silences the warning.
        try {
            (document.activeElement as HTMLElement | null)?.blur?.();
        } catch {
            // Non-fatal; the modal still opens.
        }

        if ((item.type === "image" || item.type === "gif" || item.type === "embed") && previewUrl) {
            try {
                // Current Vencord signature: openImageModal(item, props?) where item carries url/original/dimensions.
                openImageModal({
                    url: previewUrl,
                    original: item.url,
                    width: item.width || 1280,
                    height: item.height || 720
                });
                return;
            } catch (err) {
                console.warn("[GalleryMode] Discord image modal failed; falling back to custom media modal.", err);
            }
        }

        if (!previewUrl && item.type !== "file") {
            openExternal(item.url);
            return;
        }

        openModal((modalProps: any) => <MediaViewerModal item={item} modalProps={modalProps} />);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const closeMenu = ContextMenuApi.closeContextMenu || ContextMenuApi.close;
        const openMenu = ContextMenuApi.openContextMenu || ContextMenuApi.openContextMenuLazy || ContextMenuApi.open;

        if (typeof openMenu === "function") {
            openMenu(e, () => (
                <Menu.Menu navId="gm-card-context-menu" onClose={closeMenu}>
                    <Menu.MenuItem id="gm-open" label="Open Preview" action={handleCardClick} />
                    <Menu.MenuItem id="gm-jump" label="Jump to Message" action={jumpToMessage} />
                    <Menu.MenuItem id="gm-copy-link" label="Copy Media Link" action={copyMediaLink} />
                    <Menu.MenuItem id="gm-download" label="Download Media" action={() => downloadMedia(item.url, item.filename || "media")} />
                    <Menu.MenuItem id="gm-open-browser" label="Open Original in Browser" action={() => openExternal(item.url)} />
                    <Menu.MenuItem id="gm-author-profile" label={`View @${item.author.username}'s Profile`} action={openAuthorProfile} />
                    {/* MUST be a boolean guard. item.content is a string, so `item.content && ...`
                        evaluates to "" for an empty message — and Discord's Menu API rejects
                        string children with "Menu API only allows Items and groups of Items as
                        children", which crashes the whole menu subtree. */}
                    {!!item.content && (
                        <Menu.MenuItem id="gm-copy-text" label="Copy Message Text" action={() => copyWithToast(item.content!, "Copied message text!")} />
                    )}
                </Menu.Menu>
            ));
        }
    };

    const rawDisplaySrc = firstSafeMediaUrl(item.thumbnailUrl, item.proxyUrl, item.type === "image" || item.type === "gif" ? item.url : undefined);

    // GIF playback control. Discord's media proxy renders a still frame when the request asks for
    // a non-animated format, so "static until hover/open" is a URL tweak rather than a JS pause.
    const gifMode = effectivePreview === "animated" ? "always" : effectivePreview === "hover" ? "hover" : "click";
    const wantsStaticGif = item.type === "gif"
        && (gifMode === "click" || (gifMode === "hover" && (!hovered || previewsPaused)) || isHidden);
    const transformedSrc = (() => {
        if (!rawDisplaySrc) return rawDisplaySrc;
        let next = (wantsStaticGif ? staticFrameUrl(rawDisplaySrc, true) : rawDisplaySrc) || rawDisplaySrc;
        if (thumbnailSize) next = downscaledThumbUrl(next, thumbnailSize);
        return next;
    })();

    // If a URL transform (static GIF frame, thumbnail downscale) is rejected by the CDN, retry the
    // card once with the untouched URL before showing the error placeholder. This keeps the
    // transforms safe to apply even on payloads they were never exercised against.
    const [retriedOriginal, setRetriedOriginal] = useState<boolean>(false);
    const displaySrc = retriedOriginal ? rawDisplaySrc : transformedSrc;

    const handleMediaError = () => {
        if (!retriedOriginal && transformedSrc && transformedSrc !== rawDisplaySrc) {
            setRetriedOriginal(true);
            setMediaLoaded(false);
            return;
        }
        setMediaLoaded(true);
        setHasError(true);
    };

    const videoSrc = item.type === "video" ? firstSafeMediaUrl(item.proxyUrl, item.url) : undefined;
    const typeLabel = (item.type || "file").toUpperCase();
    const avatar = avatarUrl(item);

    // Reserve the final box before the bytes arrive. Discord's search payload already tells us the
    // natural width/height of attachments and most embeds, so masonry can pin the exact aspect
    // ratio up front instead of letting each card grow from 0px to its real height as images
    // decode — that growth is what makes the masonry grid "spaz out" and re-trigger infinite scroll.
    //
    // The ratio is published as a CSS custom property rather than an inline `aspect-ratio`:
    // inline styles outrank every stylesheet rule, so setting it directly leaked masonry's
    // variable heights into the uniform grid layout. As a variable, each layout decides for
    // itself whether to consume it (masonry does; grid keeps its 1:1 tiles).
    const naturalRatio = item.width && item.height ? item.width / item.height : undefined;
    const previewStyle = naturalRatio
        // Clamp to the same bounds the CSS enforces (max-height: 72vh) so a 1x5000 image can't
        // create a mile-tall column.
        ? { "--gm-item-ratio": `${Math.min(Math.max(naturalRatio, 0.4), 3)}` } as React.CSSProperties
        : undefined;

    return (
        <div
            className={`gm-media-card${isHidden ? " gm-media-card-hidden" : ""}`}
            onClick={handleCardClick}
            onContextMenu={handleContextMenu}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            role="button"
            tabIndex={0}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleCardClick();
                }
            }}
        >
            <div
                className="gm-media-preview-wrapper"
                style={previewStyle}
            >
                {showMetaOverlay && <div className={`gm-type-badge ${item.type}`}>{typeLabel}</div>}

                {isHidden && (
                    <div
                        className="gm-spoiler-veil"
                        onClick={(e) => {
                            // Reveal in place; don't also open the full preview modal.
                            e.stopPropagation();
                            setRevealed(true);
                        }}
                    >
                        <span className="gm-spoiler-label">
                            {item.isSpoiler ? "SPOILER" : "AGE-RESTRICTED"}
                        </span>
                        <span className="gm-spoiler-hint">Click to reveal</span>
                    </div>
                )}

                {item.type === "file" || item.type === "audio" ? (
                    <div className="gm-file-card-preview">
                        <div className="gm-file-ext-badge">{item.fileExtension || (item.type === "audio" ? "AUDIO" : "FILE")}</div>
                        <div className="gm-file-icon-circle">{item.type === "audio" ? "🎵" : "📄"}</div>
                        <div className="gm-file-name-text">{item.filename || "Attachment File"}</div>
                        {!!item.fileSize && <div className="gm-file-size-badge">{formatSize(item.fileSize)}</div>}
                    </div>
                ) : hasError ? (
                    <div className="gm-file-card-preview">
                        <div className="gm-file-icon-circle">⚠️</div>
                        <div className="gm-file-name-text">Preview Unavailable</div>
                        <div className="gm-file-size-badge">Click to open the original media</div>
                    </div>
                ) : item.type === "video" && videoSrc ? (
                    <div style={{ position: "relative", width: "100%", height: "100%" }}>
                        {!mediaLoaded && (
                            <div className="gm-media-skeleton">
                                <div className="gm-spinner-icon" />
                            </div>
                        )}
                        <video
                            ref={videoRef}
                            src={videoSrc}
                            poster={isLikelyImageUrl(item.thumbnailUrl) ? item.thumbnailUrl : undefined}
                            preload={effectivePreview === "static" ? "none" : "metadata"}
                            muted
                            loop
                            playsInline
                            className={`gm-media-element ${mediaLoaded ? "loaded" : ""}`}
                            onLoadedMetadata={() => setMediaLoaded(true)}
                            onLoadedData={() => setMediaLoaded(true)}
                            onCanPlay={() => setMediaLoaded(true)}
                            onError={() => {
                                setMediaLoaded(true);
                                setHasError(true);
                            }}
                        />
                        <div className="gm-video-play-overlay">
                            <div className="gm-play-button-circle">▶</div>
                        </div>
                    </div>
                ) : !displaySrc ? (
                    <div className="gm-file-card-preview">
                        <div className="gm-file-icon-circle">↗️</div>
                        <div className="gm-file-name-text">External Preview</div>
                        <div className="gm-file-size-badge">Click to open original</div>
                    </div>
                ) : (
                    <>
                        {!mediaLoaded && (
                            <div className="gm-media-skeleton">
                                <div className="gm-spinner-icon" />
                            </div>
                        )}
                        {/* `loading="lazy"` is back, but the two things that previously broke it
                            are gone: the blur filter no longer sits on every image, and cards are
                            no longer each promoted to their own compositor layer. Without lazy,
                            opening a 600-card gallery kicks off 600 simultaneous CDN fetches,
                            which starves the visible ones — that made the hover symptom worse,
                            not better. */}
                        <img
                            ref={markLoadedIfComplete}
                            loading="lazy"
                            src={displaySrc}
                            alt={item.filename || item.embedTitle || "Media"}
                            className={`gm-media-element ${mediaLoaded ? "loaded" : ""}`}
                            width={item.width}
                            height={item.height}
                            decoding="async"
                            onLoad={() => setMediaLoaded(true)}
                            onError={handleMediaError}
                        />
                    </>
                )}

                {showMetaOverlay && item.timestamp && (
                    <div className="gm-card-date-badge-bottom-right">{formatDate(item.timestamp)}</div>
                )}

                <div className="gm-card-actions-overlay">
                    <button
                        className="gm-action-btn primary gm-action-icon"
                        onClick={handleJumpToMessage}
                        title="Jump to Message in Chat"
                        aria-label="Jump to Message in Chat"
                    >
                        <CardIcon name="jump" size={14} />
                    </button>
                    <button
                        className="gm-action-btn secondary gm-action-icon"
                        onClick={(e) => {
                            e.stopPropagation();
                            copyMediaLink();
                        }}
                        title="Copy media link"
                        aria-label="Copy media link"
                    >
                        <CardIcon name="copy" size={14} />
                    </button>
                </div>
            </div>

            {showAuthorFooter && (
            <div className="gm-card-footer" onClick={handleOpenAuthorProfile} title="View Author Profile">
                {avatar ? (
                    <img className="gm-author-avatar" src={avatar} alt={item.author.username} />
                ) : (
                    <div className="gm-author-avatar gm-author-avatar-fallback">
                        {(item.author.username || "?").charAt(0).toUpperCase()}
                    </div>
                )}
                <div className="gm-author-details">
                    <div className="gm-author-name-row">
                        <span className="gm-author-name">{item.author.globalName || item.author.username}</span>
                        {item.author.bot && <span className="gm-bot-badge">BOT</span>}
                    </div>
                    <span className="gm-author-username">@{item.author.username}</span>
                </div>
            </div>
            )}

            {copySuccess && <div className="gm-copy-toast">Copied!</div>}
        </div>
    );
}

// Memoized so gallery-level re-renders (typing in the search box, the rate-limit
// tick, badge updates, …) don't re-render hundreds of cards that didn't change.
// Items keep referential identity across pagination thanks to deduplicateItems().
//
// NOTE: the memo wrapper is created lazily on first render, not at module scope.
// Vencord's @webpack/common exports (React included) are still undefined while
// plugin modules are being evaluated, so calling React.memo() at the top level
// crashes the whole Vencord bundle before it can boot.
let MemoizedMediaCard: React.ComponentType<MediaCardProps> | null = null;

export function MediaCard(props: MediaCardProps) {
    MemoizedMediaCard ??= React.memo(MediaCardImpl);
    return <MemoizedMediaCard {...props} />;
}
