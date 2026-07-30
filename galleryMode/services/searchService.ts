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

export class SearchService {
    private static requestQueue: Array<() => Promise<void>> = [];
    private static isProcessingQueue = false;
    private static lastRequestTimestamp = 0;
    private static MIN_REQUEST_INTERVAL_MS = 200;
    
    private static rateLimitState: RateLimitState = {
        isRateLimited: false,
        retryAfterMs: 0,
        resetTimestamp: 0
    };

    private static inFlightRequests = new Map<string, Promise<{ items: MediaItem[]; totalResults: number; hasMore: boolean }>>();

    public static getRateLimitState(): RateLimitState {
        return this.rateLimitState;
    }

    public static async searchMedia(params: SearchParameters): Promise<{ items: MediaItem[]; totalResults: number; hasMore: boolean }> {
        const cacheKey = CacheService.getCacheKey(params);

        const cached = CacheService.get(params);
        if (cached) {
            return {
                items: cached.items,
                totalResults: cached.totalResults,
                hasMore: cached.hasMore
            };
        }

        if (this.inFlightRequests.has(cacheKey)) {
            return this.inFlightRequests.get(cacheKey)!;
        }

        const requestPromise = new Promise<{ items: MediaItem[]; totalResults: number; hasMore: boolean }>((resolve, reject) => {
            this.enqueueRequest(async () => {
                try {
                    const result = await this.executeSearchRequest(params);
                    CacheService.set(params, result.items, result.totalResults, result.hasMore);
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
        this.processQueue();
    }

    private static async processQueue(): Promise<void> {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;

        while (this.requestQueue.length > 0) {
            if (this.rateLimitState.isRateLimited) {
                const now = Date.now();
                const waitTime = this.rateLimitState.resetTimestamp - now;
                if (waitTime > 0) {
                    await new Promise((r) => setTimeout(r, Math.min(waitTime, 5000)));
                }
                this.rateLimitState.isRateLimited = false;
            }

            const now = Date.now();
            const timeSinceLast = now - this.lastRequestTimestamp;
            if (timeSinceLast < this.MIN_REQUEST_INTERVAL_MS) {
                await new Promise((r) => setTimeout(r, this.MIN_REQUEST_INTERVAL_MS - timeSinceLast));
            }

            const task = this.requestQueue.shift();
            if (task) {
                this.lastRequestTimestamp = Date.now();
                await task();
            }
        }

        this.isProcessingQueue = false;
    }

    private static async executeSearchRequest(
        params: SearchParameters
    ): Promise<{ items: MediaItem[]; totalResults: number; hasMore: boolean }> {
        let endpoint: string;
        const queryParams: Record<string, any> = {
            include_nsfw: true,
            offset: params.offset || 0
        };

        if (params.channelId && (!params.channelIds || params.channelIds.length === 0)) {
            endpoint = `/channels/${params.channelId}/messages/search`;
        } else if (params.guildId) {
            endpoint = `/guilds/${params.guildId}/messages/search`;
            if (params.channelIds && params.channelIds.length > 0) {
                queryParams.channel_id = params.channelIds.length === 1 ? params.channelIds[0] : params.channelIds;
            }
        } else if (params.channelId) {
            endpoint = `/channels/${params.channelId}/messages/search`;
        } else {
            throw new Error("No target channel or guild specified for media search.");
        }

        if (params.authorIds && params.authorIds.length > 0) {
            queryParams.author_id = params.authorIds.length === 1 ? params.authorIds[0] : params.authorIds;
        }

        if (params.query && params.query.trim()) {
            queryParams.content = params.query.trim();
        }

        // Media attachment type filter
        if (params.filterType === "image") {
            queryParams.has = "image";
        } else if (params.filterType === "video") {
            queryParams.has = "video";
        } else if (params.filterType === "embed") {
            queryParams.has = "embed";
        } else if (params.filterType === "file" || params.filterType === "audio") {
            queryParams.has = "file";
        } else {
            queryParams.has = "file";
        }

        try {
            const response: any = await RestAPI.get({
                url: endpoint,
                query: queryParams
            });

            // Unwrap response body if wrapped by RestAPI
            const responseData: DiscordSearchResponse = response?.body || response;

            return this.transformSearchResponse(responseData, params);
        } catch (err: any) {
            if (err?.status === 429 || err?.body?.retry_after) {
                const retryAfterSec = err?.body?.retry_after || 3;
                this.rateLimitState = {
                    isRateLimited: true,
                    retryAfterMs: retryAfterSec * 1000,
                    resetTimestamp: Date.now() + retryAfterSec * 1000
                };
            }
            throw err;
        }
    }

    private static transformSearchResponse(
        response: DiscordSearchResponse,
        params: SearchParameters
    ): { items: MediaItem[]; totalResults: number; hasMore: boolean } {
        const extractedItems: MediaItem[] = [];

        if (!response || !response.messages || !Array.isArray(response.messages)) {
            return { items: [], totalResults: 0, hasMore: false };
        }

        const messages = response.messages.flat();

        for (const msg of messages) {
            if (!msg || !msg.id) continue;

            if (params.channelId && (!params.channelIds || params.channelIds.length === 0)) {
                if (msg.channel_id !== params.channelId) {
                    continue;
                }
            }

            // 1. Process Attachments
            if (msg.attachments && msg.attachments.length > 0) {
                for (const att of msg.attachments) {
                    const detectedType = this.categorizeAttachment(att.filename, att.content_type);
                    
                    if (params.filterType !== "all") {
                        if (params.filterType === "image" && (detectedType !== "image" && detectedType !== "gif")) {
                            continue;
                        } else if (params.filterType !== "image" && detectedType !== params.filterType) {
                            continue;
                        }
                    }

                    const ext = att.filename.includes(".") ? att.filename.split(".").pop()?.toUpperCase() : "FILE";

                    extractedItems.push({
                        id: `att_${att.id}`,
                        messageId: msg.id,
                        channelId: msg.channel_id,
                        guildId: params.guildId,
                        url: att.url,
                        proxyUrl: att.proxy_url,
                        thumbnailUrl: att.thumbnail || att.proxy_url,
                        filename: att.filename,
                        type: detectedType,
                        fileExtension: ext,
                        fileSize: att.size,
                        width: att.width,
                        height: att.height,
                        timestamp: msg.timestamp,
                        content: msg.content,
                        author: {
                            id: msg.author?.id || "0",
                            username: msg.author?.username || "Unknown",
                            globalName: msg.author?.global_name || msg.author?.username || "Unknown",
                            avatar: msg.author?.avatar
                        }
                    });
                }
            }

            // 2. Process Rich Embeds
            if (msg.embeds && msg.embeds.length > 0) {
                for (let index = 0; index < msg.embeds.length; index++) {
                    const embed = msg.embeds[index];
                    const detectedType = this.categorizeEmbed(embed);

                    if (!detectedType) continue;

                    if (params.filterType !== "all") {
                        if (params.filterType === "image" && (detectedType !== "image" && detectedType !== "gif")) {
                            continue;
                        } else if (params.filterType !== "image" && detectedType !== params.filterType) {
                            continue;
                        }
                    }

                    const mediaUrl = embed.image?.url || embed.thumbnail?.url || embed.video?.url || embed.url;
                    if (!mediaUrl) continue;

                    extractedItems.push({
                        id: `emb_${msg.id}_${index}`,
                        messageId: msg.id,
                        channelId: msg.channel_id,
                        guildId: params.guildId,
                        url: mediaUrl,
                        proxyUrl: embed.image?.proxy_url || embed.thumbnail?.proxy_url || mediaUrl,
                        thumbnailUrl: embed.thumbnail?.url || embed.image?.url,
                        filename: embed.title || "Embedded Media",
                        type: detectedType,
                        width: embed.image?.width || embed.video?.width,
                        height: embed.image?.height || embed.video?.height,
                        timestamp: msg.timestamp,
                        content: msg.content,
                        embedTitle: embed.title,
                        embedDescription: embed.description,
                        author: {
                            id: msg.author?.id || "0",
                            username: msg.author?.username || "Unknown",
                            globalName: msg.author?.global_name || msg.author?.username || "Unknown",
                            avatar: msg.author?.avatar
                        }
                    });
                }
            }
        }

        const totalResults = response.total_results || extractedItems.length;
        const currentOffset = params.offset || 0;
        const hasMore = currentOffset + 25 < totalResults && messages.length > 0;

        return {
            items: extractedItems,
            totalResults,
            hasMore
        };
    }

    private static categorizeAttachment(filename: string, contentType?: string): MediaType {
        const lowerName = filename.toLowerCase();
        const lowerType = (contentType || "").toLowerCase();

        if (lowerType.startsWith("image/") || /\.(png|jpe?g|webp|svg|bmp|tiff)$/i.test(lowerName)) {
            return "image";
        }
        if (lowerType.includes("gif") || /\.gif$/i.test(lowerName)) {
            return "gif";
        }
        if (lowerType.startsWith("video/") || /\.(mp4|webm|mov|m4v|mkv|avi|flv)$/i.test(lowerName)) {
            return "video";
        }
        if (lowerType.startsWith("audio/") || /\.(mp3|ogg|wav|flac|m4a|aac)$/i.test(lowerName)) {
            return "audio";
        }

        return "file";
    }

    private static categorizeEmbed(embed: DiscordEmbed): MediaType | null {
        if (embed.video) return "video";
        if (embed.image) {
            if (/\.gif$/i.test(embed.image.url)) return "gif";
            return "image";
        }
        if (embed.thumbnail) return "embed";
        if (embed.type === "image") return "image";
        if (embed.type === "video") return "video";
        if (embed.type === "link") return "embed";

        return "embed";
    }
}
