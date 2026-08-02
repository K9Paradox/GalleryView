import { openImageModal, openUserProfile } from "@utils/discord";
import { copyToClipboard } from "@utils/clipboard";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { ContextMenuApi, Menu, NavigationRouter, React, showToast, Toasts, useState } from "@webpack/common";
import { MediaItem } from "../types";

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
        URL.revokeObjectURL(objectUrl);
        showToast("Downloaded media", Toasts.Type.SUCCESS);
    } catch (err) {
        console.warn("[GalleryMode] Download failed:", err);
        showToast("Download failed — open in browser to save", Toasts.Type.FAILURE);
    }
}

interface MediaCardProps {
    item: MediaItem;
    onCloseGallery?: () => void;
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

function MediaCardImpl({ item, onCloseGallery }: MediaCardProps) {
    const [mediaLoaded, setMediaLoaded] = useState<boolean>(false);
    const [hasError, setHasError] = useState<boolean>(false);
    const [copySuccess, setCopySuccess] = useState<boolean>(false);

    const jumpToMessage = () => {
        if (!item.channelId || !item.messageId) return;
        NavigationRouter.transitionTo(`/channels/${item.guildId || "@me"}/${item.channelId}/${item.messageId}`);
        onCloseGallery?.();
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
                    {item.content && (
                        <Menu.MenuItem id="gm-copy-text" label="Copy Message Text" action={() => copyWithToast(item.content!, "Copied message text!")} />
                    )}
                </Menu.Menu>
            ));
        }
    };

    const displaySrc = firstSafeMediaUrl(item.thumbnailUrl, item.proxyUrl, item.type === "image" || item.type === "gif" ? item.url : undefined);
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
            className="gm-media-card"
            onClick={handleCardClick}
            onContextMenu={handleContextMenu}
            role="button"
            tabIndex={0}
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
                <div className={`gm-type-badge ${item.type}`}>{typeLabel}</div>

                {item.type === "file" || item.type === "audio" ? (
                    <div className="gm-file-card-preview">
                        <div className="gm-file-ext-badge">{item.fileExtension || (item.type === "audio" ? "AUDIO" : "FILE")}</div>
                        <div className="gm-file-icon-circle">{item.type === "audio" ? "🎵" : "📄"}</div>
                        <div className="gm-file-name-text">{item.filename || "Attachment File"}</div>
                        {item.fileSize && <div className="gm-file-size-badge">{formatSize(item.fileSize)}</div>}
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
                            src={videoSrc}
                            poster={isLikelyImageUrl(item.thumbnailUrl) ? item.thumbnailUrl : undefined}
                            preload="metadata"
                            muted
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
                        <img
                            src={displaySrc}
                            alt={item.filename || item.embedTitle || "Media"}
                            className={`gm-media-element ${mediaLoaded ? "loaded" : ""}`}
                            width={item.width}
                            height={item.height}
                            loading="lazy"
                            decoding="async"
                            onLoad={() => setMediaLoaded(true)}
                            onError={() => {
                                setMediaLoaded(true);
                                setHasError(true);
                            }}
                        />
                    </>
                )}

                {item.timestamp && <div className="gm-card-date-badge-bottom-right">{formatDate(item.timestamp)}</div>}

                <div className="gm-card-actions-overlay">
                    <button className="gm-action-btn primary" onClick={handleJumpToMessage} title="Jump to Message in Chat">Jump ➔</button>
                    <button
                        className="gm-action-btn secondary"
                        onClick={(e) => {
                            e.stopPropagation();
                            copyMediaLink();
                        }}
                        title="Copy Link"
                    >
                        📋
                    </button>
                </div>
            </div>

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
