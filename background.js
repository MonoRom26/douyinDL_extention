// Douyin Video Downloader - background service worker
// Handles the actual chrome.downloads calls, and runs the "download all
// videos in this profile" queue in a hidden, minimized window so the
// user's own tabs are undisturbed.

function doDownload(downloadOptions) {
  return new Promise((resolve) => {
    chrome.downloads.download(downloadOptions, (downloadId) => {
      if (chrome.runtime.lastError || !downloadId) {
        console.error('[Douyin Downloader] download failed', chrome.runtime.lastError);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'DYDL_DOWNLOAD_DATA') {
    doDownload({ url: msg.dataUrl, filename: msg.filename, saveAs: false }).then((ok) =>
      sendResponse({ ok })
    );
    return true;
  }

  if (msg.type === 'DYDL_DOWNLOAD_URL') {
    doDownload({ url: msg.url, filename: msg.filename, saveAs: false }).then((ok) =>
      sendResponse({ ok })
    );
    return true;
  }

  if (msg.type === 'DYDL_START_PROFILE_DOWNLOAD') {
    const profileTabId = sender.tab ? sender.tab.id : null;
    runProfileQueue(msg.urls, profileTabId);
    // Fire-and-forget: progress comes back via separate messages.
  }

  if (msg.type === 'DYDL_CANCEL_PROFILE_DOWNLOAD') {
    cancelRequested = true;
  }
});

// ---------- profile queue ----------

let queueRunning = false;
let cancelRequested = false;

async function runProfileQueue(urls, profileTabId) {
  if (queueRunning) return; // one bulk job at a time
  queueRunning = true;
  cancelRequested = false;

  let done = 0;
  let failed = 0;
  const total = urls.length;

  let win = null;
  let tabId = null;

  try {
    win = await chrome.windows.create({
      url: 'about:blank',
      state: 'minimized',
      focused: false,
    });
    tabId = win.tabs && win.tabs[0] ? win.tabs[0].id : null;
    if (!tabId) throw new Error('Could not open helper window');

    for (const url of urls) {
      if (cancelRequested) break;

      const ok = await loadAndDownload(tabId, url);
      if (ok) done++; else failed++;

      if (profileTabId !== null) {
        chrome.tabs
          .sendMessage(profileTabId, { type: 'DYDL_PROFILE_PROGRESS', done: done + failed, total, failed })
          .catch(() => {});
      }

      // Small pause between videos to avoid hammering Douyin.
      await sleep(1200);
    }
  } catch (err) {
    console.error('[Douyin Downloader] profile queue error', err);
  } finally {
    if (win && win.id !== undefined) {
      chrome.windows.remove(win.id).catch(() => {});
    }
    queueRunning = false;
    if (profileTabId !== null) {
      chrome.tabs
        .sendMessage(profileTabId, {
          type: 'DYDL_PROFILE_DONE',
          done: done + failed,
          total,
          failed,
          cancelled: cancelRequested,
        })
        .catch(() => {});
    }
    cancelRequested = false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(ok);
    };
    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        finish(true);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => finish(false), timeoutMs);
  });
}

// Ask the content script in `tabId` to download whatever video loaded,
// retrying a few times in case the SPA hasn't mounted the content script
// listener yet right after navigation.
function requestAutoDownload(tabId, retries) {
  return new Promise((resolve) => {
    const attempt = (remaining) => {
      chrome.tabs.sendMessage(tabId, { type: 'DYDL_AUTO_DOWNLOAD' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          if (remaining > 0) {
            setTimeout(() => attempt(remaining - 1), 1000);
          } else {
            resolve(false);
          }
          return;
        }
        resolve(!!response.ok);
      });
    };
    attempt(retries);
  });
}

async function loadAndDownload(tabId, url) {
  try {
    await chrome.tabs.update(tabId, { url });
    await waitForTabComplete(tabId, 15000);
    // Give the SPA a moment to hydrate and start loading the video after
    // the base document finishes.
    await sleep(1500);
    return await requestAutoDownload(tabId, 5);
  } catch (err) {
    console.error('[Douyin Downloader] loadAndDownload failed', err);
    return false;
  }
}
