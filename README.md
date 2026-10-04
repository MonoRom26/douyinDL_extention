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

On any Douyin profile page (`douyin.com/user/...`) a **"Download all
videos"** button appears in

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
