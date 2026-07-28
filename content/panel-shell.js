/**
 * Floating in-page panel shell — drag, minimize, viewport clamping.
 */
(function () {
  'use strict';

  if (window.__dsAuditorPanelInit) return;
  window.__dsAuditorPanelInit = true;

  var HOST_ID = 'ds-auditor-panel-host';
  var STORAGE_KEY = 'dsAuditorPanelState';
  var PANEL_WIDTH = 420;
  var PANEL_HEIGHT = 640;
  var PANEL_MARGIN = 12;
  var MIN_VISIBLE = 48;

  var hostEl = null;
  var panelEl = null;
  var frameEl = null;
  var minimizeBtn = null;
  var closeBtn = null;
  var contextTabId = null;
  var contextPageUrl = null;
  var visible = false;
  var minimized = false;
  var dragging = false;
  var dragOffsetX = 0;
  var dragOffsetY = 0;
  var panelLeft = PANEL_MARGIN;
  var panelTop = PANEL_MARGIN;

  function getViewportSize() {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }

  function getPanelSize() {
    if (!panelEl) {
      return { width: PANEL_WIDTH, height: PANEL_HEIGHT };
    }
    var rect = panelEl.getBoundingClientRect();
    return {
      width: Math.ceil(rect.width) || PANEL_WIDTH,
      height: Math.ceil(rect.height) || (minimized ? MIN_VISIBLE : PANEL_HEIGHT),
    };
  }

  function clampPosition(left, top) {
    var vp = getViewportSize();
    var size = getPanelSize();
    var maxLeft = vp.width - size.width - PANEL_MARGIN;
    var maxTop = vp.height - size.height - PANEL_MARGIN;

    if (maxLeft < PANEL_MARGIN) maxLeft = PANEL_MARGIN;
    if (maxTop < PANEL_MARGIN) maxTop = PANEL_MARGIN;

    return {
      left: Math.max(PANEL_MARGIN, Math.min(left, maxLeft)),
      top: Math.max(PANEL_MARGIN, Math.min(top, maxTop)),
    };
  }

  function defaultPosition() {
    var vp = getViewportSize();
    var size = getPanelSize();
    return clampPosition(vp.width - size.width - PANEL_MARGIN, PANEL_MARGIN);
  }

  function applyPosition(left, top) {
    var clamped = clampPosition(left, top);
    panelLeft = clamped.left;
    panelTop = clamped.top;
    panelEl.style.left = panelLeft + 'px';
    panelEl.style.top = panelTop + 'px';
  }

  function saveState() {
    if (!chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.set({
      [STORAGE_KEY]: {
        left: panelLeft,
        top: panelTop,
        minimized: minimized,
      },
    });
  }

  function loadState(callback) {
    if (!chrome.storage || !chrome.storage.local) {
      callback(null);
      return;
    }
    chrome.storage.local.get(STORAGE_KEY, function (data) {
      callback(data && data[STORAGE_KEY] ? data[STORAGE_KEY] : null);
    });
  }

  function updateMinimizeIcon() {
    if (!minimizeBtn) return;
    if (minimized) {
      minimizeBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
          '<polyline points="18 15 12 9 6 15"/>' +
        '</svg>';
    } else {
      minimizeBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
          '<line x1="5" y1="12" x2="19" y2="12"/>' +
        '</svg>';
    }
  }

  function setMinimized(next) {
    minimized = !!next;
    panelEl.classList.toggle('is-minimized', minimized);
    if (minimizeBtn) {
      minimizeBtn.title = minimized ? 'Expand panel' : 'Minimize panel';
      minimizeBtn.setAttribute('aria-label', minimizeBtn.title);
      updateMinimizeIcon();
    }
    applyPosition(panelLeft, panelTop);
    saveState();
  }

  function setVisible(next) {
    visible = !!next;
    panelEl.classList.toggle('is-hidden', !visible);
    if (visible) {
      applyPosition(panelLeft, panelTop);
      notifyIframeContext();
    }
  }

  function onPointerMove(e) {
    if (!dragging) return;
    applyPosition(e.clientX - dragOffsetX, e.clientY - dragOffsetY);
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    panelEl.classList.remove('is-dragging');
    saveState();
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
  }

  function onTitlebarPointerDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest('.panel-icon-btn')) return;

    dragging = true;
    panelEl.classList.add('is-dragging');
    dragOffsetX = e.clientX - panelLeft;
    dragOffsetY = e.clientY - panelTop;
    e.preventDefault();

    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
  }

  function notifyIframeContext() {
    if (!frameEl || !frameEl.contentWindow) return;
    contextPageUrl = location.href;
    frameEl.contentWindow.postMessage({
      source: 'ds-auditor-panel',
      type: 'PANEL_CONTEXT',
      tabId: contextTabId,
      pageUrl: contextPageUrl,
    }, '*');
  }

  function setPanelContext(tabId, pageUrl) {
    if (tabId) contextTabId = tabId;
    if (pageUrl) contextPageUrl = pageUrl;
    else contextPageUrl = location.href;
    notifyIframeContext();
  }

  function resolveHostTab(done) {
    if (contextTabId) {
      if (done) done(contextTabId);
      return;
    }
    chrome.runtime.sendMessage({ type: 'WHO_AM_I' }, function (res) {
      if (chrome.runtime.lastError) {
        if (done) done(null);
        return;
      }
      if (res && res.tabId) {
        setPanelContext(res.tabId, res.pageUrl || location.href);
        if (done) done(res.tabId);
        return;
      }
      if (done) done(null);
    });
  }

  function onWindowResize() {
    if (!panelEl) return;
    applyPosition(panelLeft, panelTop);
  }

  function syncPageUrlFromLocation() {
    if (contextPageUrl === location.href) return;
    contextPageUrl = location.href;
    notifyIframeContext();
  }

  window.addEventListener('message', function (e) {
    if (!e.data || e.data.source !== 'ds-auditor-popup') return;
    if (e.data.type === 'REQUEST_PANEL_CONTEXT') {
      resolveHostTab(function () {
        notifyIframeContext();
      });
    }
  });

  function ensurePanel(callback) {
    if (hostEl && panelEl) {
      resolveHostTab(function () {
        notifyIframeContext();
        callback();
      });
      return;
    }

    hostEl = document.createElement('div');
    hostEl.id = HOST_ID;
    hostEl.setAttribute('data-ds-auditor-ui', 'panel-host');

    var shadow = hostEl.attachShadow({ mode: 'open' });
    var cssUrl = chrome.runtime.getURL('content/panel-shell.css');
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssUrl;
    shadow.appendChild(link);

    panelEl = document.createElement('div');
    panelEl.className = 'panel-root is-hidden';
    panelEl.style.left = panelLeft + 'px';
    panelEl.style.top = panelTop + 'px';

    var titlebar = document.createElement('div');
    titlebar.className = 'panel-titlebar';

    var grip = document.createElement('div');
    grip.className = 'panel-grip';
    grip.innerHTML = '<span></span><span></span>';
    grip.setAttribute('aria-hidden', 'true');

    var title = document.createElement('div');
    title.className = 'panel-title';
    title.innerHTML = 'DS Auditor <span class="panel-title-badge">Web</span>';

    var actions = document.createElement('div');
    actions.className = 'panel-titlebar-actions';

    minimizeBtn = document.createElement('button');
    minimizeBtn.type = 'button';
    minimizeBtn.className = 'panel-icon-btn panel-minimize-btn';
    minimizeBtn.title = 'Minimize panel';
    minimizeBtn.setAttribute('aria-label', 'Minimize panel');
    updateMinimizeIcon();
    minimizeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setMinimized(!minimized);
    });

    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'panel-icon-btn panel-close-btn';
    closeBtn.title = 'Close panel';
    closeBtn.setAttribute('aria-label', 'Close panel');
    closeBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
        '<line x1="18" y1="6" x2="6" y2="18"/>' +
        '<line x1="6" y1="6" x2="18" y2="18"/>' +
      '</svg>';
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      hidePanel();
    });

    actions.appendChild(minimizeBtn);
    actions.appendChild(closeBtn);
    titlebar.appendChild(grip);
    titlebar.appendChild(title);
    titlebar.appendChild(actions);
    titlebar.addEventListener('pointerdown', onTitlebarPointerDown);

    var body = document.createElement('div');
    body.className = 'panel-body';

    frameEl = document.createElement('iframe');
    frameEl.className = 'panel-frame';
    frameEl.src = chrome.runtime.getURL('popup/popup.html?embedded=1');
    frameEl.title = 'DS Auditor';
    frameEl.addEventListener('load', function () {
      resolveHostTab(function () {
        notifyIframeContext();
      });
    });
    body.appendChild(frameEl);

    panelEl.appendChild(titlebar);
    panelEl.appendChild(body);
    shadow.appendChild(panelEl);
    document.documentElement.appendChild(hostEl);

    window.addEventListener('resize', onWindowResize, true);

    loadState(function (state) {
      if (state && typeof state.left === 'number' && typeof state.top === 'number') {
        panelLeft = state.left;
        panelTop = state.top;
        minimized = !!state.minimized;
      } else {
        var pos = defaultPosition();
        panelLeft = pos.left;
        panelTop = pos.top;
      }
      applyPosition(panelLeft, panelTop);
      setMinimized(minimized);
      resolveHostTab(function () {
        callback();
      });
    });
  }

  function togglePanel() {
    ensurePanel(function () {
      if (visible) {
        setVisible(false);
      } else {
        setVisible(true);
        applyPosition(panelLeft, panelTop);
      }
    });
  }

  function showPanel() {
    ensurePanel(function () {
      setVisible(true);
      applyPosition(panelLeft, panelTop);
    });
  }

  function hidePanel() {
    if (!panelEl) return;
    setVisible(false);
    if (minimized) setMinimized(false);
    try {
      chrome.runtime.sendMessage({ type: 'CLEAR_HIGHLIGHT', tabId: contextTabId });
    } catch (e) { /* ignore */ }
  }

  window.DSAuditorPanel = {
    toggle: togglePanel,
    show: showPanel,
    hide: hidePanel,
    isVisible: function () { return visible; },
  };

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (sender && sender.tab) {
      setPanelContext(sender.tab.id, sender.tab.url || location.href);
    }
    if (msg.type === 'TOGGLE_PANEL') {
      if (msg.tabId) setPanelContext(msg.tabId, msg.pageUrl || location.href);
      else syncPageUrlFromLocation();
      togglePanel();
      sendResponse({ ok: true, visible: visible });
      return;
    }
    if (msg.type === 'SHOW_PANEL') {
      if (msg.tabId) setPanelContext(msg.tabId, msg.pageUrl || location.href);
      showPanel();
      sendResponse({ ok: true, visible: visible });
      return;
    }
    if (msg.type === 'HIDE_PANEL') {
      hidePanel();
      sendResponse({ ok: true, visible: visible });
      return;
    }
  });

  window.addEventListener('popstate', syncPageUrlFromLocation);
  window.addEventListener('hashchange', syncPageUrlFromLocation);
  try {
    var _pushState = history.pushState;
    var _replaceState = history.replaceState;
    history.pushState = function () {
      var ret = _pushState.apply(this, arguments);
      setTimeout(syncPageUrlFromLocation, 0);
      return ret;
    };
    history.replaceState = function () {
      var ret = _replaceState.apply(this, arguments);
      setTimeout(syncPageUrlFromLocation, 0);
      return ret;
    };
  } catch (e) { /* ignore */ }
})();
