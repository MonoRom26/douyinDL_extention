// Douyin Video Downloader - content script
// Two features:
//  1. Hover over any <video> -> a small download button appears on it.
//  2. On a profile page (/user/...), a floating "Download All" button
//     scrolls the grid to load every post, then asks the background
//     worker to visit each video and download it in a hidden window.

(function () {
  const ICON_IDLE = '';
  const ICON_DONE = '✓';
  const ICON_ERROR = '!';

  // ---------- shared helpers ----------

  function ensurePositioned(el) {
    const style = window.getComputedStyle(el);
    if (style.position === 'static') {
      el.style.position = 'relative';
    }
  }

  function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  }

  function videoIdFromLocation() {
    const m = location.pathname.match(/\/video\/(\d+)/);
    return m ? m[1] : null;
  }

  function guessFilename() {
    let author = '';
    const authorEl = document.querySelector('[data-e2e="user-name"], h1, h2');
    if (authorEl && authorEl.textContent) {
      author = authorEl.textContent.trim();
    }
    const id = videoIdFromLocation();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const parts = ['douyin', author, id, stamp].filter(Boolean);
    return sanitizeFilename(parts.join('_')) + '.mp4';
  }

  function pickPrimaryVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return null;
    // Heuristic: the actual player is almost always the largest visible video.
    let best = null;
    let bestArea = 0;
    for (const v of videos) {
      const rect = v.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        best = v;
      }
    }
    return best;
  }

  function waitForVideoReady(timeoutMs) {
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      (function poll() {
        const video = pickPrimaryVideo();
        const src = video && (video.currentSrc || video.src);
        if (video && src) {
          resolve(video);
          return;
        }
        if (Date.now() >= deadline) {
          resolve(null);
          return;
        }
        setTimeout(poll, 400);
      })();
    });
  }

  function setButtonState(btn, state) {
    if (!btn) return;
    btn.classList.remove('dydl-loading', 'dydl-done', 'dydl-error');
    if (state === 'loading') {
      btn.classList.add('dydl-loading');
      btn.textContent = ICON_IDLE;
    } else if (state === 'done') {
      btn.classList.add('dydl-done');
      btn.textContent = ICON_DONE;
      setTimeout(() => {
        btn.classList.remove('dydl-done');
        btn.textContent = ICON_IDLE;
      }, 1800);
    } else if (state === 'error') {
      btn.classList.add('dydl-error');
      btn.textContent = ICON_ERROR;
      setTimeout(() => {
        btn.classList.remove('dydl-error');
        btn.textContent = ICON_IDLE;
      }, 2200);
    } else {
      btn.textContent = ICON_IDLE;
    }
  }

  // Core download routine. `btn` is optional (bulk/background downloads
  // have no visible button to update).
  function downloadVideo(video, btn) {
    return new Promise((resolve) => {
      const src = video && (video.currentSrc || video.src);
      if (!src) {
        setButtonState(btn, 'error');
        resolve(false);
        return;
      }

      setButtonState(btn, 'loading');
      const filename = guessFilename();

      const finish = (ok) => {
        setButtonState(btn, ok ? 'done' : 'error');
        resolve(ok);
      };

      try {
        if (src.startsWith('blob:')) {
          fetch(src)
            .then((resp) => resp.blob())
            .then((blob) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                chrome.runtime.sendMessage(
                  { type: 'DYDL_DOWNLOAD_DATA', dataUrl: reader.result, filename },
                  (response) => finish(!!(response && response.ok))
                );
              };
              reader.onerror = () => finish(false);
              reader.readAsDataURL(blob);
            })
            .catch(() => finish(false));
        } else {
          chrome.runtime.sendMessage(
            { type: 'DYDL_DOWNLOAD_URL', url: src, filename },
            (response) => finish(!!(response && response.ok))
          );
        }
      } catch (err) {
        console.error('[Douyin Downloader]', err);
        finish(false);
      }
    });
  }

  // ---------- feature 1: per-video hover button ----------

  function findOverlayTarget(video) {
    let el = video.parentElement;
    let depth = 0;
    while (el && depth < 3) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return el;
      }
      el = el.parentElement;
      depth++;
    }
    return video.parentElement || video;
  }

  function attachHoverButton(video) {
    if (video.dataset.dydlAttached) return;
    video.dataset.dydlAttached = 'true';

    const target = findOverlayTarget(video);
    ensurePositioned(target);

    const btn = document.createElement('div');
    btn.className = 'dydl-download-btn';
    btn.textContent = ICON_IDLE;
    btn.title = 'Download video';
    target.appendChild(btn);

    const show = () => { btn.style.display = 'flex'; };
    const hide = () => { btn.style.display = 'none'; };

    target.addEventListener('mouseenter', show);
    target.addEventListener('mouseleave', hide);

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      downloadVideo(video, btn);
    });
  }

  function scanForVideos() {
    document.querySelectorAll('video').forEach(attachHoverButton);
  }

  const observer = new MutationObserver(() => scanForVideos());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scanForVideos();

  // ---------- feature 2: whole-profile bulk download ----------

  function isProfilePage() {
    return /\/user\//.test(location.pathname);
  }

  function collectVideoLinks() {
    const anchors = Array.from(document.querySelectorAll('a[href*="/video/"]'));
    const urls = new Set();
    for (const a of anchors) {
      try {
        const url = new URL(a.getAttribute('href'), location.origin);
        if (/\/video\/\d+/.test(url.pathname)) {
          urls.add(url.origin + url.pathname);
        }
      } catch (_) {
        /* ignore malformed hrefs */
      }
    }
    return Array.from(urls);
  }

  async function autoScrollToLoadAll(onProgress) {
    let lastCount = 0;
    let stagnantRounds = 0;
    const maxRounds = 150;
    const maxStagnantRounds = 4;

    for (let round = 0; round < maxRounds; round++) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 900));

      const count = collectVideoLinks().length;
      onProgress(count);

      if (count <= lastCount) {
        stagnantRounds++;
        if (stagnantRounds >= maxStagnantRounds) break;
      } else {
        stagnantRounds = 0;
      }
      lastCount = count;
    }
  }

  let bulkBtnEl = null;
  let bulkActive = false;

  function createBulkButton() {
    if (bulkBtnEl) return bulkBtnEl;
    const btn = document.createElement('div');
    btn.className = 'dydl-bulk-btn';
    btn.innerHTML = '<span class="dydl-bulk-spinner"></span><span class="dydl-bulk-label">Download all videos</span>';
    document.body.appendChild(btn);
    bulkBtnEl = btn;

    btn.addEventListener('click', () => {
      if (bulkActive) {
        chrome.runtime.sendMessage({ type: 'DYDL_CANCEL_PROFILE_DOWNLOAD' });
        setBulkLabel('Cancelling…');
        return;
      }
      startBulkDownload();
    });

    return btn;
  }

  function setBulkLabel(text, mode) {
    if (!bulkBtnEl) return;
    const label = bulkBtnEl.querySelector('.dydl-bulk-label');
    if (label) label.textContent = text;
    bulkBtnEl.classList.remove('dydl-bulk-active', 'dydl-bulk-done');
    if (mode === 'active') bulkBtnEl.classList.add('dydl-bulk-active');
    if (mode === 'done') bulkBtnEl.classList.add('dydl-bulk-done');
  }

  async function startBulkDownload() {
    bulkActive = true;
    setBulkLabel('Scanning profile…', 'active');

    await autoScrollToLoadAll((count) => {
      setBulkLabel(`Scanning profile… (${count} found)`, 'active');
    });

    const urls = collectVideoLinks();
    if (urls.length === 0) {
      setBulkLabel('No videos found', 'done');
      bulkActive = false;
      setTimeout(() => setBulkLabel('Download all videos'), 2500);
      return;
    }

    setBulkLabel(`Starting… 0/${urls.length}`, 'active');
    chrome.runtime.sendMessage({ type: 'DYDL_START_PROFILE_DOWNLOAD', urls });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Hidden tabs use this to trigger a download of whatever video loaded.
    if (msg.type === 'DYDL_AUTO_DOWNLOAD') {
      (async () => {
        const video = await waitForVideoReady(12000);
        if (!video) {
          sendResponse({ ok: false, reason: 'no-video' });
          return;
        }
        const ok = await downloadVideo(video, null);
        sendResponse({ ok });
      })();
      return true; // async response
    }

    // Progress/completion updates for the bulk button on the profile page.
    if (msg.type === 'DYDL_PROFILE_PROGRESS') {
      setBulkLabel(`Downloading ${msg.done}/${msg.total}${msg.failed ? ` (${msg.failed} failed)` : ''}`, 'active');
    }

    if (msg.type === 'DYDL_PROFILE_DONE') {
      bulkActive = false;
      const summary = msg.cancelled
        ? `Stopped: ${msg.done}/${msg.total} saved`
        : `Done: ${msg.done}/${msg.total} saved${msg.failed ? `, ${msg.failed} failed` : ''}`;
      setBulkLabel(summary, 'done');
      setTimeout(() => setBulkLabel('Download all videos'), 4000);
    }
  });

  if (isProfilePage()) {
    createBulkButton();
  }
})();
