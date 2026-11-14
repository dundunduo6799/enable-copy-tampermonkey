// ==UserScript==
// @name         解锁复制(选中/右键/Ctrl+C)
// @name:en      Enable Copy & Right-Click
// @namespace    local.demo.copy-unlock
// @version      1.7.1
// @description  解除网页「禁止复制 / 禁止粘贴」限制:恢复文字选中、右键菜单;复制被拦时自动补写剪贴板;粘贴被拦时把内容当作手动录入写进输入框(文字、截图/图片都支持);「自动输入面板」可把任意内容写进网页输入框(含超星学习通答题框等 UEditor/iframe 编辑器)。开关按网站分别记忆。
// @description:en  Re-enable text selection, context menu and copy/cut on pages that block them.
// @author       demo
// @license      MIT
// @updateURL    https://cdn.jsdelivr.net/gh/dundunduo6799/enable-copy-tampermonkey@main/enable-copy.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/dundunduo6799/enable-copy-tampermonkey@main/enable-copy.user.js
// @match        *://*/*
// @match        file:///*
// @match        about:blank*
// @exclude      https://docs.google.com/*
// @exclude      https://*.office.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  /* ===================== 基本信息 ===================== */
  var STYLE_ID = '__copy_unlock_style__';
  // 页面真正的 window(油猴沙箱里要用 unsafeWindow 才能和页面互通)
  var pageWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  // 开关按「网站」分别记忆:在 A 站关闭,不影响 B 站
  var SITE_KEY = 'copyUnlockEnabled:' + (location.host || 'file');
  var enabled = true;
  try {
    if (typeof GM_getValue === 'function') enabled = GM_getValue(SITE_KEY, true);
  } catch (err) { /* 读取失败就默认开启 */ }

  /* ===================== 第 1 层对抗:CSS =====================
   * 网站用 user-select: none 禁止选中文字,
   * 我们用一条 !important 的全局样式把它顶回去。
   */
  var CSS = '*, *::before, *::after { -webkit-user-select: text !important; user-select: text !important; }';

  function addStyle() {
    if (!enabled || document.getElementById(STYLE_ID)) return;
    var parent = document.head || document.documentElement;
    if (!parent) return;                    // DOM 还没准备好,DOMContentLoaded 时会再补
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    parent.appendChild(style);
  }

  function removeStyle() {
    var style = document.getElementById(STYLE_ID);
    if (style) style.parentNode.removeChild(style);
  }

  /* ===================== 第 2 层对抗:事件抢答 =====================
   * 网站靠在 contextmenu / selectstart 上调用 event.preventDefault()
   * 来阻止右键和选择。
   * 我们在【捕获阶段 + window 最顶层】用 stopImmediatePropagation()
   * 把事件吞掉:网站自己的监听器根本收不到,自然无法阻止默认行为。
   * (@run-at document-start 保证我们比网站的所有脚本都先动手)
   *
   * 注意:copy / cut 故意不在这里吞 —— 因为很多网站自己的「复制按钮」
   * 也要监听 copy 事件写剪贴板,吞掉会误伤它们(见第 3 层的「营救」)。
   */
  var GUARDED_EVENTS = ['contextmenu', 'selectstart'];

  function swallowEvent(e) {
    if (enabled) e.stopImmediatePropagation();
  }

  function swallowKeys(e) {
    if (!enabled) return;
    var k = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (k === 'c' || k === 'x' || k === 'a' || k === 's' || k === 'v')) {
      e.stopImmediatePropagation();         // 网站拦不到快捷键 → 浏览器默认复制/粘贴照常进行
    }
  }

  GUARDED_EVENTS.forEach(function (type) {
    window.addEventListener(type, swallowEvent, true);
  });
  window.addEventListener('keydown', swallowKeys, true);

  /* ===================== 第 3 层对抗:复制「营救」 =====================
   * 有的网站在 copy / cut 事件里 preventDefault() 让剪贴板拿不到内容。
   * 我们不阻止事件,而是在事件跑完之后检查:
   * 如果被网站拦了(defaultPrevented)且当前有选中的文字,
   * 就把选中的内容手动补写进剪贴板。
   * 这样既不破坏网站自己的「复制按钮」,又能保证复制成功。
   */
  function rescueCopy(e) {
    if (!enabled || !e.defaultPrevented) return;
    var sel = window.getSelection();
    var text = sel ? String(sel) : '';
    if (!text) return;                      // 没有选中内容就不动手(比如点了网站的复制按钮)
    try {
      if (typeof GM_setClipboard === 'function') { GM_setClipboard(text); return; }
    } catch (err) { /* 继续尝试备用方案 */ }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      }
    } catch (err) { /* 都失败就算了,不影响页面 */ }
  }
  window.addEventListener('copy', rescueCopy);
  window.addEventListener('cut', rescueCopy);

  /* ===================== 第 3.5 层对抗:粘贴「营救」 =====================
   * 很多录入型网站(OA / 题库 / 后台)在 paste 事件里 preventDefault(),
   * 还弹「只能录入不能粘贴」。
   * 我们不阻止事件,而是在事件跑完之后检查:
   * 如果被网站拦了,就读出剪贴板文字,用「模拟打字」的方式写进当前输入框
   * (execCommand('insertText') 产生的事件和手动打字一模一样,
   *  网站的校验分辨不出来)。
   */
  function isEditableElement(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') {
      var t = (el.type || 'text').toLowerCase();
      return ['text', 'search', 'url', 'tel', 'password', 'email', 'number', ''].indexOf(t) !== -1;
    }
    return !!el.isContentEditable;
  }

  function rescuePaste(e) {
    if (!enabled || !e.defaultPrevented) return;
    var text = '';
    try {
      text = e.clipboardData ? (e.clipboardData.getData('text/plain') || '') : '';
    } catch (err) { /* 读不到就算了 */ }
    if (!text) {
      // 剪贴板里是图片/截图时:把图片作为 <img> 插进富文本编辑器
      var imgF = null;
      try {
        var fl = e.clipboardData && e.clipboardData.files;
        if (fl && fl.length && /^image\//.test(fl[0].type)) imgF = fl[0];
      } catch (err) { /* 忽略 */ }
      if (!imgF) return;
      var tel = document.activeElement;
      if (!tel || !tel.isContentEditable) return;   // 普通输入框装不了图片
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var html = '<img src="' + rd.result + '">';
          var ue2 = findUEFor(tel);
          if (ue2) { insertViaUE(ue2, html, true); }
          else { (tel.ownerDocument || document).execCommand('insertHTML', false, html); }
        } catch (err) { /* 忽略 */ }
      };
      rd.readAsDataURL(imgF);
      return;
    }
    var el = document.activeElement;
    if (!isEditableElement(el)) return;     // 焦点不在输入框就不动手

    // ① 富文本编辑器 / contenteditable:模拟打字插入
    if (el.isContentEditable) {
      try { document.execCommand('insertText', false, text); return; } catch (err) { /* 走备用 */ }
    }
    // ② input / textarea:直接在光标处插入文字
    try {
      if (el.selectionStart != null && el.selectionEnd != null) {
        el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
    } catch (err) { /* 走备用 */ }
    // ③ 最后的备用方案
    try { document.execCommand('insertText', false, text); } catch (err) { /* 都失败就算了 */ }
  }
  window.addEventListener('paste', rescuePaste);

  /* ===================== 附加功能:自动输入面板 =====================
   * 点篡改猴菜单里的「📋 自动输入面板」打开(面板悬浮在网页右上角):
   *   第 1 步:把内容粘贴进面板的文本框(这里永远允许粘贴,网站拦不到);
   *   第 2 步:点一下网页里的目标输入框;
   *   第 3 步:点「逐字输入」或「一次性输入」—— 内容会被当作手动打字写进去。
   */
  var lastFocusedEditable = null;       // 记住你最后点过/选定的输入框

  /* —— 目标上报:iframe 里的输入框也能被主页面面板"看见" —— */
  function reportTarget(el) {
    try {
      // 面板自己永远不能当目标(否则就会出现"往面板里输入"的怪事)
      if (el && el.closest && el.closest('#' + PANEL_ID)) return;
    } catch (err) { /* 忽略 */ }
    lastFocusedEditable = el;
    updateTargetLine();
    try {
      var top = window.top;
      if (top && top !== window && typeof top.__aiAcceptTarget === 'function') {
        top.__aiAcceptTarget(window, el);   // 告诉顶层:目标在我这个 iframe 里
      }
    } catch (err) { /* 跨域 iframe 无法上报,仅本窗口使用 */ }
  }

  document.addEventListener('focusin', function (e) {
    if (isEditableElement(e.target)) reportTarget(e.target);
  }, true);

  // 顶层接收上报(同源 iframe 才够得着;答题系统的编辑器 iframe 一般是同源的)
  try {
    pageWindow.__aiAcceptTarget = function (win, el) {
      lastFocusedEditable = el;
      updateTargetLine();
      setStatusMsg('🎯 已锁定目标:' + describeTarget(el));
    };
  } catch (err) { /* 忽略 */ }

  // 遍历本页 + 所有同源 iframe(挑选模式要用)
  function eachFrame(fn) {
    fn(window);
    collect(document);
    function collect(doc) {
      var list = doc.querySelectorAll('iframe');
      for (var i = 0; i < list.length; i++) {
        try {
          var w = list[i].contentWindow;
          if (w && w.__aiStartPickLocal) { fn(w); collect(w.document); }
        } catch (err) { /* 跨域 iframe 放弃 */ }
      }
    }
  }

  /* —— 目标的描述与显示 —— */
  /* —— 往上找:点击图片/段落等"内部元素"时,找到它所属的可编辑框 —— */
  function nearestEditable(node) {
    var n = node;
    while (n && n.tagName) {
      if (isEditableElement(n)) return n;
      try { n = n.parentNode; } catch (err) { return null; }
    }
    return null;
  }

  function describeTarget(el) {
    if (!el) return '还没选';
    var label = el.tagName.toLowerCase();
    if (label === 'input') label += '[' + (el.type || 'text') + ']';
    var hint = '';
    try {
      hint = el.getAttribute('placeholder') || el.getAttribute('aria-label') ||
             el.getAttribute('name') || el.getAttribute('id') || '';
    } catch (err) { /* 有些元素不让读属性 */ }
    hint = (hint || '').trim();
    if (hint.length > 18) hint = hint.slice(0, 18) + '…';
    return label + (hint ? '「' + hint + '」' : '');
  }

  function updateTargetLine() {
    var line = document.getElementById('__ai_target__');
    if (line) line.textContent = '🎯 目标:' + describeTarget(lastFocusedEditable);
  }

  function setStatusMsg(text, color) {
    var s = document.getElementById('__ai_status__');
    if (s) { s.textContent = text; s.style.color = color || '#15803d'; }
  }

  /* —— 输入时让目标"现身":滚动过去 + 高亮闪烁(iframe 里的目标连 iframe 一起滚)—— */
  function revealTarget(el) {
    try { el.scrollIntoView({ block: 'center' }); } catch (err) {
      try { el.scrollIntoView(); } catch (err2) { /* 滚不动就算了 */ }
    }
    try {
      // 目标在 iframe 里时,把外面的 iframe 元素也滚到屏幕中央
      var win = el.ownerDocument && el.ownerDocument.defaultView;
      var depth = 0;
      while (win && win.frameElement && depth < 5) {
        win.frameElement.scrollIntoView({ block: 'center' });
        win = win.parent;
        depth++;
      }
    } catch (err) { /* 跨域就不管了 */ }
    var saved = { o: el.style.outline, off: el.style.outlineOffset };
    el.style.outline = '4px solid #22c55e';
    el.style.outlineOffset = '1px';
    setTimeout(function () {
      try { el.style.outline = saved.o; el.style.outlineOffset = saved.off; } catch (err) { /* 忽略 */ }
    }, 1800);
  }

  /* —— 🎯 挑选目标模式:悬停亮橙框,点谁输谁 —— */
  var pickMode = false;
  var hoveredEl = null, savedOutline = null, savedOffset = null;

  function clearHover() {
    if (hoveredEl) {
      hoveredEl.style.outline = savedOutline;
      hoveredEl.style.outlineOffset = savedOffset;
      hoveredEl = null;
    }
  }

  function pickHover(e) {
    var t = nearestEditable(e.target);
    if (!t || t === hoveredEl) return;
    clearHover();
    hoveredEl = t;
    savedOutline = hoveredEl.style.outline;
    savedOffset = hoveredEl.style.outlineOffset;
    hoveredEl.style.outline = '3px solid #f59e0b';
    hoveredEl.style.outlineOffset = '1px';
  }

  function pickOut(e) { if (e.target === hoveredEl) clearHover(); }

  function pickClick(e) {
    if (e.target.closest && e.target.closest('#' + PANEL_ID)) { stopLocalPick(); return; }
    e.preventDefault();
    e.stopPropagation();
    stopLocalPick();
    var t = nearestEditable(e.target);     // 点到图片/文字等内部元素也照样能选中整个框
    if (t) {
      reportTarget(t);                     // 本窗口记录 + 上报给顶层面板
      setStatusMsg('✅ 已选定目标:' + describeTarget(t));
    } else {
      setStatusMsg('那个不是输入框,重新点 🎯 选一个', '#b91c1c');
    }
  }

  function pickKeydown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      stopLocalPick();
      setStatusMsg('已取消选择', '#64748b');
    }
  }

  function stopLocalPick() {
    if (!pickMode) return;
    pickMode = false;
    document.removeEventListener('mouseover', pickHover, true);
    document.removeEventListener('mouseout', pickOut, true);
    document.removeEventListener('click', pickClick, true);
    document.removeEventListener('keydown', pickKeydown, true);
    clearHover();
  }

  function startLocalPick() {
    if (pickMode) return;
    pickMode = true;
    document.addEventListener('mouseover', pickHover, true);
    document.addEventListener('mouseout', pickOut, true);
    document.addEventListener('click', pickClick, true);
    document.addEventListener('keydown', pickKeydown, true);
  }

  function startPickMode() {
    if (pickMode) { stopPickMode(); return; }
    pickMode = true;
    startLocalPick();
    setStatusMsg('🎯 请在网页里点一下目标输入框(按 Esc 取消)', '#92400e');
    // 让所有同源 iframe 也进入挑选模式:里面的编辑器照样能悬停高亮、点击选定
    eachFrame(function (w) {
      try { if (w !== window && w.__aiStartPickLocal) w.__aiStartPickLocal(); } catch (err) { /* 忽略 */ }
    });
    // UEditor 这类 about:blank iframe 里没有我们的脚本,直接从主页面把监听挂进去
    hookFrameFocus();
    hookUEPaste();
    hookFramePaste();
    hookFramePick(true);
  }

  function stopPickMode() {
    if (!pickMode) return;
    pickMode = false;
    stopLocalPick();
    eachFrame(function (w) {
      try { if (w !== window && w.__aiStopPickLocal) w.__aiStopPickLocal(); } catch (err) { /* 忽略 */ }
    });
    hookFramePick(false);
  }

  var PANEL_ID = '__auto_input_panel__';
  var BTN_STYLE = 'padding:7px 10px;border:none;border-radius:8px;background:#4f46e5;color:#ffffff;' +
    'font-weight:600;font-size:12.5px;cursor:pointer;font-family:inherit';
  var BTN_STYLE_GRAY = 'padding:7px 10px;border:none;border-radius:8px;background:#e2e8f0;color:#334155;' +
    'font-weight:600;font-size:12.5px;cursor:pointer;font-family:inherit';

  function buildPanel() {
    var wrap = document.createElement('div');
    wrap.id = PANEL_ID;
    wrap.style.cssText = 'position:fixed;top:14px;right:14px;z-index:2147483647;width:320px;' +
      'background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 12px 32px rgba(15,23,42,.18);' +
      'padding:14px;color:#0f172a;text-align:left;line-height:1.7';
    wrap.innerHTML =
      '<div style="font-weight:700;font-size:14px;margin-bottom:8px;font-family:inherit">📋 自动输入面板</div>' +
      '<style>#__ai_source__:empty::before{content:"第 1 步:粘贴文字或图片到这里(Ctrl+V 永远可用)";color:#94a3b8;pointer-events:none}</style>' +
      '<div id="__ai_source__" contenteditable="true" ' +
      'style="width:100%;box-sizing:border-box;min-height:110px;max-height:260px;overflow:auto;border:1px solid #cbd5e1;border-radius:8px;' +
      'padding:8px;font-size:13px;line-height:1.6;font-family:inherit;color:#0f172a;background:#ffffff"></div>' +
      '<div id="__ai_target__" style="margin:8px 0 2px;color:#92400e;font-weight:600;font-size:12.5px">🎯 目标:还没选 —— 点一下网页里的输入框,或点下面按钮挑</div>' +
      '<div style="margin:6px 0 8px;color:#64748b;font-size:12.5px">选一种输入方式 👇(输入时目标框会高亮给你看)</div>' +
      '<button id="__ai_pick__" style="' + BTN_STYLE_GRAY + '">🎯 选目标</button> ' +
      '<button id="__ai_slow__" style="' + BTN_STYLE + '">🐢 逐字输入</button> ' +
      '<button id="__ai_fast__" style="' + BTN_STYLE + '">⚡ 一次性</button> ' +
      '<button id="__ai_close__" style="' + BTN_STYLE_GRAY + '">✕ 关闭</button>' +
      '<div id="__ai_status__" style="margin-top:8px;color:#15803d;font-weight:600;min-height:1.2em;font-size:12.5px"></div>';
    (document.body || document.documentElement).appendChild(wrap);

    var source = wrap.querySelector('#__ai_source__');
    // 面板里的粘贴不受任何网站限制:事件不让网站看见,浏览器默认粘贴照常
    source.addEventListener('paste', function (e) {
      e.stopPropagation();
      // 图片统一转成 dataURL 再插入(blob: 地址保存作业后会失效)
      try {
        var fl = e.clipboardData && e.clipboardData.files;
        if (fl && fl.length && /^image\//.test(fl[0].type)) {
          e.preventDefault();
          var file = fl[0];
          var reader = new FileReader();
          reader.onload = function () {
            try {
              (source.ownerDocument || document).execCommand('insertHTML', false, '<img src="' + reader.result + '">');
            } catch (err) { /* 忽略 */ }
          };
          reader.readAsDataURL(file);
        }
      } catch (err) { /* 忽略 */ }
    });
    source.addEventListener('keydown', function (e) { e.stopPropagation(); });

    wrap.querySelector('#__ai_pick__').addEventListener('click', startPickMode);
    wrap.querySelector('#__ai_slow__').addEventListener('click', function () { autoInsert('slow'); });
    wrap.querySelector('#__ai_fast__').addEventListener('click', function () { autoInsert('fast'); });
    wrap.querySelector('#__ai_close__').addEventListener('click', function () { wrap.style.display = 'none'; });
    updateTargetLine();
  }

  function openAutoInputPanel() {
    if (!document.body) {          // 页面还没解析完,等一下再开
      document.addEventListener('DOMContentLoaded', openAutoInputPanel);
      return;
    }
    var existing = document.getElementById(PANEL_ID);
    if (existing) { existing.style.display = 'block'; return; }
    buildPanel();
    hookFrameFocus();            // 学习通等页面的编辑器在 iframe 里,提前把焦点监听挂进去
    hookUEPaste();               // 学习通答题框:直接 Ctrl+V 也能自动补救(文字+图片)
    hookFramePaste();
  }
  // 方便在控制台/自动化里调用:window.__openAutoInputPanel()
  // 以及跨 iframe 挑选模式的钩子(顶层会调用 iframe 里的这两个函数)
  try {
    pageWindow.__openAutoInputPanel = openAutoInputPanel;
    pageWindow.__aiStartPick = startPickMode;
    pageWindow.__aiStartPickLocal = startLocalPick;
    pageWindow.__aiStopPickLocal = stopLocalPick;
  } catch (err) { /* 忽略 */ }

  function insertOneChar(el, ch) {
    if (el.isContentEditable) {
      // 注意:编辑器可能在 iframe 里,必须用它自己文档的 execCommand
      var doc = el.ownerDocument || document;
      if (ch === '\n') { doc.execCommand('insertLineBreak'); }
      else { doc.execCommand('insertText', false, ch); }
    } else if (el.selectionStart != null && el.selectionEnd != null) {
      var pos = el.selectionStart;
      el.setRangeText(ch, pos, pos, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function autoInsert(mode) {
    var source = document.getElementById('__ai_source__');
    var status = document.getElementById('__ai_status__');
    if (!source || !status) return;
    var hasImage = !!(source.querySelector && source.querySelector('img'));
    var text = source.innerText || source.textContent || '';
    if (!text.trim() && !hasImage) {
      status.style.color = '#b91c1c';
      status.textContent = '面板里还没有内容,先粘贴文字或图片进来';
      return;
    }
    var el = lastFocusedEditable;
    if (!isEditableElement(el)) {
      status.style.color = '#b91c1c';
      status.textContent = '还没选目标:点一下网页里的输入框,或点 🎯 选目标';
      return;
    }
    if (el.isConnected === false) {
      status.style.color = '#b91c1c';
      status.textContent = '目标输入框被页面刷新掉了,请重新选 🎯';
      return;
    }
    try {
      if (el.closest && el.closest('#' + PANEL_ID)) {
        status.style.color = '#b91c1c';
        status.textContent = '目标变成了面板自己,请用 🎯 重新选网页里的答题框';
        lastFocusedEditable = null;
        return;
      }
    } catch (err) { /* 忽略 */ }
    try { el.focus(); } catch (err) { /* 聚焦失败也继续试 */ }
    revealTarget(el);                     // 滚动到目标框并高亮,让你看见输入到哪了
    status.style.color = '#15803d';
    hookFrameFocus();                     // 页面可能又新建了编辑器,顺手补挂监听
    // —— 图片:整体按 HTML 插入(图片没法一个字一个字打)——
    if (hasImage) {
      var html = source.innerHTML;
      try {
        var ueImg = findUEFor(el);
        if (ueImg) { insertViaUE(ueImg, html, true); }
        else if (el.isContentEditable) { (el.ownerDocument || document).execCommand('insertHTML', false, html); }
        else { throw new Error('这个输入框只支持纯文字,放不了图片'); }
        status.textContent = '✅ 已插入(含图片)';
      } catch (err) {
        status.style.color = '#b91c1c';
        status.textContent = '⚠️ ' + ((err && err.message) || '插入失败');
      }
      return;
    }
    // —— 学习通 / UEditor 编辑器:走编辑器自己的接口,绕开一切粘贴拦截 ——
    var ue = findUEFor(el);
    if (ue) {
      try {
        insertViaUE(ue, text);
        status.textContent = '✅ 已通过编辑器接口写入 ' + text.length + ' 个字符';
      } catch (err) {
        status.style.color = '#b91c1c';
        status.textContent = '⚠️ 编辑器接口失败,请把网址告诉脚本作者';
      }
      return;
    }
    if (mode === 'fast') {                       // ⚡ 一次性
      try {
        if (el.isContentEditable) {
          var doc = el.ownerDocument || document;
          doc.execCommand('insertText', false, text);
        } else if (el.selectionStart != null) {
          el.setRangeText(text, el.selectionStart, el.selectionStart, 'end');
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        status.textContent = '✅ 已输入 ' + text.length + ' 个字符';
      } catch (err) {
        status.style.color = '#b91c1c';
        status.textContent = '⚠️ 输入失败:' + (err && err.message || err);
      }
      return;
    }
    // 🐢 逐字输入:每个字符间隔 30 毫秒,和手动打字几乎一样
    var i = 0;
    status.textContent = '⏳ 正在逐字输入…';
    var timer = setInterval(function () {
      if (!document.getElementById(PANEL_ID)) { clearInterval(timer); return; }
      if (i >= text.length) {
        clearInterval(timer);
        status.textContent = '✅ 已输入 ' + text.length + ' 个字符';
        return;
      }
      var ch = text[i++];
      if (ch === '\n' && !el.isContentEditable && el.tagName && el.tagName.toLowerCase() === 'input') ch = ' ';
      try { insertOneChar(el, ch); } catch (err) {
        clearInterval(timer);
        status.style.color = '#b91c1c';
        status.textContent = '⚠️ 输入中断:' + (err && err.message || err);
      }
    }, 30);
  }

  /* ===================== 第 4 层对抗:选区「找回」 =====================
   * 更狠的网站会在你松开鼠标的一瞬间把选区偷偷清空(removeAllRanges)。
   * 我们记下你最后选中的内容,松开鼠标后如果发现选区凭空消失,就还给你。
   * 快照有两个来源:拖选过程中的 selectionchange 事件 + 松手瞬间的现场快照,
   * 双保险,谁先出现都算数。
   */
  var savedRange = null;                // 最近一次非空选区
  var hadSelectionThisGesture = false;  // 这次按下鼠标期间是否真的选中过东西

  function saveSelectionIfAny() {
    var sel = window.getSelection();
    if (sel.rangeCount > 0 && !sel.isCollapsed) {
      savedRange = sel.getRangeAt(0).cloneRange();
      hadSelectionThisGesture = true;
    }
  }

  document.addEventListener('mousedown', function () {
    hadSelectionThisGesture = false;      // 新的一次拖选开始
  }, true);

  document.addEventListener('selectionchange', saveSelectionIfAny, true);

  window.addEventListener('mouseup', function () {
    if (!enabled) return;
    saveSelectionIfAny();                 // 松手瞬间现场快照(必须在网站动手之前)
    var snapshot = savedRange;
    setTimeout(function () {
      var sel = window.getSelection();
      // 松手时明明选中过、一眨眼却变成空的 → 被网站偷了,拿回来
      if (hadSelectionThisGesture && snapshot && (sel.rangeCount === 0 || sel.isCollapsed)) {
        try {
          sel.removeAllRanges();
          sel.addRange(snapshot);
        } catch (err) { /* 恢复失败就算了 */ }
      }
    }, 0);
  }, true);

  /* ===================== 第 5 层对抗:样式被删就补回 =====================
   * 有的网站会清掉外来 <style>,用 MutationObserver 只盯着 head,
   * 一旦被删立刻加回来。
   */
  function startStyleWatcher() {
    var observer = new MutationObserver(function () {
      if (enabled && !document.getElementById(STYLE_ID)) addStyle();
    });
    if (document.head) observer.observe(document.head, { childList: true });
    if (document.documentElement) observer.observe(document.documentElement, { childList: true });
  }

  /* ===================== 站点适配:超星学习通等 UEditor 编辑器 =====================
   * 学习通答题框是 UEditor:可编辑区在 iframe 里(常常还是 about:blank,
   * 油猴不会往这种 iframe 注入脚本,所以光靠监听焦点发现不了它)。
   * 好在主页面里有 UEditor 的全局对象 UE,我们可以从主页面直接:
   *   1) 递归摸进所有同源 iframe,给里面的文档挂焦点监听(目标上报照常);
   *   2) 挑选目标时,iframe 里的编辑框照样悬停高亮、点击选定;
   *   3) 输入时用编辑器自己的接口 execCommand('inserthtml') 写入,
   *      完全不经过"粘贴"这条路的拦截。
   */
  function reachableDocs() {
    var docs = [];
    function walk(doc, depth) {
      if (!doc || depth > 5) return;
      docs.push(doc);
      var list = doc.querySelectorAll('iframe');
      for (var i = 0; i < list.length; i++) {
        try {
          var d = list[i].contentDocument;
          if (d) walk(d, depth + 1);
        } catch (err) { /* 跨域 iframe,放弃 */ }
      }
    }
    try { walk(document, 0); } catch (err) { /* 忽略 */ }
    return docs;
  }

  var FOCUS_HOOK = '__aiFocusHooked__';
  function hookFrameFocus() {
    var docs = reachableDocs();
    for (var i = 0; i < docs.length; i++) {
      var doc = docs[i];
      if (doc[FOCUS_HOOK]) continue;
      try {
        doc.addEventListener('focusin', function (e) {
          if (isEditableElement(e.target)) reportTarget(e.target);
        }, true);
        doc[FOCUS_HOOK] = true;
      } catch (err) { /* 忽略 */ }
    }
  }

  var PICK_HOOK = '__aiPickHooked__';
  function hookFramePick(on) {
    var docs = reachableDocs();
    for (var i = 0; i < docs.length; i++) {
      var doc = docs[i];
      if (doc === document) continue;
      try {
        if (on && !doc[PICK_HOOK]) {
          doc.addEventListener('mouseover', pickHover, true);
          doc.addEventListener('mouseout', pickOut, true);
          doc.addEventListener('click', pickClick, true);
          doc.addEventListener('keydown', pickKeydown, true);
          doc[PICK_HOOK] = true;
        } else if (!on && doc[PICK_HOOK]) {
          doc.removeEventListener('mouseover', pickHover, true);
          doc.removeEventListener('mouseout', pickOut, true);
          doc.removeEventListener('click', pickClick, true);
          doc.removeEventListener('keydown', pickKeydown, true);
          doc[PICK_HOOK] = false;
        }
      } catch (err) { /* 忽略 */ }
    }
  }

  function getUE() {
    try {
      var top = window.top;
      return (top && top.UE) || window.UE || null;
    } catch (err) { return window.UE || null; }
  }

  function findUEFor(el) {
    var UE = getUE();
    if (!UE || !UE.instances) return null;
    for (var i = 0; i < UE.instances.length; i++) {
      var ed = UE.instances[i];
      try {
        if (!ed) continue;
        if (ed.document && ed.document === el.ownerDocument) return ed;
        if (ed.body && (ed.body === el || (ed.body.contains && ed.body.contains(el)))) return ed;
      } catch (err) { /* 忽略 */ }
    }
    return null;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function insertViaUE(ed, content, isHtml) {
    ed.focus();
    var html = isHtml ? content : escapeHtml(content).replace(/\n/g, '<br/>');
    ed.execCommand('inserthtml', html);
  }

  /* —— 直接在 UEditor 的 iframe 文档里挂"粘贴补救":
   * 学习通拦截粘贴的代码就在这个文档里,它 preventDefault 之后,
   * 我们(后注册的捕获监听)还能读到剪贴板,再用编辑器接口把内容写回去。
   * 文字、截图/图片都能救。
   */
  function hookUEPaste() {
    var UE = getUE();
    if (!UE || !UE.instances) return;
    for (var i = 0; i < UE.instances.length; i++) {
      try {
        var ed = UE.instances[i];
        var doc = ed && ed.document;
        if (!doc || doc['__aiPasteHooked__']) continue;
        doc.addEventListener('paste', function (e) {
          if (!enabled) return;
          var text = '';
          var imgFile = null;
          try { text = e.clipboardData ? (e.clipboardData.getData('text/plain') || '') : ''; } catch (err) {}
          try {
            var fl = e.clipboardData && e.clipboardData.files;
            if (fl && fl.length && /^image\//.test(fl[0].type)) imgFile = fl[0];
          } catch (err) { /* 忽略 */ }
          if (!text && !imgFile) return;
          if (imgFile) {
            var reader = new FileReader();
            reader.onload = function () {
              try { insertViaUE(ed, '<img src="' + reader.result + '">', true); } catch (err) { /* 忽略 */ }
            };
            reader.readAsDataURL(imgFile);
          } else {
            try { insertViaUE(ed, text); } catch (err) { /* 忽略 */ }
          }
        }, true);
        doc['__aiPasteHooked__'] = true;
      } catch (err) { /* 忽略 */ }
    }
  }

  /* —— 普通 iframe 编辑器的"粘贴补救"(不依赖 UEditor,用 execCommand)—— */
  function framePasteHandler(e) {
    if (!enabled || !e.defaultPrevented) return;   // 网站没拦就不管
    var text = '';
    var imgFile = null;
    try { text = e.clipboardData ? (e.clipboardData.getData('text/plain') || '') : ''; } catch (err) {}
    try {
      var fl = e.clipboardData && e.clipboardData.files;
      if (fl && fl.length && /^image\//.test(fl[0].type)) imgFile = fl[0];
    } catch (err) { /* 忽略 */ }
    if (!text && !imgFile) return;
    var doc = (e.target && e.target.ownerDocument) || document;
    if (imgFile) {
      var reader = new FileReader();
      reader.onload = function () {
        try { doc.execCommand('insertHTML', false, '<img src="' + reader.result + '">'); } catch (err) { /* 忽略 */ }
      };
      reader.readAsDataURL(imgFile);
    } else {
      try { doc.execCommand('insertText', false, text); } catch (err) { /* 忽略 */ }
    }
  }

  function hookFramePaste() {
    var docs = reachableDocs();
    for (var i = 0; i < docs.length; i++) {
      var doc = docs[i];
      if (doc === document || doc['__aiPasteHooked__']) continue;
      try {
        doc.addEventListener('paste', framePasteHandler, true);
        doc['__aiPasteHooked__'] = true;
      } catch (err) { /* 忽略 */ }
    }
  }

  /* ===================== 向演示页面「报到」 =====================
   * 设置 window.__copyUnlockActive,演示页面据此把顶部横幅变绿。
   */
  function announce() {
    try {
      pageWindow.__copyUnlockActive = enabled;
      pageWindow.dispatchEvent(new CustomEvent('copy-unlock-change'));
    } catch (err) { /* 与页面互通失败不影响功能 */ }
  }

  /* ===================== 油猴菜单开关(按网站记忆) ===================== */
  var menuId = null;
  function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    if (menuId !== null) {
      try { GM_unregisterMenuCommand(menuId); } catch (err) {}
    }
    menuId = GM_registerMenuCommand(
      enabled ? '🔓 解锁复制:本站已开启(点击关闭)' : '🔒 解锁复制:本站已关闭(点击开启)',
      function () {
        enabled = !enabled;
        if (enabled) { addStyle(); } else { removeStyle(); }
        try { if (typeof GM_setValue === 'function') GM_setValue(SITE_KEY, enabled); } catch (err) {}
        announce();
        registerMenu();
      }
    );
  }

  /* ===================== 启动 ===================== */
  addStyle();
  document.addEventListener('DOMContentLoaded', function () {
    addStyle();
    startStyleWatcher();
    announce();
    hookFrameFocus();            // 把 iframe(含 about:blank 编辑器)的焦点监听也挂上
    hookUEPaste();               // 学习通答题框:直接 Ctrl+V 自动补救
    hookFramePaste();
  });
  registerMenu();
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('📋 自动输入面板(粘贴被拦时用这个)', openAutoInputPanel);
  }
})();
