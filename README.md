<div align="center">

<img src="assets/icon.svg" width="96" alt="GalleryMode icon">

# GalleryMode

**Turn any Discord channel, thread or server into a browsable media gallery.**

Powered by Discord's own search backend — no scraping, no third-party services, no message history stored.

<a href="https://github.com/K9Paradox/GalleryView/pulls"><img alt="Vencord user plugin" src="https://img.shields.io/badge/Vencord-user%20plugin-5865F2?style=for-the-badge&logo=discord&logoColor=white"></a>
<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white">
<img alt="No data collection" src="https://img.shields.io/badge/telemetry-none-23A55A?style=for-the-badge">

<a href="#-features">Features</a> ·
<a href="#-installation">Installation</a> ·
<a href="#-usage">Usage</a> ·
<a href="#-settings">Settings</a> ·
<a href="#-troubleshooting">Troubleshooting</a>

</div>

---

## What it does

Discord is great at conversation and bad at looking back through what people posted. Scrolling a year of `#art` to find one image is miserable, and the built-in search shows results as a wall of text.

GalleryMode adds a single button to Discord's header bar. Click it and the channel becomes a full-screen grid of every image, GIF, video, embed, file and audio clip in it — filterable by type, author, keyword and date, and jumpable straight back to the original message.

It runs entirely on Discord's native `/messages/search` endpoint. Nothing is scraped, nothing is uploaded anywhere, and no message content is written to disk.

---

## ✨ Features

### Search and scope

| | |
|---|---|
| **Scopes** | Current channel, current thread, every sub thread under a parent, or the entire server |
| **Thread aware** | Forum and media posts are handled properly, with a picker listing threads fetched from Discord — not just ones you have already opened |
| **Channel picker** | Server-wide searches can target specific channels, grouped into collapsible categories with a filter box, per-category select-all, and threads nested under their owning channel |
| **Media types** | All · Images & GIFs · Videos · Embeds · Files · Audio. <kbd>Shift</kbd> or <kbd>Ctrl</kbd> click to combine several |
| **Filters** | Keyword search, multi-author filtering (works in DMs and group DMs), date range, newest/oldest sort |

### Browsing

- **Two layouts** — a uniform grid, or true masonry that respects each image's aspect ratio while preserving reading order.
- **Four densities** — Compact, Standard, Large and Showcase.
- **Infinite scroll** with background prefetch, so the next page is usually already loaded before you reach it.
- **Skeleton placeholders** sized from real aspect ratios, instead of a blank loading screen.
- **Session memory** — filters, scroll depth and results are restored when you reopen a channel's gallery, including after jumping to a message.

### Per-item actions

Click to preview · **Jump** to the source message · Copy link · Download · Open original in browser · View author profile · Copy message text.

Right-click any card for the same actions in a context menu.

### Presentation

- Adapts automatically to **light, dark and custom themes**, by measuring Discord's actual background rather than guessing from a class name.
- **Three motion tiers** — full (staggered reveals, blur-up thumbnails, hover lift), subtle, or off. `prefers-reduced-motion` is always respected.
- **Spoiler and age-restricted media** can stay blurred until clicked.
- Metadata badges and the author footer can both be hidden for a pure gallery wall.
- Responsive down to very small and very short windows.

### Under the hood

Discord rate-limits search aggressively, so a lot of the work here is about asking for less:

- Adaptive request spacing that widens after a throttle and relaxes once responses are clean.
- Response caching plus in-flight de-duplication, so filters that resolve to the same query share one round trip.
- Negative caching, to skip requests that are known to return nothing.
- Separate pagination cursors for the attachment and embed streams.
- Auto-loading paced against real user scrolling rather than layout churn.
- `React.memo` on cards, LRU caches, and `content-visibility` so off-screen cards cost nothing.

---

## 📦 Installation

GalleryMode is a **user plugin**, which means you need a [self-built Vencord install](https://docs.vencord.dev/installing/) — it cannot be added to the standard installer build.

```bash
# from the root of your Vencord source checkout
git clone https://github.com/K9Paradox/GalleryView.git /tmp/galleryview
cp -r /tmp/galleryview/galleryMode src/userplugins/galleryMode

pnpm build
pnpm inject   # only needed the first time
```

<details>
<summary><b>Windows (Command Prompt)</b></summary>

```bat
cd /d "%TEMP%"
curl -L -o galleryview.zip https://codeload.github.com/K9Paradox/GalleryView/zip/refs/heads/main
tar -xf galleryview.zip
robocopy "GalleryView-main\galleryMode" "C:\path\to\Vencord\src\userplugins\galleryMode" /MIR
del galleryview.zip & rmdir /s /q "GalleryView-main"

cd /d "C:\path\to\Vencord"
pnpm build
```

`/MIR` mirrors the folder, so any local-only files inside `galleryMode` are deleted. That is what you want for a clean update.
</details>

Then **fully restart Discord** (not just <kbd>Ctrl</kbd>+<kbd>R</kbd>) and enable **GalleryMode** in `Settings → Plugins`.

> [!NOTE]
> If `src/userplugins/` does not exist yet, create it. Vencord picks up anything in there automatically.

---

## 🚀 Usage

Open any channel and click the gallery icon in the header bar, next to the inbox and help icons.

| Action | How |
|---|---|
| Open / close | Header bar icon, or <kbd>Esc</kbd> to close |
| Combine media types | <kbd>Shift</kbd> or <kbd>Ctrl</kbd> click the type tabs |
| Change density | The **S / M / L / XL** buttons |
| Search a specific thread | Open the thread first, then the gallery |
| Search every thread in a channel | **All Sub Threads**, then optionally **Selected Threads** to narrow it |
| Reset every filter | **Reset** |
| Open plugin settings | The gear icon in the gallery header |

---

## ⚙️ Settings

<details>
<summary><b>Appearance</b></summary>

| Setting | Options | Default |
|---|---|---|
| Gallery layout | Grid · Masonry | Grid |
| Card width / density | Compact · Standard · Large · Showcase | Standard |
| Motion & transitions | Full · Subtle · Off | Full |
| Skeleton placeholders | On / off | On |
| Show date and type badges | On / off | On |
| Show author footer | On / off | On |
</details>

<details>
<summary><b>Media playback</b></summary>

| Setting | Options | Default |
|---|---|---|
| GIF playback | Always · On hover · Only when opened | Always |
| Video previews | On hover · Always · Only when opened | On hover |
</details>

<details>
<summary><b>Privacy and content</b></summary>

| Setting | Options | Default |
|---|---|---|
| Blur spoiler-tagged media | On / off | On |
| Blur age-restricted channels | On / off | Off |
| Include NSFW results | On / off | On |
</details>

<details>
<summary><b>Defaults and behaviour</b></summary>

| Setting | Options | Default |
|---|---|---|
| Default scope | Channel · All sub threads · Server | Channel |
| Default media filter | All · Images · Videos · Embeds · Files · Audio | All |
| Default sort order | Newest · Oldest | Newest |
| Remember sessions | On / off | On |
| Prefetch next page | On / off | On |
</details>

---

## 🔧 Troubleshooting

<details>
<summary><b>The gallery button is missing</b></summary>

The plugin patches Discord's header bar, and that patch can break when Discord ships a UI change. It fails safely — the button disappears rather than breaking the client. Check the console for `[GalleryMode]` errors and open an issue with your Discord build number.
</details>

<details>
<summary><b>"You don't have permission to search this channel"</b></summary>

Discord returns error 50001 when your account cannot read one of the channels being searched. In server scope, deselect the channel you lack access to, or switch to the current channel only.
</details>

<details>
<summary><b>Results are slow, or a rate-limit banner appears</b></summary>

Discord throttles its search endpoint per account. GalleryMode backs off automatically and resumes once the limit clears. Narrowing the scope or adding filters reduces how many requests a browse needs.
</details>

<details>
<summary><b>Some previews will not load</b></summary>

Media hosted outside Discord is often blocked by Discord's content security policy, and CDN links expire. Those cards fall back to a "Preview Unavailable" tile — clicking still opens the original.
</details>

<details>
<summary><b>Reporting a bug</b></summary>

Enable diagnostics in the Discord console:

```js
Vencord.Plugins.plugins.GalleryMode.debug(true)
```

Reproduce the problem, then include every `[GalleryMode]` line in your issue. Turn it off with `debug(false)`.

The flag is a method rather than a `localStorage` value because Discord removes `localStorage` from the console to deter token-stealing scams.
</details>

---

## 🔒 Privacy

GalleryMode makes requests to **Discord and nowhere else**. It uses the same `/messages/search` endpoint the client already uses, with your existing session. There is no telemetry, no analytics, and no external service.

Caches are in-memory and cleared when Discord restarts. Only your filter and scroll state persist between openings, and that can be turned off with **Remember sessions**.

---

## 🛠️ Development

```
galleryMode/
├── index.tsx                    # Plugin definition and header patch
├── settings.ts                  # Settings schema
├── types.ts                     # Shared types
├── useThemeTone.ts              # Light/dark detection via computed luminance
├── styles.css                   # Themed via --gm-* custom properties
├── components/
│   ├── GalleryView.tsx          # Overlay, filters, scopes, session handling
│   ├── MediaCard.tsx            # Individual media card
│   ├── MasonryGrid.tsx          # Reading-order-preserving masonry packer
│   ├── SkeletonCard.tsx         # Loading placeholders
│   └── HeaderSearchBar.tsx      # Header bar toggle button
└── services/
    ├── searchService.ts         # Discord search, pagination, rate limiting
    └── cacheService.ts          # Result and session caches
```

Theming goes through `--gm-*` custom properties defined at the top of `styles.css`. Anything painted **on top of media** uses `--gm-on-media`, which deliberately stays light in both palettes — badges sit over photographs, not over the theme surface.

---

## 📄 Credits

Built by **TheK9.**

Not affiliated with Discord or Vencord. Discord is a trademark of Discord Inc.
