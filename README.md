# Douyin Video Downloader (Chrome Extension)

Hover over a video on douyin.com and a small download button (⬇) appears
on top of it. Click it to save the video to your Downloads folder.

## Load it in Chrome

1. Unzip this folder somewhere permanent (don't delete it after installing —
   Chrome loads the extension directly from these files).
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select this folder.
5. Go to douyin.com, open a profile or the video feed, and hover over a
   video — the download button appears in the top-right corner of the
   player.

## Download an entire profile

On any Douyin profile page (`douyin.com/user/...`) a pink **"Download all
videos"** button appears in the bottom-right corner. Click it and the
extension will:

1. Auto-scroll the page to load every post in the grid.
2. Open each video in a hidden, minimized window (your own tabs are left
   alone) one at a time.
3. Download each one and update the button with live progress, e.g.
   `Downloading 12/48`.
4. Show a final summary (`Done: 46/48 saved, 2 failed`) when finished.

Click the button again while it's running to cancel — it finishes the
video currently in progress, then stops.

This is a slow, one-video-at-a-time process by design (Douyin will likely
rate-limit or flag an account that loads dozens of pages instantly), so
expect roughly 2–4 seconds per video. For a profile with hundreds of
videos, expect it to take a while and plan to leave the tab open.

## How it works

- `content.js` watches the page for `<video>` elements and overlays a
  button on hover. It also detects profile pages and adds the bulk
  download button.
- On click, it grabs the video's current source:
  - If it's a `blob:` URL (common when Douyin streams via Media Source
    Extensions), the script fetches the bytes itself and hands them to
    the background worker as a data URL.
  - If it's a normal network URL, it's passed straight to
    `chrome.downloads.download`, which fetches it outside the page's CORS
    restrictions.
- For "download all", the content script scrolls to collect every
  `/video/<id>` link on the profile, then hands the list to
  `background.js`, which opens a hidden minimized window, navigates a
  single tab through each video URL in turn, and asks the content script
  running there to download whatever video loaded.
- `background.js` is the only place that calls the Downloads API and the
  Tabs/Windows APIs (required in Manifest V3 — content scripts can't call
  these directly).

## Known limitations

- Douyin frequently changes its DOM/player internals. If a button stops
  appearing, the underlying page structure has likely changed.
- Some videos are served with expiring, signed CDN URLs. If a single-video
  download fails, hover off and back on (or replay the video briefly) to
  refresh `currentSrc` before clicking again.
- The bulk downloader relies on visible `/video/<id>` links in the grid,
  loaded via auto-scroll — extremely large profiles (hundreds of videos)
  may need the scroll limits in `content.js` (`maxRounds`,
  `maxStagnantRounds`) raised.
- Repeatedly opening many video pages in a short time may trigger
  Douyin's own rate-limiting or anti-bot checks — if downloads start
  failing partway through a bulk run, wait a while before retrying.
- For personal use only — respect Douyin's terms of service and the
  original creators' rights when saving and reusing videos.

## Custom button icon

The hover button uses `icon.svg` from this folder as its image.

To use your own:

1. Drop your image (PNG, SVG, etc.) into this folder, e.g. `icon.png`.
2. In `styles.css`, change the `background-image` URL in `.dydl-download-btn`
   to point at your file name (keep the `chrome-extension://__MSG_@@extension_id__/`
   prefix exactly as written).
3. Make sure the file name is listed under `web_accessible_resources` in
   `manifest.json` (`icon.svg` and `icon.png` are already listed).
4. Adjust the button size with `width`/`height` and the image size with
   `background-size` in the same CSS rule.
5. Reload the extension at `chrome://extensions`, then refresh the Douyin tab.
