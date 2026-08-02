# GalleryMode for Vencord

A Vencord user plugin that adds a Discord header-bar Gallery Mode button. Gallery Mode queries Discord's native message search API and renders channel/server media in a responsive grid.

## Features

- Channel or whole-server gallery scope
- Optional multi-channel selection for server searches
- Media filters: all, images/GIFs, videos, embeds, files, audio
- Keyword search and multi-author filtering (works in DMs/group DMs too)
- Date-range filtering and newest/oldest sort toggle
- Infinite scroll with request de-duplication, LRU caching, and rate-limit/backoff handling
- Jump to source message, copy media link, open author profile
- Discord-native image modal plus built-in video/audio/file preview modal
- Restores scroll position and session state when reopened
- Background prefetch of the next page — scrolling rarely hits a loading state
- Shimmering skeleton placeholder cards instead of a blank "Loading…" screen
- Three motion tiers (full / subtle / off) plus `prefers-reduced-motion` support
- One-click button to open the plugin's Vencord settings from the gallery header
- Responsive header layout down to very small / short windows
- Shift/Ctrl-click the media type tabs to combine types (e.g. image + video + embed)
- GIF and video playback modes: always, on hover, or only when opened
- Spoiler-tagged and age-restricted media can be blurred until clicked
- Optional author footer — turn it off for a pure gallery wall
- Adapts to light, dark and custom Discord themes automatically

## Installation

Copy the `galleryMode` folder into your Vencord `src/userplugins/` directory, then rebuild/restart Vencord and enable **GalleryMode** in plugin settings.
