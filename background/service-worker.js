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
  'lib/a11y-auditor.js',
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

const CONTENT_SCRIPT_VERSION = 4;

async function ensurePageScripts(tabId, options) {
  const needA11y = !!(options && options.needA11y);
  const needTokens = !!(options && options.needTokens);
  const ping = await sendMessageOnce(tabId, { type: 'PING' });
  const versionOk = ping && ping.ok && (ping.version || 0) >= CONTENT_SCRIPT_VERSION;
  const a11yOk = !needA11y || (ping && ping.a11y);
  const tokensOk = !needTokens || (ping && ping.tokens);
  if (versionOk && a11yOk && tokensOk) return;
  await injectPageScripts(tabId);
}

async function sendToTab(tabId, payload) {
  if (!tabId) return { ok: false, error: 'No tab' };

  const needA11y = payload && payload.type === 'RUN_A11Y_AUDIT';
  const needTokens = payload && payload.type === 'RUN_AUDIT';

  try {
    if (needA11y || needTokens) {
      await ensurePageScripts(tabId, { needA11y, needTokens });
    }

    let result = await sendMessageOnce(tabId, payload);
    if (result !== undefined) return result;

    await ensurePageScripts(tabId, { needA11y, needTokens });
    result = await sendMessageOnce(tabId, payload);
    if (result !== undefined) return result;

    if (needA11y) {
      const ping = await sendMessageOnce(tabId, { type: 'PING' });
      if (!ping || !ping.a11y) {
        return {
          error: 'Accessibility auditor not loaded. Refresh the page and run the audit again.',
        };
      }
    }
    if (needTokens) {
      const ping = await sendMessageOnce(tabId, { type: 'PING' });
      if (!ping || !ping.tokens) {
        return {
          error: 'Design token auditor not loaded. Refresh the page and run the audit again.',
        };
      }
    }
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
    await sendToTab(tab.id, {
      type: 'TOGGLE_PANEL',
      tabId: tab.id,
      pageUrl: tab.url,
    });
  } catch (e) {
    console.error('Failed to toggle DS Auditor panel', e);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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

  // Resolve the tab that hosts the embedded panel / content script.
  // Prefer sender.tab — activeTab query is unreliable from extension iframes.
  if (msg.type === 'WHO_AM_I' || msg.type === 'GET_ACTIVE_TAB') {
    if (sender && sender.tab && sender.tab.id) {
      safeSendResponse(sendResponse, {
        tab: sender.tab,
        tabId: sender.tab.id,
        pageUrl: sender.tab.url || null,
      });
      return false;
    }
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs[0] || null;
      safeSendResponse(sendResponse, {
        tab,
        tabId: tab && tab.id,
        pageUrl: tab && tab.url,
      });
    });
    return true;
  }

  if (msg.type === 'RUN_AUDIT_ON_TAB') {
    const runOnTab = async () => {
      // Host tab from embedded popup iframe is the most reliable source.
      let tabId = msg.tabId || (sender && sender.tab && sender.tab.id);
      let pageUrl = msg.pageUrl || (sender && sender.tab && sender.tab.url);

      if (!tabId) {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        tabId = tabs[0]?.id;
        pageUrl = pageUrl || tabs[0]?.url;
      }

      if (tabId) {
        try {
          const tab = await chrome.tabs.get(tabId);
          pageUrl = tab?.url || pageUrl;
        } catch {
          // tab may have closed
        }
      }

      if (!tabId) {
        safeSendResponse(sendResponse, {
          error: 'Could not detect the current browser tab. Close and reopen the DS Auditor panel.',
        });
        return;
      }
      if (!pageUrl || pageUrl.startsWith('chrome://') || pageUrl.startsWith('chrome-extension://') || pageUrl.startsWith('edge://') || pageUrl.startsWith('about:')) {
        safeSendResponse(sendResponse, { error: 'Cannot audit this page. Open a regular website tab.' });
        return;
      }

      const auditType = msg.auditMode === 'a11y' ? 'RUN_A11Y_AUDIT' : 'RUN_AUDIT';
      const payload = {
        type: auditType,
        tokens: msg.tokens,
        pageUrl: pageUrl,
      };

      try {
        const result = await sendToTab(tabId, payload);
        if (result && typeof result === 'object' && !result.error) {
          safeSendResponse(sendResponse, { ...result, tabId, auditMode: msg.auditMode || 'tokens' });
        } else {
          safeSendResponse(sendResponse, result || { error: 'Audit failed. Refresh the page and try again.' });
        }
      } catch (e) {
        safeSendResponse(sendResponse, { error: e.message || 'Failed to run audit on this tab' });
      }
    };
    runOnTab();
    return true;
  }

  // Hover preview — respond immediately; relay async without holding the port open.
  if (msg.type === 'HIGHLIGHT_ELEMENT') {
    safeSendResponse(sendResponse, { ok: true });
    const tabId = msg.tabId || (sender && sender.tab && sender.tab.id);
    const payload = {
      type: 'HIGHLIGHT',
      elementRef: msg.elementRef,
      selector: msg.selector,
      scroll: msg.scroll,
    };
    if (tabId) {
      relayToTab(tabId, payload);
    } else {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        relayToTab(tabs[0]?.id, payload);
      });
    }
    return false;
  }

  if (msg.type === 'CLEAR_HIGHLIGHT') {
    safeSendResponse(sendResponse, { ok: true });
    const tabId = msg.tabId || (sender && sender.tab && sender.tab.id);
    const payload = { type: 'CLEAR_HIGHLIGHT' };
    if (tabId) {
      relayToTab(tabId, payload);
    } else {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        relayToTab(tabs[0]?.id, payload);
      });
    }
    return false;
  }

  if (msg.type === 'APPLY_FIX') {
    const tabId = msg.tabId || (sender && sender.tab && sender.tab.id);
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
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        sendToTab(tabs[0]?.id, payload).then(finish).catch((e) => finish({ ok: false, error: e.message }));
      });
    }
    return true;
  }

  if (msg.type === 'APPLY_ALL_FIXES') {
    const tabId = msg.tabId || (sender && sender.tab && sender.tab.id);
    const payload = {
      type: 'APPLY_ALL_FIXES',
      fixes: msg.fixes,
      tokens: msg.tokens,
    };
    const finish = (result, usedTabId) =>
      safeSendResponse(sendResponse, Object.assign({ ok: false, error: 'No response' }, result || {}, { tabId: usedTabId || tabId }));

    if (tabId) {
      sendToTab(tabId, payload).then((r) => finish(r, tabId)).catch((e) => finish({ ok: false, error: e.message }, tabId));
    } else {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const id = tabs[0]?.id;
        sendToTab(id, payload).then((r) => finish(r, id)).catch((e) => finish({ ok: false, error: e.message }, id));
      });
    }
    return true;
  }

  if (msg.type === 'CLEAR_ALL_FIXES') {
    const tabId = msg.tabId || (sender && sender.tab && sender.tab.id);
    const payload = { type: 'CLEAR_ALL_FIXES' };
    const finish = (result, usedTabId) =>
      safeSendResponse(sendResponse, Object.assign({ ok: false, error: 'No response' }, result || {}, { tabId: usedTabId || tabId }));

    if (tabId) {
      sendToTab(tabId, payload).then((r) => finish(r, tabId)).catch((e) => finish({ ok: false, error: e.message }, tabId));
    } else {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const id = tabs[0]?.id;
        sendToTab(id, payload).then((r) => finish(r, id)).catch((e) => finish({ ok: false, error: e.message }, id));
      });
    }
    return true;
  }

  if (msg.type === 'GET_FIX_STATE') {
    const tabId = msg.tabId || (sender && sender.tab && sender.tab.id);
    const payload = { type: 'GET_FIX_STATE' };
    const finish = (result) => safeSendResponse(sendResponse, result || { ok: false, active: false, count: 0 });

    if (tabId) {
      sendToTab(tabId, payload).then(finish).catch(() => finish({ ok: false, active: false, count: 0 }));
    } else {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        sendToTab(tabs[0]?.id, payload).then(finish).catch(() => finish({ ok: false, active: false, count: 0 }));
      });
    }
    return true;
  }

  return false;
});
