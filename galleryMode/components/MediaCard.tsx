import { copyToClipboard } from "@utils/clipboard";
import { openImageModal, openUserProfile } from "@utils/discord";
import { openMediaModal } from "@utils/modal";
import { ContextMenuApi, Menu, NavigationRouter, React, useState } from "@webpack/common";
import { MediaItem } from "../types";

interface MediaCardProps {
    item: MediaItem;
    onCloseGallery?: () => void;
}

export const MediaCard: React.FC<MediaCardProps> = ({ item, onCloseGallery }) => {
    const [mediaLoaded, setMediaLoaded] = useState<boolean>(false);
    const [hasError, setHasError] = useState<boolean>(false);
    const [copySuccess, setCopySuccess] = useState<boolean>(false);

    // Format date string (e.g., "May 18" or "May 18, 2023")
    const formatDate = (isoString?: string) => {
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
    };

    // Format file size
    const formatSize = (bytes?: number) => {
        if (!bytes) return "";
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    // Navigation trigger: Jump directly to message in chat
    const handleJumpToMessage = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (item.guildId && item.channelId && item.messageId) {
            NavigationRouter.transitionTo(`/channels/${item.guildId}/${item.channelId}/${item.messageId}`);
            if (onCloseGallery) {
                onCloseGallery();
            }
        }
    };

    // Open author's Discord user profile modal
    const handleOpenAuthorProfile = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (item.author.id) {
            openUserProfile(item.author.id);
        }
    };

    // Open media natively inside Discord UI modal (No external browser redirection!)
    const handleCardClick = () => {
        const previewUrl = item.proxyUrl || item.url;

        if (item.type === "video") {
            // Open video directly in Discord's native media player modal
            try {
                if (typeof openMediaModal === "function") {
                    openMediaModal({
                        items: [{
                            type: "VIDEO",
                            url: previewUrl,
                            original: item.url,
                            width: item.width || 1280,
                            height: item.height || 720
                        }]
                    });
                } else {
                    openImageModal({
                        url: previewUrl,
                        original: item.url,
                        width: item.width || 1280,
                        height: item.height || 720
                    });
                }
            } catch (err) {
                console.error("[GalleryMode] Video modal error:", err);
                openImageModal({
                    url: previewUrl,
                    original: item.url,
                    width: item.width || 1280,
                    height: item.height || 720
                });
            }
        } else if (item.type === "image" || item.type === "gif" || item.type === "embed") {
            openImageModal({
                url: previewUrl,
                original: item.url,
                width: item.width || 1280,
                height: item.height || 720
            });
        } else {
            window.open(item.url, "_blank");
        }
    };

    // Context Menu Handler
    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        
        const closeMenu = ContextMenuApi.closeContextMenu || ContextMenuApi.close;
        const openMenu = ContextMenuApi.openContextMenu || ContextMenuApi.openContextMenuLazy || ContextMenuApi.open;

        if (typeof openMenu === "function") {
            openMenu(e, () => (
                <Menu.Menu navId="gm-card-context-menu" onClose={closeMenu}>
                    <Menu.MenuItem
                        id="gm-jump"
                        label="Jump to Message"
                        action={handleJumpToMessage}
                    />
                    <Menu.MenuItem
                        id="gm-copy-link"
                        label="Copy Media Link"
                        action={() => {
                            copyToClipboard(item.url);
                            setCopySuccess(true);
                            setTimeout(() => setCopySuccess(false), 2000);
                        }}
                    />
                    <Menu.MenuItem
                        id="gm-open-browser"
                        label="Open in Browser"
                        action={() => window.open(item.url, "_blank")}
                    />
                    <Menu.MenuItem
                        id="gm-author-profile"
                        label={`View @${item.author.username}'s Profile`}
                        action={handleOpenAuthorProfile}
                    />
                    {item.content && (
                        <Menu.MenuItem
                            id="gm-copy-text"
                            label="Copy Message Text"
                            action={() => copyToClipboard(item.content!)}
                        />
                    )}
                </Menu.Menu>
            ));
        }
    };

    const displaySrc = item.thumbnailUrl || item.proxyUrl || item.url;
    const typeLabel = (item.type || "FILE").toUpperCase();

    return (
        <div 
            className="gm-media-card"
            onClick={handleCardClick}
            onContextMenu={handleContextMenu}
        >
            <div className="gm-media-preview-wrapper">
                {/* Top-Left Type Badge */}
                <div className={`gm-type-badge ${item.type}`}>
                    {typeLabel}
                </div>

                {/* Main Media or File Preview */}
                {item.type === "file" || item.type === "audio" ? (
                    <div className="gm-file-card-preview">
                        <div className="gm-file-ext-badge">{item.fileExtension || "FILE"}</div>
                        <div className="gm-file-icon-circle">{item.type === "audio" ? "🎵" : "📄"}</div>
                        <div className="gm-file-name-text">{item.filename || "Attachment File"}</div>
                        {item.fileSize && <div className="gm-file-size-badge">{formatSize(item.fileSize)}</div>}
                    </div>
                ) : hasError ? (
                    <div className="gm-file-card-preview">
                        <div className="gm-file-icon-circle">⚠️</div>
                        <div className="gm-file-name-text">Media Preview Unavailable</div>
                    </div>
                ) : item.type === "video" ? (
                    <div style={{ position: "relative", width: "100%", height: "100%" }}>
                        {!mediaLoaded && (
                            <div className="gm-media-skeleton">
                                <div className="gm-spinner-icon" />
                            </div>
                        )}
                        <video 
                            src={item.proxyUrl || item.url} 
                            poster={item.thumbnailUrl !== item.url ? item.thumbnailUrl : undefined}
                            preload="metadata" 
                            muted 
                            playsInline
                            className={`gm-media-element ${mediaLoaded ? "loaded" : ""}`}
                            onLoadedData={() => setMediaLoaded(true)}
                            onCanPlay={() => setMediaLoaded(true)}
                            onError={() => {
                                // Fallback if video tag can't render
                                setHasError(false);
                                setMediaLoaded(true);
                            }}
                            style={{ objectFit: "cover", width: "100%", height: "100%", display: "block" }}
                        />
                        <div className="gm-video-play-overlay">
                            <div className="gm-play-button-circle">
                                ▶
                            </div>
                        </div>
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
                            onLoad={() => setMediaLoaded(true)}
                            onError={() => setHasError(true)}
                        />
                    </>
                )}

                {/* Bottom-Right Date Glass Pill */}
                {item.timestamp && (
                    <div className="gm-card-date-badge-bottom-right">
                        {formatDate(item.timestamp)}
                    </div>
                )}

                {/* Hover Actions Overlay with Jump Button */}
                <div className="gm-card-actions-overlay">
                    <button 
                        className="gm-action-btn primary" 
                        onClick={handleJumpToMessage} 
                        title="Jump to Message in Chat"
                    >
                        Jump ➔
                    </button>
                    <button 
                        className="gm-action-btn secondary" 
                        onClick={(e) => {
                            e.stopPropagation();
                            copyToClipboard(item.url);
                            setCopySuccess(true);
                            setTimeout(() => setCopySuccess(false), 2000);
                        }} 
                        title="Copy Link"
                    >
                        📋
                    </button>
                </div>
            </div>

            {/* Author Footer Bar */}
            <div className="gm-card-footer" onClick={handleOpenAuthorProfile} title="View Author Profile">
                {item.author.avatar ? (
                    <img 
                        className="gm-author-avatar" 
                        src={`https://cdn.discordapp.com/avatars/${item.author.id}/${item.author.avatar}.png?size=64`} 
                        alt={item.author.username} 
                    />
                ) : (
                    <div className="gm-author-avatar" style={{
                        background: "var(--brand-experiment)",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: "bold",
                        fontSize: "14px"
                    }}>
                        {item.author.username.charAt(0).toUpperCase()}
                    </div>
                )}
                <div className="gm-author-details">
                    <span className="gm-author-name">{item.author.globalName || item.author.username}</span>
                    <span className="gm-author-username">@{item.author.username}</span>
                </div>
            </div>

            {/* Copy Toast Notification */}
            {copySuccess && (
                <div style={{
                    position: "absolute",
                    top: "12px",
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "var(--brand-experiment)",
                    color: "#fff",
                    padding: "4px 12px",
                    borderRadius: "12px",
                    fontSize: "12px",
                    fontWeight: 700,
                    zIndex: 100,
                    boxShadow: "0 4px 12px rgba(0,0,0,0.5)"
                }}>
                    Copied Link!
                </div>
            )}
        </div>
    );
};
