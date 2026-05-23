// DS Auditor — background service worker
// Persists token libraries and relays audit messages between popup and content scripts.

const BUNDLED_LIBRARY_ID = 'fds-variables-light';
const BUNDLED_LIBRARY_URL = chrome.runtime.getURL('data/fds-variables-light.tokens.json');

const LIB_FILES = [
  'lib/color-utils.js',
  'lib/token-parser.js',
  'lib/token-synthesizer.js',
  'lib/pattern-matcher.js',
  'lib/token-engine.js',
  'lib/auditor.js',
];

const CONTENT_SCRIPT_FILES = [...LIB_FILES, 'content/panel-shell.js', 'content/content.js'];
const HIGHLIGHT_CSS = 'content/highlight.css';

function safeSendResponse(sendResponse, payload) {
  try {
    sendResponse(payload);
  } catch (e) {
  }
}

function sendMessageOnce(tabId, payload) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, payload, (result) => {
      if (chrome.runtime.lastError) {
        resolve(undefined);
      } else {
        resolve(result);
      }
    });
  });
}

async function injectPageScripts(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPT_FILES });
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: [HIGHLIGHT_CSS] });
  } catch {
    // CSS may already be present after navigation retries.
  }
}

async function ensurePageScripts(tabId) {
  const ping = await sendMessageOnce(tabId, { type: 'PING' });
  if (ping && ping.ok) return;
  await injectPageScripts(tabId);
}

async function sendToTab(tabId, payload) {
  if (!tabId) return { ok: false, error: 'No tab' };

  let result = await sendMessageOnce(tabId, payload);
  if (result !== undefined) return result;

  try {
    await ensurePageScripts(tabId);
    result = await sendMessageOnce(tabId, payload);
    if (result !== undefined) return result;
    return { ok: false, error: 'No response from page' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Fire-and-forget — never keeps the message port open. */
function relayToTab(tabId, payload) {
  if (!tabId) return;
  sendToTab(tabId, payload).catch(() => {});
}

async function fetchBundledLibrary() {
  const res = await fetch(BUNDLED_LIBRARY_URL);
  if (!res.ok) throw new Error('Failed to load bundled FDS tokens');
  return res.json();
}

async function ensureBundledLibrary() {
  const data = await chrome.storage.local.get(['libraries', 'activeLibraryIds']);
  let libraries = data.libraries || [];
  let activeLibraryIds = data.activeLibraryIds || [];

  const existing = libraries.find((l) => l.id === BUNDLED_LIBRARY_ID);
  const bundled = await fetchBundledLibrary();

  if (!existing) {
    libraries = [bundled, ...libraries.filter((l) => l.id !== BUNDLED_LIBRARY_ID)];
    if (!activeLibraryIds.includes(BUNDLED_LIBRARY_ID)) {
      activeLibraryIds = [BUNDLED_LIBRARY_ID, ...activeLibraryIds];
    }
  } else if (existing.bundled && (existing.tokenCount || 0) < bundled.tokenCount) {
    libraries = libraries.map((l) => (l.id === BUNDLED_LIBRARY_ID ? bundled : l));
  }

  await chrome.storage.local.set({ libraries, activeLibraryIds });
  return { libraries, activeLibraryIds };
}

chrome.runtime.onInstalled.addListener(() => {
  ensureBundledLibrary().catch(console.error);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    return;
  }
  try {
    await ensurePageScripts(tab.id);
    await sendToTab(tab.id, { type: 'TOGGLE_PANEL' });
  } catch (e) {
    console.error('Failed to toggle DS Auditor panel', e);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_LIBRARIES') {
    ensureBundledLibrary()
      .then((data) => safeSendResponse(sendResponse, data))
      .catch((e) => safeSendResponse(sendResponse, { libraries: [], activeLibraryIds: [], error: e.message }));
    return true;
  }

  if (msg.type === 'SAVE_LIBRARIES') {
    const libraries = (msg.libraries || []).map((l) => {
      if (l.id === BUNDLED_LIBRARY_ID) return { ...l, bundled: true };
      return l;
    });
    chrome.storage.local.set(
      { libraries, activeLibraryIds: msg.activeLibraryIds },
      () => safeSendResponse(sendResponse, { ok: true })
    );
    return true;
  }

  if (msg.type === 'RUN_AUDIT_ON_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        safeSendResponse(sendResponse, { error: 'No active tab' });
        return;
      }
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        safeSendResponse(sendResponse, { error: 'Cannot audit this page. Open a regular website tab.' });
        return;
      }

      const payload = { type: 'RUN_AUDIT', tokens: msg.tokens, pageUrl: tab.url };

      try {
        const result = await sendToTab(tab.id, payload);
        if (result && typeof result === 'object' && !result.error) {
          safeSendResponse(sendResponse, { ...result, tabId: tab.id });
        } else {
          safeSendResponse(sendResponse, result || { error: 'Audit failed' });
        }
      } catch (e) {
        safeSendResponse(sendResponse, { error: e.message || 'Failed to run audit on this tab' });
      }
    });
    return true;
  }

  // Hover preview — respond immediately; relay async without holding the port open.
  if (msg.type === 'HIGHLIGHT_ELEMENT') {
    safeSendResponse(sendResponse, { ok: true });
    const tabId = msg.tabId;
    const payload = {
      type: 'HIGHLIGHT',
      elementRef: msg.elementRef,
      selector: msg.selector,
      scroll: msg.scroll,
    };
    if (tabId) {
      relayToTab(tabId, payload);
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        relayToTab(tabs[0]?.id, payload);
      });
    }
    return false;
  }

  if (msg.type === 'CLEAR_HIGHLIGHT') {
    safeSendResponse(sendResponse, { ok: true });
    const tabId = msg.tabId;
    const payload = { type: 'CLEAR_HIGHLIGHT' };
    if (tabId) {
      relayToTab(tabId, payload);
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        relayToTab(tabs[0]?.id, payload);
      });
    }
    return false;
  }

  if (msg.type === 'APPLY_FIX') {
    const tabId = msg.tabId;
    const payload = {
      type: 'APPLY_FIX',
      elementRef: msg.elementRef,
      selector: msg.selector,
      property: msg.property,
      tokenName: msg.tokenName,
      cssValue: msg.cssValue,
      tokens: msg.tokens,
    };

    const finish = (result) => safeSendResponse(sendResponse, result || { ok: false, error: 'No response' });

    if (tabId) {
      sendToTab(tabId, payload).then(finish).catch((e) => finish({ ok: false, error: e.message }));
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        sendToTab(tabs[0]?.id, payload).then(finish).catch((e) => finish({ ok: false, error: e.message }));
      });
    }
    return true;
  }

  if (msg.type === 'APPLY_ALL_FIXES') {
    const tabId = msg.tabId;
    const payload = {
      type: 'APPLY_ALL_FIXES',
      fixes: msg.fixes,
      tokens: msg.tokens,
    };
    const finish = (result) => safeSendResponse(sendResponse, result || { ok: false, error: 'No response' });

    if (tabId) {
      sendToTab(tabId, payload).then(finish).catch((e) => finish({ ok: false, error: e.message }));
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        sendToTab(tabs[0]?.id, payload).then(finish).catch((e) => finish({ ok: false, error: e.message }));
      });
    }
    return true;
  }

  if (msg.type === 'CLEAR_ALL_FIXES') {
    const tabId = msg.tabId;
    const payload = { type: 'CLEAR_ALL_FIXES' };
    const finish = (result) => safeSendResponse(sendResponse, result || { ok: false, error: 'No response' });

    if (tabId) {
      sendToTab(tabId, payload).then(finish).catch((e) => finish({ ok: false, error: e.message }));
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        sendToTab(tabs[0]?.id, payload).then(finish).catch((e) => finish({ ok: false, error: e.message }));
      });
    }
    return true;
  }

  if (msg.type === 'GET_FIX_STATE') {
    const tabId = msg.tabId;
    const payload = { type: 'GET_FIX_STATE' };
    const finish = (result) => safeSendResponse(sendResponse, result || { ok: false, active: false, count: 0 });

    if (tabId) {
      sendToTab(tabId, payload).then(finish).catch(() => finish({ ok: false, active: false, count: 0 }));
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        sendToTab(tabs[0]?.id, payload).then(finish).catch(() => finish({ ok: false, active: false, count: 0 }));
      });
    }
    return true;
  }

  return false;
});
