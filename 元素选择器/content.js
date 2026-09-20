// ============================================ //
// 元素选择器 v9.6.5
//
// 状态机: 'a' 普通 → 'b' 选择模式 → 'd' 锁定模式 → 'e' 媒体全屏播放 → (退出全屏) → 'd'
//
// v9.6.5 改动:
// - 第一个信息栏（标签/ID/类名数量/子元素数）右侧空白处新增 ▲◀▶▼ 四向导航按钮
//   上下 = 父/子元素，左右 = 上/下一个同级元素，点击等效快捷键 + - / *
//   锁定态与预览态均可用（预览态按钮单独 pointer-events:auto 放行点击）
// - 信息栏改为左右双列 flex 布局：左列信息行，右列方向键十字排列；网址行照常独占一行
//
// v9.6.4 改动:
// - 过渡色点改为"卡片式两行布局"：每个色点一张小卡片
//   第一行 = 编号 + 取色块 + 颜色代码框；第二行 = 位置框 + ➖删除
//   "过渡色点"标签移出左侧对齐列、改为小标题，编辑区占满面板宽度，不再出界
//
// v9.6.3 改动:
// - 过渡色点行改为与 color 行同款设计：取色块 + 可编辑颜色代码框（双向同步）+ 位置框 + ➖
// - 修复: 🎨颜色组四行（color/background-color/border-color/opacity）丢失问题
//
// v9.6.2 改动:
// - 修复: 切换渐变预设不立即生效（事件委托漏放行 .grad-preset）；预设库扩充至 24 个
//
// v9.6.1 改动:
// - 修复: 渐变 ➕/➖ 按钮事件改为 .grad-editor 事件委托，动态行全部生效
//
// v9.6 改动:
// - 热编辑改为"会话级保留"：退出锁定/选择模式后样式保留到刷新页面（AUTO_RESTORE=false）
// - 新增「渐变背景编辑器」：方向14种、预设24个、色点2~N增减、已有渐变正确回显、📋一键复制
// ============================================

window.__PICKER_RUNNING = true;

// 状态管理
let currentState = 'a';
window.__ELEMENT_PICKER_STATE = currentState;
window.__ELEMENT_PICKER_ACTIVE = false;

(function () {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  const root = document.body || document.documentElement;
  root.appendChild(iframe);
  const rawAdd = iframe.contentWindow.EventTarget.prototype.addEventListener;
  const rawRemove = iframe.contentWindow.EventTarget.prototype.removeEventListener;
  iframe.remove();
  window.rawAdd = rawAdd;
  window.rawRemove = rawRemove;
})();

// UI元素
let overlay = null;
let tooltip = null;
let exitButton = null;
let shadowHost = null;

// 当前预览的元素
let previewElement = null;
let previewPath = [];
let previewIndex = 0;
let lastMouseX = 0, lastMouseY = 0;

// 锁定的元素
let lockedElement = null;
let lockedInfo = null;
let lockedPath = [];
let lockedIndex = 0;

// 拖动相关
let isDragging = false;
let isResizing = false;
let dragOffsetX = 0, dragOffsetY = 0;
let resizeStartX = 0, resizeStartY = 0;
let resizeStartWidth = 0;
let resizeStartHeight = 0;
let dragPointerId = null;
let resizePointerId = null;

// 动画帧ID
let updateOverlayRaf = null;

// 视口尺寸
let lastViewportWidth = window.innerWidth;
let lastViewportHeight = window.innerHeight;

// 视频面板清理
let videoPanelCleanup = null;
function cleanupVideoPanel() {
  if (videoPanelCleanup) {
    try { videoPanelCleanup(); } catch (e) {}
    videoPanelCleanup = null;
  }
}

// 全屏期间补挂的 controls 记录
const controlsAddedSet = new WeakSet();

// 悬浮窗尺寸限制
const MIN_WIDTH = 320;
const MIN_HEIGHT = 450;
const MAX_WIDTH = 960;
const MAX_HEIGHT = 900;

// ==================== 剪贴板 ====================
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showNotification('复制成功', 'success');
  } catch (e) {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none;';
  document.body.appendChild(ta);
  ta.select();
  try { ta.setSelectionRange(0, text.length); } catch (e) {}
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) {}
  ta.remove();
  showNotification(ok ? '复制成功' : '复制失败', ok ? 'success' : 'info');
}

// ==================== 跨 frame 坐标换算 ====================
const FRAME_MARK = '🧿';
const FRAME_MARK_HTML = `<span style="color:#5eead4;font-size:9px;font-weight:bold;">🧿</span>`;

function isElementNode(n) { return !!n && n.nodeType === 1; }

function isShadowRoot(node) {
  try {
    return !!node && node.nodeType === 11 && node.host !== undefined && node.mode !== undefined;
  } catch (e) { return false; }
}

function getFrameChain(el) {
  const chain = [];
  try {
    let win = el && el.ownerDocument && el.ownerDocument.defaultView;
    while (win && win !== window) {
      const fe = win.frameElement;
      if (!fe) break;
      chain.push(fe);
      win = fe.ownerDocument && fe.ownerDocument.defaultView;
    }
  } catch (e) {}
  return chain;
}

function isInChildFrame(el) { return getFrameChain(el).length > 0; }

function toTopPoint(el, x, y) {
  let px = x, py = y;
  for (const fe of getFrameChain(el)) {
    const r = fe.getBoundingClientRect();
    const cs = getComputedStyle(fe);
    px += r.left + (parseFloat(cs.borderLeftWidth) || 0);
    py += r.top + (parseFloat(cs.borderTopWidth) || 0);
  }
  return { x: px, y: py };
}

function rectInTop(el) {
  const r = el.getBoundingClientRect();
  const p = toTopPoint(el, r.left, r.top);
  return { left: p.x, top: p.y, width: r.width, height: r.height, right: p.x + r.width, bottom: p.y + r.height };
}

function ownerDocOf(el) { return (el && el.ownerDocument) || document; }

function exitAnyFullscreen() {
  try {
    const d = ownerDocOf(lockedElement);
    if (d.fullscreenElement) d.exitFullscreen();
  } catch (e) {}
}

// ==================== 导航记忆 ====================
let navMemory = new WeakMap();
function resetNavMemory() { navMemory = new WeakMap(); }

function getNavParent(element) {
  if (!isElementNode(element)) return null;
  try {
    const root = element.getRootNode();
    if (isShadowRoot(root)) return root.host;
  } catch (e) {}
  if (element.parentElement && element.parentElement.nodeType === 1) {
    return element.parentElement;
  }
  try {
    const win = element.ownerDocument && element.ownerDocument.defaultView;
    if (win && win !== window && isElementNode(win.frameElement)) return win.frameElement;
  } catch (e) {}
  return null;
}

function getFirstNavChild(element) {
  if (!element || !element.children || element.children.length === 0) return null;
  return element.children[0];
}

function switchToLockedElement(newEl) {
  lockedElement = newEl;
  lockedInfo = getElementInfo(newEl);
  lockedPath = getFullPath(newEl);
  lockedIndex = Math.max(0, lockedPath.indexOf(newEl));
  updateOverlay(lockedElement);
  const rect = lockedElement.getBoundingClientRect();
  updateTooltip(lockedElement, lockedIndex, lockedPath.length, rect.right, rect.top, true);
}

function switchToPreviewElement(newEl) {
  previewElement = newEl;
  previewPath = getFullPath(newEl);
  previewIndex = Math.max(0, previewPath.indexOf(newEl));
  updateOverlay(previewElement);
  updateTooltip(previewElement, previewIndex, previewPath.length, lastMouseX, lastMouseY, false);
}

// 🔑 [v9.6.5] 四向导航：点击等效快捷键 + - / *
function navigateRelative(dir) {
  let el = null, switchFn = null;
  if (currentState === 'd' && lockedElement) {
    el = lockedElement;
    switchFn = switchToLockedElement;
  } else if (currentState === 'b' && previewElement) {
    el = previewElement;
    switchFn = switchToPreviewElement;
  } else {
    return;
  }
  switch (dir) {
    case 'parent': {
      const parent = getNavParent(el);
      if (parent) { navMemory.set(parent, el); switchFn(parent); }
      else showNotification('已在最顶层', 'info');
      break;
    }
    case 'child': {
      let target = navMemory.get(el);
      if (!(target && target.isConnected)) target = getFirstNavChild(el);
      if (target) switchFn(target);
      else showNotification('当前元素没有子元素', 'info');
      break;
    }
    case 'prev': {
      const prev = getPreviousSibling(el);
      if (prev) switchFn(prev);
      else showNotification('没有上一个同级元素', 'info');
      break;
    }
    case 'next': {
      const next = getNextSibling(el);
      if (next) switchFn(next);
      else showNotification('没有下一个同级元素', 'info');
      break;
    }
  }
}

// ==================== Shadow DOM + 同源 iframe 深度查找 ====================
function findDeepestElementAtPoint(x, y, root = document, depth = 0) {
  try {
    let element = root.elementFromPoint(x, y);
    if (!element) return { element: null, depth: -1 };
    if (element.shadowRoot) {
      const deeper = findDeepestElementAtPoint(x, y, element.shadowRoot, depth + 1);
      if (deeper.element) return deeper;
    }
    if (element.tagName === 'IFRAME') {
      let doc = null;
      try { doc = element.contentDocument; } catch (e) {}
      if (doc) {
        const r = element.getBoundingClientRect();
        const cs = getComputedStyle(element);
        const ix = x - r.left - (parseFloat(cs.borderLeftWidth) || 0);
        const iy = y - r.top - (parseFloat(cs.borderTopWidth) || 0);
        const deeper = findDeepestElementAtPoint(ix, iy, doc, depth + 1);
        if (deeper.element) return deeper;
      }
    }
    return { element, depth };
  } catch (e) {
    return { element: null, depth: -1 };
  }
}

function deepElementFromPoint(x, y) {
  if (window.event && window.event.isTrusted === false) return null;
  try {
    const result = findDeepestElementAtPoint(x, y);
    return result.element;
  } catch (e) {
    return document.elementFromPoint(x, y);
  }
}

function getShadowDepth(element) {
  let depth = 0;
  let current = element;
  while (current) {
    try {
      const root = current.getRootNode();
      if (isShadowRoot(root)) {
        depth++;
        current = root.host;
      } else break;
    } catch (e) { break; }
  }
  return depth;
}

function getFullPath(element) {
  const path = [];
  let current = element;
  let visited = new Set();
  while (current && current.nodeType === 1 && !visited.has(current)) {
    visited.add(current);
    path.push(current);
    try {
      const root = current.getRootNode();
      if (isShadowRoot(root)) { current = root.host; continue; }
    } catch (e) {}
    if (current.parentElement && current.parentElement.nodeType === 1) {
      current = current.parentElement;
      continue;
    }
    try {
      const win = current.ownerDocument && current.ownerDocument.defaultView;
      current = (win && win !== window && isElementNode(win.frameElement)) ? win.frameElement : null;
    } catch (e) { current = null; }
  }
  return path;
}

function getSiblings(element) {
  if (!element || !element.parentElement) return [];
  return Array.from(element.parentElement.children);
}

function getPreviousSibling(element) {
  if (!element || !element.parentElement) return null;
  const siblings = getSiblings(element);
  const index = siblings.indexOf(element);
  return index > 0 ? siblings[index - 1] : null;
}

function getNextSibling(element) {
  if (!element || !element.parentElement) return null;
  const siblings = getSiblings(element);
  const index = siblings.indexOf(element);
  return index < siblings.length - 1 ? siblings[index + 1] : null;
}

function getSiblingPosition(element) {
  if (!element || !element.parentElement) return { index: 1, total: 1 };
  const siblings = getSiblings(element);
  return { index: siblings.indexOf(element) + 1, total: siblings.length };
}

// ==================== UI 创建 ====================
function createUI() {
  overlay = document.createElement('div');
  overlay.id = 'element-picker-overlay';
  overlay.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 2147483646;
    border: 2px solid #3b82f6;
    background: rgba(59, 130, 246, 0.1);
    transition: all 0.1s ease;
    display: none;
  `;
  document.documentElement.appendChild(overlay);

  shadowHost = document.createElement('div');
  shadowHost.id = 'element-picker-shadow-host';
  shadowHost.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    z-index: 2147483647;
    pointer-events: none;
  `;
  document.documentElement.appendChild(shadowHost);

  const shadowRoot = shadowHost.attachShadow({ mode: 'open' });

  const styleSheet = document.createElement('style');
  styleSheet.textContent = `
    :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace; }
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    kbd { font-size: 13px; color: #62b5ff; background: #1e293b; padding: 2px 4px; border-radius: 3px; border: 1px solid #4b5563; }
    #tooltip { position: fixed; z-index: 2147483647; user-select: text; -webkit-user-select: text; background: #1e293b; color: white; border-radius: 8px; font-size: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); border: 1px solid #4b5563; min-width: ${MIN_WIDTH}px; min-height: ${MIN_HEIGHT}px; max-width: ${MAX_WIDTH}px; max-height: ${MAX_HEIGHT}px; width: ${MIN_WIDTH}px; height: ${MIN_HEIGHT}px; display: none; overflow: hidden; box-sizing: border-box; pointer-events: auto; }
    #tooltip.mode-preview { pointer-events: none; }
    #tooltip button { background: #4f46e5; color: white; border: none; border-radius: 3px; padding: 2px 6px; font-size: 9px; cursor: pointer; margin-left: 4px; transition: opacity 0.2s; }
    #tooltip button:hover { opacity: 0.9; }
    #tooltip::-webkit-scrollbar { width: 6px; background: #2d3748; }
    #tooltip::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 3px; }
    #exit-btn { position: fixed; top: 20px; left: 20px; z-index: 2147483648; background: #ef4444; color: white; width: 36px; height: 36px; border-radius: 50%; display: none; align-items: center; justify-content: center; font-size: 20px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: 2px solid white; transition: all 0.2s; pointer-events: auto; }
    #style-panel input[type="text"] { outline: none; }
    #style-panel input[type="text"]:focus { border-color: #62b5ff !important; }
    #style-panel input[type="color"] { padding: 0; }
    #style-panel select { outline: none; }
    #style-panel select:focus { border-color: #62b5ff !important; }
    #style-panel details summary::-webkit-details-marker { color: #6b7280; }
    #style-panel details[open] summary { margin-bottom: 4px; }
    #style-panel .style-cond-hint { color: #f59e0b; font-size: 9px; flex-basis: 100%; margin-top: 1px; word-break: break-all; }
    #video-panel button:disabled, #video-panel input:disabled, #video-panel select:disabled { opacity: 0.45; cursor: not-allowed; }
    #video-panel input[type="range"] { accent-color: #3b82f6; }
    .grad-editor input:disabled, .grad-editor select:disabled, .grad-editor button:disabled { opacity: 0.45; cursor: not-allowed; }
    .nav-arrow { pointer-events: auto; }
    .nav-arrow:hover { background: #6b7280 !important; }
    .nav-arrow:active { background: #3b82f6 !important; }
  `;
  shadowRoot.appendChild(styleSheet);

  tooltip = document.createElement('div');
  tooltip.id = 'tooltip';
  shadowRoot.appendChild(tooltip);

  // 复制按钮统一事件委托（渐变的 📋 background-image 标签也走这里）
  tooltip.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('.copy-btn') : null;
    if (!btn) return;
    e.stopPropagation();
    copyToClipboard(btn.dataset.copy || '');
  });

  exitButton = document.createElement('div');
  exitButton.id = 'exit-btn';
  exitButton.innerHTML = '×';
  exitButton.title = '退出选择模式 (ESC 或 `)';
  shadowRoot.appendChild(exitButton);
  exitButton.addEventListener('click', (e) => { e.stopPropagation(); handleExit(); });

  document.addEventListener('scroll', handleScrollResize, { capture: true, passive: true });
  window.addEventListener('resize', handleResize, { passive: true });

  attachFullscreenHooks(document);
  initFrameBridge();
}

// ==================== 自定义调整大小 ====================
function initResizeHandles() {
  const oldHandles = tooltip.querySelectorAll('.resize-handle');
  oldHandles.forEach(h => h.remove());
  const handles = ['nw', 'ne', 'sw', 'se'];
  handles.forEach(pos => {
    const handle = document.createElement('div');
    handle.className = `resize-handle resize-${pos}`;
    handle.style.cssText = `
      position: absolute;
      width: 16px;
      height: 16px;
      background: #4b5563;
      border: 2px solid #94a3b8;
      border-radius: 4px;
      z-index: 10;
      cursor: ${pos}-resize;
      touch-action: none;
    `;
    if (pos.includes('n')) handle.style.top = '-2px';
    else handle.style.bottom = '-2px';
    if (pos.includes('w')) handle.style.left = '-2px';
    else handle.style.right = '-2px';
    window.rawAdd.call(handle, 'pointerdown', (e) => startResize(e, pos), true);
    tooltip.appendChild(handle);
  });
}

function startResize(e, position) {
  e.stopPropagation();
  e.preventDefault();
  isResizing = true;
  resizePointerId = e.pointerId;
  resizeStartX = e.clientX;
  resizeStartY = e.clientY;
  resizeStartWidth = tooltip.offsetWidth;
  resizeStartHeight = tooltip.offsetHeight;
  try { e.target.setPointerCapture(resizePointerId); } catch (err) {}
  window.rawAdd.call(document, 'pointermove', onResize, true);
  window.rawAdd.call(document, 'pointerup', stopResize, true);
  window.rawAdd.call(document, 'pointercancel', stopResize, true);
}

function onResize(e) {
  if (!isResizing || e.pointerId !== resizePointerId) return;
  let newWidth = resizeStartWidth + (e.clientX - resizeStartX);
  let newHeight = resizeStartHeight + (e.clientY - resizeStartY);
  newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth));
  newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, newHeight));
  tooltip.style.width = newWidth + 'px';
  tooltip.style.height = newHeight + 'px';
  ensureTooltipInViewport();
}

function stopResize(e) {
  if (isResizing && e && e.pointerId === resizePointerId) {
    try { e.target.releasePointerCapture?.(resizePointerId); } catch (err) {}
  }
  isResizing = false;
  resizePointerId = null;
  window.rawRemove.call(document, 'pointermove', onResize, true);
  window.rawRemove.call(document, 'pointerup', stopResize, true);
  window.rawRemove.call(document, 'pointercancel', stopResize, true);
}

// ==================== 样式热编辑 ====================
const styleBackupMap = new WeakMap();
const styleBackupOrder = [];
// 🔑 热编辑为"会话级保留"：退出后样式留在元素上，直到刷新页面；改回 true 可恢复旧"退出即还原"
const AUTO_RESTORE = false;

const COLOR_PROPS = ['color', 'background-color', 'border-color'];
const NEED_UNIT_PROPS = ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'font-size', 'line-height', 'letter-spacing', 'gap', 'margin', 'padding', 'top', 'right', 'bottom', 'left'];

const STYLE_ENUMS = {
  'display': {
    'block': '块级·独占一行', 'inline': '行内·不换行不可设宽高', 'inline-block': '行内块·同行且可设宽高',
    'flex': '弹性布局·子元素横排', 'inline-flex': '行内弹性布局', 'grid': '网格布局·二维排列', 'inline-grid': '行内网格布局',
    'flow-root': '块级·自带BFC·清浮动', 'table': '表格·行为像<table>', 'table-row': '表格行·行为像<tr>', 'table-cell': '表格单元格·可垂直居中',
    'list-item': '列表项·带圆点编号', 'contents': '自身消失·子元素顶替位置', 'none': '隐藏·不占空间',
  },
  'text-align': { 'left': '文字左对齐', 'center': '文字居中', 'right': '文字右对齐', 'justify': '文字两端对齐' },
  'justify-content': {
    'flex-start': '子元素靠左/起点', 'center': '子元素居中', 'flex-end': '子元素靠右/终点',
    'space-between': '均匀分布·两端贴边', 'space-around': '均匀分布·两侧半空隙', 'space-evenly': '完全均匀·空隙全相等',
  },
  'align-items': {
    'stretch': '子元素拉伸填满(默认)', 'flex-start': '子元素顶对齐', 'center': '子元素垂直居中',
    'flex-end': '子元素底对齐', 'baseline': '子元素按文字基线对齐',
  },
  'align-self': {
    'auto': '继承父容器设置', 'flex-start': '自己在父容器中顶对齐', 'center': '自己在父容器中垂直居中',
    'flex-end': '自己在父容器中底对齐', 'stretch': '自己拉伸填满',
  },
  'justify-self': {
    'auto': '继承父容器 justify-items', 'start': '自身靠起点·LTR布局=靠左', 'end': '自身靠终点·LTR布局=靠右',
    'left': '自身靠左边缘', 'right': '自身靠右边缘', 'center': '自身水平居中', 'stretch': '自身水平拉伸填满',
  },
  'margin': {
    'auto': '自动·块级元素水平居中', '0': '清零外边距', '0 auto': '上下0·左右auto·水平居中',
    '4px': '四周 4px·极小', '8px': '四周 8px·小', '12px': '四周 12px·较小', '16px': '四周 16px·中档(常用)',
    '24px': '四周 24px·中偏大', '32px': '四周 32px·大', '48px': '四周 48px·超大',
  },
  'flex-direction': {
    'row': '横向·从左到右(默认)', 'row-reverse': '横向·从右到左', 'column': '纵向·从上到下', 'column-reverse': '纵向·从下到上',
  },
  'gap': {
    '0px': '无间距', '2px': '超小间距', '4px': '小间距', '8px': '较小间距', '12px': '中偏小',
    '16px': '中档间距(常用)', '24px': '中偏大', '32px': '大间距', '48px': '超大间距',
  },
  'position': {
    'static': '静态·默认·随文档流', 'relative': '相对·占原位·可微调top等', 'absolute': '绝对·脱离文档流·相对最近定位祖先',
    'fixed': '固定·钉死在屏幕上·不随滚动', 'sticky': '粘性·滚动到阈值时钉住',
  },
  'top': {
    '0px': '贴顶·贴上边缘', '8px': '上偏移8px·小间距', '16px': '上偏移16px·常用于固定顶栏',
    '50%': '垂直中点·常配合transform微调', '100%': '下边界·完全移出上方', '-20px': '向上越界20px·角标外挂常用',
  },
  'right': {
    '0px': '贴右·贴右边缘', '8px': '右偏移8px·小间距', '16px': '右偏移16px·常用于关闭按钮',
    '50%': '水平中点', '100%': '左边界·完全移出右侧', '-20px': '向右越界20px·角标外挂常用',
  },
  'bottom': {
    '0px': '贴底·贴下边缘', '8px': '下偏移8px·小间距', '16px': '下偏移16px·常用于吸底按钮',
    '50%': '垂直中点', '100%': '上边界·完全移出下方', '-20px': '向下越界20px',
  },
  'left': {
    '0px': '贴左·贴左边缘', '8px': '左偏移8px·小间距', '16px': '左偏移16px·常用于侧边面板',
    '50%': '水平中点·居中常用', '100%': '右边界·完全移出左侧', '-20px': '向左越界20px',
  },
  'z-index': {
    'auto': '默认层级·跟DOM顺序', '0': '普通层', '1': '略高一层', '10': '中高', '100': '很高', '9999': '顶级·压住普通弹层', '-1': '沉底·垫在内容后面',
  },
  'overflow': { 'visible': '溢出直接显示(默认)', 'hidden': '溢出裁剪隐藏', 'scroll': '始终显示滚动条', 'auto': '溢出时才出滚动条' },
  'overflow-x': { 'visible': '横向溢出显示', 'hidden': '横向裁剪', 'scroll': '横向滚动条', 'auto': '需要时横向滚动' },
  'overflow-y': { 'visible': '纵向溢出显示', 'hidden': '纵向裁剪', 'scroll': '纵向滚动条', 'auto': '需要时纵向滚动' },
  'font-weight': {
    '300': '细体', '400': '常规(默认)', '500': '中等', '600': '半粗', '700': '粗体', '900': '极粗',
    'normal': '常规(=400)', 'bold': '粗体(=700)',
  },
  'min-width': { 'none': '不限制宽度', '0px': '允许收缩到0·修复flex子项撑破父容器' },
  'min-height': { 'none': '不限制高度', '0px': '允许收缩到0·修复flex子项撑破父容器' },
  'max-width': {
    'none': '不限制宽度', '100%': '父容器宽度', '80%': '父容器80%·超出自动横向滚动', '50%': '父容器一半',
    '50vw': '视口50%宽', '80vw': '视口80%宽', '85vw': '视口85%宽', '90vw': '视口90%宽', '100vw': '视口100%宽',
    '320px': '手机宽度', '640px': '平板宽度', '960px': '桌面内容宽',
  },
  'max-height': {
    'none': '不限制高度', '100%': '父容器高度', '80%': '父容器80%·超出自动纵向滚动',
    '50vh': '视口一半高', '70vh': '视口70%高', '80vh': '视口80%高', '85vh': '视口85%高', '90vh': '视口90%高', '100vh': '视口100%高',
  },
  'zoom': { 'normal': '不缩放(默认)', '0.5': '缩小一半', '0.75': '缩小到75%', '0.8': '缩小到80%', '1.25': '放大到125%', '1.5': '放大一半', '2': '放大一倍' },
  'transform': {
    'none': '无变换(默认)', 'scale(0.5)': '缩小一半', 'scale(0.75)': '缩小到75%', 'scale(0.8)': '缩小到80%',
    'scale(1.25)': '放大到125%', 'scale(1.5)': '放大一半', 'scale(2)': '放大一倍',
    'scale(0.5, 0.5)': 'XY各缩一半', 'scaleX(0.5)': '仅横向缩一半', 'scaleY(0.5)': '仅纵向缩一半',
  },
  'transform-origin': {
    'center center': '中心(默认)', 'center top': '顶部中心', 'center bottom': '底部中心',
    'left top': '左上角', 'right top': '右上角', 'left bottom': '左下角', 'right bottom': '右下角', '0 0': '原点(=左上角)',
  },
};

function checkStyleCondition(el, prop) {
  if (!el) return null;
  let cs;
  try { cs = getComputedStyle(el); } catch (e) { return null; }
  const flexGridDisplays = ['flex', 'inline-flex', 'grid', 'inline-grid'];
  const isFlexOrGridSelf = flexGridDisplays.includes(cs.display);
  let parentCs = null, parent = null;
  try {
    const root = el.getRootNode();
    parent = el.parentElement || (isShadowRoot(root) ? root.host : null);
  } catch (e) {}
  if (parent) {
    try { parentCs = getComputedStyle(parent); } catch (e) {}
  }
  const parentIsFlexGrid = parentCs && flexGridDisplays.includes(parentCs.display);
  const isFlexChild = parentCs && (parentCs.display === 'flex' || parentCs.display === 'inline-flex');
  switch (prop) {
    case 'top': case 'right': case 'bottom': case 'left':
      if (cs.position === 'static') {
        return { ok: false, hint: '⚠ 当前 position:static，此偏移不生效。需先在「📌 定位」中把 position 设为 relative/absolute/fixed/sticky' };
      }
      return { ok: true };
    case 'z-index':
      if (cs.position === 'static' && !parentIsFlexGrid) {
        return { ok: false, hint: '⚠ 当前 position:static 且非 flex/grid 子元素，z-index 不生效' };
      }
      return { ok: true };
    case 'justify-content': case 'align-items':
      if (!isFlexOrGridSelf) {
        return { ok: false, hint: '⚠ 当前元素 display 非弹性/网格布局，此属性不生效。需先设 display 为 flex/grid' };
      }
      return { ok: true };
    case 'justify-self':
      if (isFlexChild) {
        return { ok: false, hint: '⚠ flex 子项忽略 justify-self（改用父容器 justify-content 或自身 margin:auto）' };
      }
      return { ok: true };
    case 'align-self':
      if (!parentIsFlexGrid) {
        return { ok: false, hint: '⚠ 父容器非 flex/grid 布局，此属性不生效' };
      }
      return { ok: true };
    case 'gap':
      if (!isFlexOrGridSelf) {
        return { ok: false, hint: '⚠ gap 主要用于 flex/grid 布局，普通布局中无效果' };
      }
      return { ok: true };
  }
  return null;
}

function escapeHtmlAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function rgbToHex(c) {
  if (!c) return '#000000';
  if (c[0] === '#') return c.length === 4 ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c;
  const m = c.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#000000';
  return '#' + [1, 2, 3].map(i => (+m[i]).toString(16).padStart(2, '0')).join('');
}

function normalizeStyleValue(prop, v) {
  if (v === '') return '';
  if (NEED_UNIT_PROPS.includes(prop) && /^\d+(\.\d+)?$/.test(v)) return v + 'px';
  return v;
}

// ---- 字体管理 ----
const FALLBACK_FONTS = [
  'Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', 'FangSong', 'PingFang SC', 'Noto Sans CJK SC',
  'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Garamond', 'Courier New', 'Consolas',
  'Verdana', 'Tahoma', 'Impact', 'Segoe UI', 'Roboto', 'system-ui', 'sans-serif', 'serif', 'monospace',
];
let fontFamilies = [...FALLBACK_FONTS];
let importedFontFaces = [];

const STYLE_GROUPS = [
  { title: '📐 尺寸 / 限宽限高', props: ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height'], open: true },
  { title: '🎨 颜色', props: ['color', 'background-color', 'border-color', 'opacity'], open: true },
  { title: '🔍 缩放 (真缩放)', props: ['zoom', 'transform', 'transform-origin'], open: false },
  { title: '🔤 字体', props: ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing'], open: false },
  { title: '🎯 对齐 / 布局', props: ['display', 'text-align', 'justify-content', 'justify-self', 'align-items', 'align-self', 'flex-direction', 'gap', 'margin', 'padding'], open: false },
  { title: '📌 定位 / 滚动', props: ['position', 'top', 'right', 'bottom', 'left', 'z-index', 'overflow', 'overflow-x', 'overflow-y'], open: false },
];

// ==================== 相关属性联动复制 ====================
const RELATED_STYLE_PROPS = {
  'max-width': ['width', 'min-width', 'box-sizing', 'overflow-x'],
  'max-height': ['height', 'min-height', 'box-sizing', 'overflow-y'],
  'overflow-x': ['overflow-y', 'max-width'],
  'overflow-y': ['overflow-x', 'max-height'],
  'zoom': ['transform-origin'],
  'transform': ['transform-origin'],
};

function getPropValueForCopy(el, prop) {
  let v = '';
  try { v = el.style.getPropertyValue(prop).trim(); } catch (e) {}
  if (!v) {
    try { v = getComputedStyle(el).getPropertyValue(prop).trim(); } catch (e) {}
  }
  return v;
}

function buildRelatedCopy(el, prop, shown) {
  const main = `${prop}: ${shown};`;
  const related = RELATED_STYLE_PROPS[prop];
  if (!related || !el) return main;
  const extra = [];
  for (const p of related) {
    if (p === prop) continue;
    const v = getPropValueForCopy(el, p);
    if (!v) continue;
    const isOverflow = p.startsWith('overflow');
    if (isOverflow && v === 'visible') continue;
    if (!isOverflow && !(el.style.getPropertyValue(p) || '').trim()) continue;
    extra.push(`${p}: ${v};`);
  }
  return extra.length ? main + ' ' + extra.join(' ') : main;
}

const SIZE_BUNDLE_PROPS = ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'overflow', 'overflow-x', 'overflow-y', 'box-sizing'];

function buildSizeBundle(el) {
  const lines = [];
  for (const p of SIZE_BUNDLE_PROPS) {
    let v = '';
    try { v = el.style.getPropertyValue(p).trim(); } catch (e) {}
    if (!v) {
      try { v = getComputedStyle(el).getPropertyValue(p).trim(); } catch (e) {}
    }
    if (!v) continue;
    if (p.startsWith('overflow') && v === 'visible') continue;
    lines.push(`  ${p}: ${v};`);
  }
  return lines.length ? lines.join('\n') : '  /* 未设置任何尺寸/滚动样式 */';
}

// ==================== 限宽/限高自动补 overflow ====================
const SCROLL_COMPANION = { 'max-width': 'overflow-x', 'max-height': 'overflow-y' };

function applyScrollCompanion(el, prop, value) {
  if (!el) return;
  const overflowProp = SCROLL_COMPANION[prop];
  if (!overflowProp) return;
  const limited = value && value !== 'none' && !(parseFloat(value) === 0);
  if (!limited) return;
  if (!el.style.getPropertyValue(overflowProp).trim()) {
    el.style.setProperty(overflowProp, 'auto');
  }
}

// ==================== 样式数值上下箭头微调 ====================
const STYLE_ARROW_STEPS = { 'opacity': 0.1, 'font-weight': 20, 'zoom': 0.05 };
const STYLE_ARROW_CLAMP = { 'opacity': [0, 1], 'font-weight': [100, 900], 'zoom': [0.01, 10] };

function parseStyleNumberValue(v) {
  const m = String(v).trim().match(/^(-?\d*\.?\d+)([a-z%]*)$/i);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (isNaN(num)) return null;
  return { num, unit: m[2] || '' };
}

function nudgeStyleProp(prop, value, direction, coarse, fine) {
  const baseStep = STYLE_ARROW_STEPS[prop] || 1;
  let step = baseStep * (coarse ? 10 : 1) * (fine ? 0.1 : 1);
  const p = parseStyleNumberValue(value);
  if (!p) return null;
  let num = p.num + direction * step;
  const clamp = STYLE_ARROW_CLAMP[prop];
  if (clamp) num = Math.min(clamp[1], Math.max(clamp[0], num));
  num = Math.round(num * 1000) / 1000;
  return num + p.unit;
}

function backupInlineStyle(el) {
  if (el && !styleBackupMap.has(el)) {
    styleBackupMap.set(el, el.style.cssText);
    styleBackupOrder.push(el);
  }
}

function applyStyleValue(el, prop, value) {
  if (!el || currentState === 'a') return;
  backupInlineStyle(el);
  if (value === '' || value == null) el.style.removeProperty(prop);
  else el.style.setProperty(prop, value);
  applyScrollCompanion(el, prop, value);
  if (currentState === 'd' && el === lockedElement) updateOverlay(lockedElement);
  else if (currentState === 'b' && el === previewElement) updateOverlay(previewElement);
}

function restoreAllEditedStyles() {
  if (!styleBackupOrder.length) return;
  let n = 0;
  for (let i = styleBackupOrder.length - 1; i >= 0; i--) {
    const el = styleBackupOrder[i];
    const backup = styleBackupMap.get(el);
    styleBackupOrder.splice(i, 1);
    styleBackupMap.delete(el);
    if (backup === undefined || !el.isConnected) continue;
    try { el.style.cssText = backup; n++; } catch (e) {}
  }
  if (n) showNotification(`已还原 ${n} 个元素的热编辑样式`, 'info');
}

function resetElementStyles(el) {
  if (!el) return;
  const backup = styleBackupMap.get(el);
  if (backup === undefined) {
    showNotification('该元素没有修改过样式', 'info');
    return;
  }
  el.style.cssText = backup;
  styleBackupMap.delete(el);
  const idx = styleBackupOrder.indexOf(el);
  if (idx > -1) styleBackupOrder.splice(idx, 1);
  updateOverlay(el);
  showNotification('已恢复原样式', 'success');
  if (currentState === 'd' && el === lockedElement) {
    const rect = el.getBoundingClientRect();
    updateTooltip(el, lockedIndex, lockedPath.length, rect.right, rect.top, true);
  } else if (currentState === 'b' && el === previewElement) {
    updateTooltip(el, previewIndex, previewPath.length, lastMouseX, lastMouseY, false);
  }
}

// ---- 字体：扫描本机 / 导入文件 ----
function rebuildFontSelect(panel, el, selectedName) {
  const sel = panel.querySelector('.font-select');
  if (!sel) return;
  const cur = selectedName || (el ? el.style.getPropertyValue('font-family').replace(/['"]/g, '').split(',')[0].trim() : '');
  sel.innerHTML = '<option value="">— 选择字体 —</option>';
  fontFamilies.forEach(f => {
    const o = document.createElement('option');
    o.value = f;
    o.textContent = f;
    try { o.style.fontFamily = `'${f}'`; } catch (e) {}
    if (f === cur) o.selected = true;
    sel.appendChild(o);
  });
}

function scanLocalFonts(panel, el) {
  if (typeof window.queryLocalFonts !== 'function') {
    showNotification('浏览器不支持扫描本机字体（需 Chrome 103+ 且 manifest 声明 local-fonts 权限）', 'info');
    return;
  }
  window.queryLocalFonts().then(fonts => {
    const fams = [...new Set(fonts.map(f => f.family))];
    fontFamilies = [...new Set([...fams, ...fontFamilies])];
    rebuildFontSelect(panel, el);
    showNotification(`✅ 已把 ${fams.length} 个本机字体加入下拉框`, 'success');
  }).catch(() => {
    showNotification('本机字体扫描被拒绝（需在权限弹窗中点允许）', 'info');
  });
}

function importFontFile(file, panel, el) {
  if (!file) return;
  const name = file.name.replace(/\.(ttf|otf|woff2?|ttc)$/i, '').trim() || 'ImportedFont';
  file.arrayBuffer()
    .then(buf => new FontFace(name, buf).load())
    .then(ff => {
      document.fonts.add(ff);
      importedFontFaces.push(ff);
      if (!fontFamilies.includes(name)) fontFamilies.unshift(name);
      rebuildFontSelect(panel, el, name);
      const input = panel.querySelector('.style-input[data-prop="font-family"]');
      if (input) input.value = `'${name}'`;
      applyStyleValue(el, 'font-family', `'${name}'`);
      showNotification(`字体 "${name}" 导入成功并已应用`, 'success');
    })
    .catch(err => showNotification('字体导入失败: ' + (err.message || err), 'info'));
}

// ==================== 🔑 [v9.6] 渐变背景编辑器 ====================
const GRAD_DIRS = [
  ['to right', '→ 向右'], ['to left', '← 向左'], ['to top', '↑ 向上'], ['to bottom', '↓ 向下'],
  ['to bottom right', '↘ 右下'], ['to bottom left', '↙ 左下'], ['to top right', '↗ 右上'], ['to top left', '↖ 左上'],
  ['45deg', '45° 斜向'], ['90deg', '90° 横向'], ['135deg', '135° 斜向'], ['225deg', '225° 斜向'],
  ['radial', '◎ 径向(圆形)'], ['conic', '◕ 锥形(圆环)'],
];

const GRAD_PRESETS = {
  // —— 线性 · 双色经典 ——
  'linear-gradient(to right, #3b82f6, #10b981)': '蓝→绿 横向',
  'linear-gradient(to bottom, #667eea, #764ba2)': '蓝紫 纵向',
  'linear-gradient(135deg, #ff6b6b, #feca57)': '红→黄 135°',
  'linear-gradient(to right, #ff512f, #dd2476)': '橙→玫红 横向',
  'linear-gradient(to right, #00c6ff, #0072ff)': '浅蓝→深蓝 横向',
  'linear-gradient(to right, #f7971e, #ffd200)': '橙→金黄 横向',
  'linear-gradient(to right, #11998e, #38ef7d)': '深绿→亮绿 横向',
  'linear-gradient(to right, #ee0979, #ff6a00)': '玫红→橙 横向',
  'linear-gradient(to bottom, #232526, #414345)': '碳黑 纵向',
  'linear-gradient(to right, #e0eafc, #cfdef3)': '淡云白 横向',
  // —— 线性 · 三色及以上 ——
  'linear-gradient(45deg, #ff9a9e, #fad0c4, #a18cd1)': '三色粉 45°',
  'linear-gradient(to right, #fc466b, #3f5efb, #24c6dc)': '红蓝青三色 横向',
  'linear-gradient(135deg, #f6d365, #fda085, #f5576c)': '日落三色 135°',
  'linear-gradient(to right, #00d2ff, #3a7bd5, #5e60ce)': '蓝紫青 横向',
  'linear-gradient(to bottom right, #ffecd2, #fcb69f, #ff8177)': '奶油渐暖 右下',
  // —— 径向 ——
  'radial-gradient(circle, #ff6b6b, #feca57)': '红→黄 径向',
  'radial-gradient(circle at center, #a18cd1 0%, #fbc2eb 100%)': '紫→粉 径向',
  'radial-gradient(circle, #ffffff, #dfe9f3, #a6c1ee)': '白→蓝 径向(光晕)',
  'radial-gradient(circle, #0f0c29, #302b63, #24243e)': '深空夜色 径向',
  // —— 锥形 ——
  'conic-gradient(from 0deg, #ff6b6b, #feca57, #48dbfb, #ff6b6b)': '彩色圆环 锥形',
  'conic-gradient(from 90deg, #667eea, #764ba2, #667eea)': '蓝紫环 锥形',
  'conic-gradient(from 0deg, #ffffff, #dfe9f3, #ffffff)': '白色光泽 锥形',
  // —— 特色 / 玻璃拟态 ——
  'linear-gradient(120deg, rgba(255,255,255,0.25), rgba(255,255,255,0.05))': '玻璃拟态 白纱',
  'linear-gradient(135deg, rgba(59,130,246,0.35), rgba(16,185,129,0.15))': '玻璃拟态 蓝绿',
  'none': '无渐变(none)',
};

// 顶层逗号切分（忽略 rgba()/hsl() 括号内的逗号）
function splitGradientStops(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of String(s)) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

// 任意颜色 → #rrggbb（颜色输入框只认 hex；支持颜色名/rgb/hsl）
function colorToHex(c) {
  const v = String(c || '').trim();
  if (!v) return '#000000';
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{8}$/i.test(v)) return v.slice(0, 7);
  if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + [...v.slice(1)].map(x => x + x).join('');
  let cs = null;
  try {
    const t = document.createElement('i');
    t.style.color = v;
    document.body.appendChild(t);
    cs = getComputedStyle(t).color;
    t.remove();
  } catch (e) {}
  return rgbToHex(cs || v);
}

// 解析停靠点字符串 → [{color, pos}]
function parseGradientStops(s) {
  return splitGradientStops(s).map(stop => {
    let color = stop, pos = '';
    const m = stop.match(/^(.+?)\s+(-?[\d.]+(?:%|px|em|rem|vh|vw))$/i);
    if (m && /^[-\d.]/.test(m[2])) {
      const maybe = m[1].trim();
      if (/^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|[a-z]+)$/i.test(maybe)) {
        color = maybe;
        pos = m[2];
      }
    }
    return { color, pos };
  });
}

function parseGradientInfo(v) {
  v = String(v || '').trim();
  if (!v || v === 'none') return { dir: 'to right', stops: '#3b82f6, #10b981' };
  const m = v.match(/^(linear|radial|conic)-gradient\(([\s\S]*)\)\s*$/);
  if (!m) return null; // url() 等无法解析的背景不渲染编辑器
  let inner = m[2].trim(), dir = 'to right';
  if (m[1] === 'linear') {
    const dm = inner.match(/^(to\s+(?:top|bottom|left|right)(?:\s+(?:top|bottom|left|right))?|[-\d.]+deg)\s*,\s*/i);
    if (dm) {
      dir = dm[1].toLowerCase().replace(/\s+/g, ' ');
      inner = inner.slice(dm[0].length);
    }
  } else if (m[1] === 'radial') {
    dir = 'radial';
    inner = inner.replace(/^circle[^,]*,\s*/i, '');
  } else {
    dir = 'conic';
    inner = inner.replace(/^from\s+[-\d.]+deg\s*,\s*/i, '');
  }
  return { dir, stops: inner };
}

// 🔑 [v9.6.4] 渲染过渡色点行：卡片式两行布局，占满面板宽度不出界
// 第一行 = 编号 + 取色块 + 颜色代码框；第二行 = 位置框 + ➖删除
function renderGradientStopRows(stopsStr, dis) {
  const stops = parseGradientStops(stopsStr);
  if (!stops.length) stops.push({ color: '#3b82f6', pos: '' }, { color: '#10b981', pos: '' });
  const colorInputStyle = `width:24px;height:20px;border:none;background:none;cursor:pointer;flex-shrink:0;padding:0;`;
  const codeInputStyle = `flex:1;min-width:0;background:#0f172a;color:#fbbf24;border:1px solid #4b5563;border-radius:3px;padding:2px 4px;font-size:10px;font-family:monospace;outline:none;`;
  const posInputStyle = `flex:1;min-width:0;background:#0f172a;color:#fbbf24;border:1px solid #4b5563;border-radius:3px;padding:2px 4px;font-size:10px;font-family:monospace;outline:none;`;
  const delBtnStyle = `background:#7f1d1d;color:#fff;border:none;border-radius:3px;padding:2px 10px;font-size:10px;cursor:pointer;flex-shrink:0;`;
  return stops.map((s, i) => {
    const hex = colorToHex(s.color);
    return `<div class="grad-stop" style="margin:4px 0;padding:4px 5px;background:#0d1420;border:1px solid #334155;border-radius:5px;">
      <div style="display:flex;align-items:center;gap:5px;">
        <span style="color:#6b7280;font-size:9px;min-width:12px;text-align:right;flex-shrink:0;">${i + 1}</span>
        <input type="color" class="grad-stop-color" value="${hex}" ${dis} title="点击改颜色" style="${colorInputStyle}">
        <input type="text" class="grad-stop-hex" spellcheck="false" ${dis} value="${escapeHtmlAttr(hex)}" placeholder="#ff6b6b 或颜色名" title="颜色代码：输入 #hex / 颜色名 / rgb()，自动换算同步左侧取色块" style="${codeInputStyle}">
      </div>
      <div style="display:flex;align-items:center;gap:5px;margin-top:3px;">
        <span style="color:#6b7280;font-size:9px;min-width:12px;text-align:right;flex-shrink:0;" title="停靠位置">%</span>
        <input type="text" class="grad-stop-pos" spellcheck="false" ${dis} value="${escapeHtmlAttr(s.pos)}" placeholder="位置：20% / 120px，留空=自动均分" title="停靠位置（如 20% / 120px），留空=自动均分" style="${posInputStyle}">
        <button class="grad-del" ${dis} title="删除该过渡点" style="${delBtnStyle}">➖</button>
      </div>
    </div>`;
  }).join('');
}

function buildGradientEditorHtml(el, isLocked) {
  let cur = '';
  try { cur = el.style.getPropertyValue('background-image').trim(); } catch (e) {}
  if (!cur) {
    try { cur = getComputedStyle(el).getPropertyValue('background-image').trim(); } catch (e) {}
  }
  let icur = `background-image:${cur};`;
  const info = parseGradientInfo(cur);
  if (!info) return ''; // url() 等无法解析的背景不渲染编辑器
  const edited = (() => {
    try { return !!el.style.getPropertyValue('background-image').trim(); } catch (e) { return false; }
  })();
  const dis = isLocked ? '' : 'disabled';
  const selStyle = `background:#0f172a;color:#fbbf24;border:1px solid #4b5563;border-radius:3px;padding:2px;font-size:10px;cursor:pointer;flex:1;min-width:0;`;
  let dirOpts = '';
  for (const [val, desc] of GRAD_DIRS) dirOpts += `<option value="${val}"${info.dir === val ? ' selected' : ''}>${desc}</option>`;
  let presetOpts = '<option value="">🎨 预设…</option>';
  for (const [val, desc] of Object.entries(GRAD_PRESETS)) presetOpts += `<option value="${escapeHtmlAttr(val)}"${cur === val ? ' selected' : ''}>${desc}</option>`;
  return `<div class="grad-editor" style="margin:4px 0 2px 0;background:#1f2a3d;border:1px dashed #4b5563;border-radius:4px;padding:5px 6px;">
    <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px;">
      <span class="grad-label copy-btn" data-copy="${escapeHtmlAttr(icur)}" title="点击复制完整渐变配置" style="color:#94a3b8;min-width:86px;flex-shrink:0;font-size:10px;cursor:pointer;">📋 background-image <span style="color:${edited ? '#34d399' : '#6b7280'};font-size:9px;">${edited ? '已编辑' : '(渐变)'}</span></span>
      <select class="grad-preset" ${dis} style="${selStyle}max-width:96px;flex-shrink:1;">${presetOpts}</select>
      <button class="grad-clear" ${dis} style="background:#374151;color:#fff;border:none;border-radius:3px;padding:2px 6px;font-size:9px;cursor:pointer;flex-shrink:0;">✕ 清除</button>
    </div>
    <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px;">
      <span style="color:#94a3b8;min-width:86px;flex-shrink:0;font-size:10px;">方向</span>
      <select class="grad-dir" ${dis} style="${selStyle}">${dirOpts}</select>
    </div>
    <div style="color:#94a3b8;font-size:10px;margin:5px 0 1px 0;">过渡色点 <span style="color:#6b7280;font-size:9px;">（2~N 个，➕/➖ 增减，位置留空=自动均分）</span></div>
    <div class="grad-stops-box">
      ${renderGradientStopRows(info.stops, dis)}
      <button class="grad-add" ${dis} title="在末尾追加一个过渡色点" style="margin-top:3px;width:100%;background:#374151;color:#fff;border:none;border-radius:3px;padding:3px 8px;font-size:10px;cursor:pointer;">➕ 添加过渡色</button>
    </div>
    <div style="color:#6b7280;font-size:9px;margin-top:2px;">点左上 📋 可复制当前渐变完整配置</div>
  </div>`;
}

function syncGradCopyLabel(editor, v) {
  const label = editor.querySelector('.grad-label');
  if (label) label.dataset.copy = v ? `background-image:${v};` : '';
}


function applyGradientFromEditor(editor, el) {
  const dirSel = editor.querySelector('.grad-dir');
  const presetSel = editor.querySelector('.grad-preset');
  if (!dirSel) return;
  // 预设分支：选中了具体预设才进入；空值「🎨 预设…」走下方自定义组装
  if (presetSel && presetSel.value) {
    const pv = presetSel.value;
    if (pv === 'none') {
      applyStyleValue(el, 'background-image', '');
      syncGradCopyLabel(editor, '');
      return;
    }
    const pi = parseGradientInfo(pv);
    if (pi) {
      dirSel.value = pi.dir;
      const box = editor.querySelector('.grad-stops-box');
      const addBtn = box ? box.querySelector('.grad-add') : null;
      if (box) {
        const editable = addBtn && !addBtn.disabled;
        box.innerHTML = renderGradientStopRows(pi.stops, editable ? '' : 'disabled');
        if (addBtn) box.appendChild(addBtn);
      }
    }
    applyStyleValue(el, 'background-image', pv);
    syncGradCopyLabel(editor, pv);
    return;
  }
  const dir = dirSel.value;
  const parts = [...editor.querySelectorAll('.grad-stop')].map(r => {
    const ci = r.querySelector('.grad-stop-color');
    const c = ci ? ci.value : '#000000';
    const p = (r.querySelector('.grad-stop-pos').value || '').trim();
    return p ? `${c} ${p}` : c;
  });
  if (!parts.length) {
    applyStyleValue(el, 'background-image', '');
    syncGradCopyLabel(editor, '');
    return;
  }
  let v;
  if (dir === 'radial') v = `radial-gradient(circle, ${parts.join(', ')})`;
  else if (dir === 'conic') v = `conic-gradient(from 0deg, ${parts.join(', ')})`;
  else v = `linear-gradient(${dir}, ${parts.join(', ')})`;
  applyStyleValue(el, 'background-image', v);
  syncGradCopyLabel(editor, v);
}

// ---- 面板渲染 ----
function renderStylePanel(el, isLocked) {
  if (!el) return '';
  let cs;
  try { cs = getComputedStyle(el); } catch (e) { return ''; }
  const inputBaseStyle = (edited) => `flex:1;min-width:0;background:${edited ? '#0f2b1e' : '#0f172a'}; color:${edited ? '#34d399' : '#fbbf24'};border:1px solid ${edited ? '#10b981' : '#4b5563'}; border-radius:3px;padding:2px 4px;font-size:10px;font-family:monospace;`;
  const selectStyle = `background:#0f172a;color:#fbbf24;border:1px solid #4b5563;border-radius:3px; padding:2px;font-size:10px;font-family:monospace;max-width:120px;flex-shrink:0;cursor:pointer;`;
  let html = `<div id="style-panel" style="margin:8px 0;background:#1a2332;padding:8px;border-radius:4px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
      <span style="color:#94a3b8;font-weight:500;">🎨 样式 ${isLocked ? '<span style="color:#10b981;font-size:10px;">可热编辑·刷新前保留</span>' : '<span style="color:#f59e0b;font-size:10px;">锁定后可编辑</span>'}</span>
      ${styleBackupMap.has(el) ? `<button id="style-reset" style="background:#ef4444;color:#fff;border:none;border-radius:3px;padding:2px 6px;font-size:10px;cursor:pointer;">↩ 重置样式</button>` : ''}
    </div>
    <div style="color:#6b7280;font-size:10px;margin-bottom:4px;">
      实时尺寸: <span id="style-live-size" style="color:#fbbf24;">${Math.round(el.offsetWidth)} × ${Math.round(el.offsetHeight)}</span>
    </div>`;
  for (const group of STYLE_GROUPS) {
    html += `<details style="margin:4px 0;background:#2d3748;border-radius:4px;padding:4px 6px;" ${group.open ? 'open' : ''}>
      <summary style="cursor:pointer;color:#a5b4fc;font-size:11px;user-select:none;">${group.title}</summary>`;
    // 尺寸组顶部：一键复制整套尺寸+滚动方案
    if (group.props[0] === 'width') {
      html += `<div style="text-align:right;margin-bottom:3px;">
        <button class="copy-btn" data-copy="${escapeHtmlAttr(buildSizeBundle(el))}" style="background:#374151;color:#fff;border:none;border-radius:3px; padding:2px 6px;font-size:9px;cursor:pointer;" title="复制 width/height/min/max/overflow/box-sizing 全部非默认值">📋 复制整套尺寸+滚动方案</button>
      </div>`;
    }
    for (const prop of group.props) {
      const computed = cs.getPropertyValue(prop).trim();
      const inline = el.style.getPropertyValue(prop).trim();
      const shown = inline || computed;
      const isColor = COLOR_PROPS.includes(prop);
      const enumDef = STYLE_ENUMS[prop];
      const isFont = prop === 'font-family';
      const edited = !!inline;
      const cond = checkStyleCondition(el, prop);
      const condHidden = (cond && cond.ok === false) ? '' : 'display:none;';
      html += `<div style="display:flex;align-items:center;gap:4px;margin:3px 0;font-size:10px;flex-wrap:wrap;">
        <span class="style-label copy-btn" data-prop="${prop}" style="color:#94a3b8;min-width:86px;flex-shrink:0;cursor:pointer;" data-copy="${escapeHtmlAttr(buildRelatedCopy(el, prop, shown))}" title="点击复制 ${prop}${RELATED_STYLE_PROPS[prop] ? '（自动连带相关样式）' : ''}">${prop}</span>`;
      if (isFont) {
        html += `<select class="font-select" ${isLocked ? '' : 'disabled'} style="${selectStyle}max-width:130px;">
          <option value="">— 选择字体 —</option>`;
        fontFamilies.forEach(f => {
          const sel = (shown === `'${f}'` || shown === `"${f}"` || shown === f) ? ' selected' : '';
          html += `<option value="${escapeHtmlAttr(f)}"${sel} style="font-family:'${escapeHtmlAttr(f)}'">${escapeHtmlAttr(f)}</option>`;
        });
        html += `</select>
          <button class="font-scan" ${isLocked ? '' : 'disabled'} title="扫描本机全部字体" style="background:#374151;color:#fff;border:none;border-radius:3px;padding:2px 5px;font-size:10px;cursor:pointer;">🌐</button>
          <button class="font-import" ${isLocked ? '' : 'disabled'} title="导入本地字体文件" style="background:#374151;color:#fff;border:none;border-radius:3px;padding:2px 5px;font-size:10px;cursor:pointer;">📂</button>
          <input type="file" class="font-file" accept=".ttf,.otf,.woff,.woff2,.ttc" style="display:none;">`;
      } else if (enumDef) {
        html += `<select class="style-enum" data-prop="${prop}" ${isLocked ? '' : 'disabled'} style="${selectStyle}">
          <option value="">自定义…</option>`;
        let matched = false;
        for (const [val, desc] of Object.entries(enumDef)) {
          const s = shown === val ? ' selected' : '';
          if (s) matched = true;
          html += `<option value="${val}"${s}>${val} · ${desc}</option>`;
        }
        if (!matched && shown) {
          html += `<option value="${escapeHtmlAttr(shown)}" selected>${escapeHtmlAttr(shown)} · (当前值)</option>`;
        }
        html += `</select>`;
      }
      if (isColor) {
        html += `<input type="color" class="style-color" data-prop="${prop}" value="${rgbToHex(inline || computed)}" ${isLocked ? '' : 'disabled'} style="width:22px;height:18px;border:none;background:none;cursor:pointer;flex-shrink:0;">`;
      }
      html += `<input type="text" class="style-input" data-prop="${prop}" spellcheck="false" value="${escapeHtmlAttr(shown)}" ${isLocked ? '' : 'disabled'} style="${inputBaseStyle(edited)}">`;
      if (cond !== null) {
        html += `<span class="style-cond-hint" data-prop="${prop}" style="${condHidden}">${cond && cond.hint ? cond.hint : ''}</span>`;
      }
      html += `</div>`;
    }
    // 🔑 [v9.6] 颜色组顶部：渐变背景编辑器（仅附加块，属性行照常渲染在下方）
    if (group.title.includes('颜色')) {
      html += buildGradientEditorHtml(el, isLocked);
    }
    html += `</details>`;
  }
  html += `</div>`;
  return html;
}

// ==================== 视频/音频控制面板 ====================
const isMediaEl = (el) => !!el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO');

function formatMediaTime(s) {
  if (s == null || !isFinite(s) || isNaN(s)) return '—';
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

const MEDIA_READY_STATE = {
  0: 'HAVE_NOTHING·无任何资源', 1: 'HAVE_METADATA·已有时长尺寸', 2: 'HAVE_CURRENT_DATA·有当前帧数据',
  3: 'HAVE_FUTURE_DATA·有未来几帧', 4: 'HAVE_ENOUGH_DATA·可流畅播放',
};
const MEDIA_NETWORK_STATE = {
  0: 'EMPTY·尚未初始化', 1: 'IDLE·空闲·已加载完', 2: 'LOADING·下载中', 3: 'NO_SOURCE·找不到资源/格式不支持',
};
const PLAYBACK_RATE_ENUM = {
  '0.25': '极慢·0.25x', '0.5': '慢速·0.5x', '0.75': '稍慢·0.75x', '1': '常速(默认)',
  '1.25': '稍快·1.25x', '1.5': '快速·1.5x', '2': '双倍速', '3': '三倍速', '4': '四倍速',
};

const videoPropBackupMap = new WeakMap();
const videoEditedPropsMap = new WeakMap();

function backupVideoProps(el) {
  if (el && !videoPropBackupMap.has(el)) {
    videoPropBackupMap.set(el, {
      currentTime: el.currentTime,
      playbackRate: el.playbackRate,
      volume: el.volume,
      muted: el.muted,
      loop: el.loop,
    });
  }
}

function markVideoEdited(el, prop) {
  if (!el) return;
  let set = videoEditedPropsMap.get(el);
  if (!set) { set = new Set(); videoEditedPropsMap.set(el, set); }
  set.add(prop);
}

function applyVideoValue(el, prop, value) {
  if (!el || currentState === 'a') return;
  backupVideoProps(el);
  try {
    switch (prop) {
      case 'currentTime':
        if (el.readyState >= 1) el.currentTime = value;
        else showNotification('视频元数据尚未加载，无法跳转进度', 'info');
        break;
      case 'playbackRate': el.playbackRate = value; break;
      case 'volume':
        el.volume = Math.min(1, Math.max(0, value));
        if (el.volume > 0) el.muted = 1;
        break;
      case 'muted': el.muted = !!value; break;
      case 'loop': el.loop = !!value; break;
    }
    markVideoEdited(el, prop);
  } catch (e) {
    showNotification('设置失败: ' + (e.message || e), 'info');
  }
}

function resetVideoProps(el) {
  const b = videoPropBackupMap.get(el);
  if (!b) {
    showNotification('该媒体没有修改过播放参数', 'info');
    return;
  }
  try { if (el.readyState >= 1) el.currentTime = b.currentTime; } catch (e) {}
  try { el.playbackRate = b.playbackRate; } catch (e) {}
  try { el.volume = b.volume; } catch (e) {}
  el.muted = b.muted;
  el.loop = b.loop;
  videoEditedPropsMap.delete(el);
  videoPropBackupMap.delete(el);
  showNotification('已恢复原始播放参数', 'success');
}

function renderVideoPanel(el, isLocked) {
  if (!isMediaEl(el)) return '';
  const isAudio = el.tagName === 'AUDIO';
  const title = isAudio ? '🎵 音频控制' : '🎬 视频控制';
  const editable = isLocked ? '' : 'disabled';
  const edited = videoEditedPropsMap.get(el) || new Set();
  const numStyle = (prop) => `flex:1;min-width:44px;width:60px;background:${edited.has(prop) ? '#0f2b1e' : '#0f172a'}; color:${edited.has(prop) ? '#34d399' : '#fbbf24'};border:1px solid ${edited.has(prop) ? '#10b981' : '#4b5563'}; border-radius:3px;padding:2px 4px;font-size:10px;font-family:monospace;`;
  const btnStyle = `background:#374151;color:#fff;border:none;border-radius:3px;padding:2px 6px;font-size:10px;cursor:pointer;`;
  const actBtnStyle = `background:#4f46e5;color:#fff;border:none;border-radius:3px;padding:2px 8px;font-size:10px;cursor:pointer;`;
  const rowStyle = `display:flex;align-items:center;gap:4px;margin:3px 0;font-size:10px;flex-wrap:wrap;`;
  const labelStyle = `color:#94a3b8;min-width:86px;flex-shrink:0;`;
  let rateOpts = `<option value="">自定义…</option>`;
  for (const [val, desc] of Object.entries(PLAYBACK_RATE_ENUM)) {
    rateOpts += `<option value="${val}"${el.playbackRate === parseFloat(val) ? ' selected' : ''}>${val} · ${desc}</option>`;
  }
  const srcCopy = el.currentSrc || el.src || '';
  let html = `<div id="video-panel" style="margin:8px 0;background:#1a2332;padding:8px;border-radius:4px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
      <span style="color:#94a3b8;font-weight:500;">${title} ${isLocked ? '<span style="color:#10b981;font-size:10px;">可热编辑·实时刷新</span>' : '<span style="color:#f59e0b;font-size:10px;">锁定后可编辑</span>'}</span>
      ${videoPropBackupMap.has(el) ? `<button id="v-reset" style="background:#ef4444;color:#fff;border:none;border-radius:3px;padding:2px 6px;font-size:10px;cursor:pointer;">↩ 重置播放参数</button>` : ''}
    </div>
    <div style="${rowStyle}">
      <span id="v-status" style="color:#a5b4fc;flex-shrink:0;">…</span>
      <span style="flex:1;text-align:center;">
        <span id="v-cur" style="color:#fbbf24;">—</span>
        <span style="color:#6b7280;"> / </span>
        <span id="v-dur" style="color:#94a3b8;">—</span>
      </span>
      <button id="v-play" ${editable} style="${actBtnStyle}" title="play() / pause()">▶ 播放</button>
      <button id="v-fs" ${editable} style="${btnStyle}" title="requestFullscreen()">⛶</button>
    </div>
    <div id="v-bar" style="position:relative;height:8px;background:#0f172a;border-radius:4px;margin:4px 0;cursor:pointer;overflow:hidden;" title="点击进度条跳转（锁定后可用）">
      <div id="v-fill" style="height:100%;width:0%;background:linear-gradient(90deg,#3b82f6,#10b981);border-radius:4px;"></div>
    </div>
    <div style="display:flex;gap:4px;margin:4px 0;">
      <button class="v-seek-btn" data-delta="-10" ${editable} style="${btnStyle}flex:1;">«10s</button>
      <button class="v-seek-btn" data-delta="-5" ${editable} style="${btnStyle}flex:1;">‹5s</button>
      <button class="v-seek-btn" data-delta="5" ${editable} style="${btnStyle}flex:1;">5s›</button>
      <button class="v-seek-btn" data-delta="10" ${editable} style="${btnStyle}flex:1;">10s»</button>
    </div>
    <div style="${rowStyle}">
      <span style="${labelStyle}" title="currentTime·当前播放位置(秒)">currentTime</span>
      <input type="range" id="v-seek" min="0" max="${isFinite(el.duration) && el.duration > 0 ? el.duration.toFixed(2) : 100}" step="0.1" value="0" ${editable} style="flex:1;min-width:60px;cursor:pointer;">
      <input type="number" id="v-ctime" min="0" step="0.1" value="${el.currentTime.toFixed ? el.currentTime.toFixed(2) : 0}" ${editable} style="${numStyle('currentTime')}">
    </div>
    <div style="${rowStyle}">
      <span style="${labelStyle}" title="playbackRate·倍速">playbackRate</span>
      <select id="v-rate-sel" ${editable} style="background:#0f172a;color:#fbbf24;border:1px solid #4b5563;border-radius:3px; padding:2px;font-size:10px;font-family:monospace;max-width:120px;flex-shrink:0;cursor:pointer;">${rateOpts}</select>
      <input type="number" id="v-rate" min="0.1" max="16" step="0.05" value="${el.playbackRate}" ${editable} style="${numStyle('playbackRate')}">
    </div>
    <div style="${rowStyle}">
      <span style="${labelStyle}" title="volume·音量(0-1)">volume</span>
      <input type="range" id="v-vol" min="0" max="1" step="0.05" value="${el.volume}" ${editable} style="flex:1;min-width:60px;cursor:pointer;">
      <input type="number" id="v-voln" min="0" max="1" step="0.05" value="${el.volume}" ${editable} style="${numStyle('volume')}">
    </div>
    <div style="display:flex;gap:4px;margin:4px 0;">
      <button id="v-muted" ${editable} style="${btnStyle}flex:1;">🔊 有声音</button>
      <button id="v-loop" ${editable} style="${btnStyle}flex:1;">➡ 循环: 关</button>
    </div>
    <div style="background:#2d3748;border-radius:4px;padding:4px 6px;margin-top:4px;">
      <div style="${rowStyle}">
        <span style="${labelStyle}">currentSrc</span>
        <span class="copy-btn" data-copy="${escapeHtmlAttr(srcCopy)}" style="color:#fbbf24;word-break:break-all;flex:1;font-size:9px;cursor:pointer;" title="点击复制地址">${srcCopy ? escapeHtml(srcCopy) : '（空）'}</span>
      </div>
      <div style="${rowStyle}">
        <span style="${labelStyle}">readyState</span>
        <span id="v-ready" style="color:#fbbf24;flex:1;">${MEDIA_READY_STATE[el.readyState] || el.readyState}</span>
      </div>
      <div style="${rowStyle}">
        <span style="${labelStyle}">networkState</span>
        <span id="v-net" style="color:#fbbf24;flex:1;">${MEDIA_NETWORK_STATE[el.networkState] || el.networkState}</span>
      </div>
      <div style="${rowStyle}">
        <span style="${labelStyle}">buffered</span>
        <span id="v-buf" style="color:#fbbf24;flex:1;">—</span>
      </div>
      ${!isAudio ? `
      <div style="${rowStyle}">
        <span style="${labelStyle}">视频分辨率</span>
        <span style="color:#fbbf24;flex:1;">${el.videoWidth || 0} × ${el.videoHeight || 0}</span>
      </div>` : ''}
    </div>
  </div>`;
  return html;
}

function bindVideoPanel(el, isLocked) {
  const panel = tooltip.querySelector('#video-panel');
  if (!panel || !isMediaEl(el)) return;
  const isAudio = el.tagName === 'AUDIO';
  const q = (sel) => panel.querySelector(sel);
  const stop = (ev) => ev.stopPropagation();

  const refresh = () => {
    const cur = q('#v-cur'), dur = q('#v-dur'), fill = q('#v-fill'), status = q('#v-status'),
      seek = q('#v-seek'), ctime = q('#v-ctime'), rate = q('#v-rate'), rateSel = q('#v-rate-sel'),
      vol = q('#v-vol'), voln = q('#v-voln'), mutedBtn = q('#v-muted'), loopBtn = q('#v-loop'),
      ready = q('#v-ready'), net = q('#v-net'), buf = q('#v-buf'), playBtn = q('#v-play');
    const finite = isFinite(el.duration) && el.duration > 0;
    if (cur) cur.textContent = formatMediaTime(el.currentTime);
    if (dur) dur.textContent = formatMediaTime(el.duration);
    if (fill) fill.style.width = finite ? ((el.currentTime / el.duration) * 100).toFixed(2) + '%' : '0%';
    if (status) status.textContent = el.ended ? '⏹ 已结束' : (el.paused ? '⏸ 已暂停' : '▶ 播放中');
    if (seek) {
      if (finite) seek.max = el.duration.toFixed(2);
      if (document.activeElement !== seek) seek.value = el.currentTime;
    }
    if (ctime && document.activeElement !== ctime) ctime.value = el.currentTime.toFixed(2);
    if (rate && document.activeElement !== rate) rate.value = el.playbackRate;
    if (rateSel) {
      const has = [...rateSel.options].some(o => parseFloat(o.value) === el.playbackRate);
      rateSel.value = has ? String(el.playbackRate) : '';
    }
    if (vol && document.activeElement !== vol) vol.value = el.volume;
    if (voln && document.activeElement !== voln) voln.value = el.volume;
    if (mutedBtn) mutedBtn.textContent = el.muted ? '🔇 已静音' : '🔊 有声音';
    if (loopBtn) loopBtn.textContent = el.loop ? '🔁 循环: 开' : '➡ 循环: 关';
    if (ready) ready.textContent = MEDIA_READY_STATE[el.readyState] || el.readyState;
    if (net) net.textContent = MEDIA_NETWORK_STATE[el.networkState] || el.networkState;
    if (buf) {
      try {
        let end = 0;
        if (el.buffered.length) end = el.buffered.end(el.buffered.length - 1);
        buf.textContent = finite ? `${formatMediaTime(end)} (${Math.round((end / el.duration) * 100)}%)` : '—';
      } catch (e) {}
    }
    if (playBtn) playBtn.textContent = el.paused ? '▶ 播放' : '⏸ 暂停';
  };

  const events = ['timeupdate', 'durationchange', 'ratechange', 'volumechange', 'play', 'pause', 'ended', 'loadedmetadata', 'progress', 'seeking', 'seeked'];
  events.forEach(ev => el.addEventListener(ev, refresh));
  videoPanelCleanup = () => { events.forEach(ev => el.removeEventListener(ev, refresh)); };
  refresh();

  panel.querySelectorAll('input, select, button').forEach(elm => {
    elm.addEventListener('pointerdown', stop);
    elm.addEventListener('click', stop);
  });

  const seek = q('#v-seek');
  if (seek) seek.addEventListener('input', (ev) => {
    stop(ev);
    if (isLocked) applyVideoValue(el, 'currentTime', parseFloat(seek.value));
  });

  const ctime = q('#v-ctime');
  if (ctime) ctime.addEventListener('input', (ev) => {
    stop(ev);
    if (!isLocked) return;
    const v = parseFloat(ctime.value);
    if (!isNaN(v)) applyVideoValue(el, 'currentTime', v);
  });

  panel.querySelectorAll('.v-seek-btn').forEach(b => {
    b.onclick = (ev) => {
      stop(ev);
      if (!isLocked) return;
      applyVideoValue(el, 'currentTime', el.currentTime + parseFloat(b.dataset.delta));
    };
  });

  const bar = q('#v-bar');
  if (bar) bar.addEventListener('click', (ev) => {
    stop(ev);
    if (!isLocked) return;
    if (!isFinite(el.duration) || el.duration <= 0) return;
    const r = bar.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    applyVideoValue(el, 'currentTime', p * el.duration);
  });

  const rateSel = q('#v-rate-sel');
  if (rateSel) rateSel.addEventListener('change', (ev) => {
    stop(ev);
    if (!isLocked || !rateSel.value) return;
    applyVideoValue(el, 'playbackRate', parseFloat(rateSel.value));
    const r = q('#v-rate');
    if (r) r.value = rateSel.value;
  });

  const rate = q('#v-rate');
  if (rate) rate.addEventListener('input', (ev) => {
    stop(ev);
    if (!isLocked) return;
    const v = parseFloat(rate.value);
    if (!isNaN(v) && v > 0) applyVideoValue(el, 'playbackRate', v);
  });

  const vol = q('#v-vol'), voln = q('#v-voln');
  if (vol) vol.addEventListener('input', (ev) => {
    stop(ev);
    if (isLocked) applyVideoValue(el, 'volume', parseFloat(vol.value));
  });
  if (voln) voln.addEventListener('input', (ev) => {
    stop(ev);
    if (!isLocked) return;
    const v = parseFloat(voln.value);
    if (!isNaN(v)) applyVideoValue(el, 'volume', v);
  });

  const mutedBtn = q('#v-muted');
  if (mutedBtn) mutedBtn.onclick = (ev) => { stop(ev); if (isLocked) applyVideoValue(el, 'muted', !el.muted); };

  const loopBtn = q('#v-loop');
  if (loopBtn) loopBtn.onclick = (ev) => { stop(ev); if (isLocked) applyVideoValue(el, 'loop', !el.loop); };

  const playBtn = q('#v-play');
  if (playBtn) playBtn.onclick = (ev) => {
    stop(ev);
    if (!isLocked) return;
    if (el.paused) {
      el.play().catch(err => showNotification('播放失败: ' + (err.message || err), 'info'));
    } else {
      el.pause();
    }
  };

  const fsBtn = q('#v-fs');
  if (fsBtn) fsBtn.onclick = (ev) => {
    stop(ev);
    if (!isLocked) return;
    if (!isMediaEl(el)) return;
    const fsDoc = ownerDocOf(el);
    if (!fsDoc.fullscreenEnabled) {
      console.warn('[Picker] fullscreenEnabled = false，页面/iframe 不允许全屏');
      showNotification('当前页面(或所在iframe)不允许全屏（iframe需有allowfullscreen属性）', 'info');
      return;
    }
    if (!isAudio && !el.hasAttribute('controls')) {
      el.setAttribute('controls', '');
      controlsAddedSet.add(el);
    }
    try {
      const p = el.requestFullscreen();
      if (p && p.catch) {
        p.catch((err) => {
          console.error('[Picker] requestFullscreen 被拒绝:', err);
          showNotification('进入全屏被拒绝: ' + (err.name || ''), 'info');
        });
      }
    } catch (err) {
      console.error('[Picker] requestFullscreen 调用异常:', err);
      if (el.webkitRequestFullscreen) {
        try { el.webkitRequestFullscreen(); } catch (e2) { showNotification('当前浏览器不支持全屏', 'info'); }
      } else {
        showNotification('当前浏览器不支持全屏', 'info');
      }
    }
  };

  const resetBtn = q('#v-reset');
  if (resetBtn) resetBtn.onclick = (ev) => {
    stop(ev);
    resetVideoProps(el);
    if (currentState === 'd' && el === lockedElement) {
      const rect = el.getBoundingClientRect();
      updateTooltip(el, lockedIndex, lockedPath.length, rect.right, rect.top, true);
    } else if (currentState === 'b' && el === previewElement) {
      updateTooltip(el, previewIndex, previewPath.length, lastMouseX, lastMouseY, false);
    }
  };
}

// ==================== 全屏播放态钩子 ====================
function enterFullscreenState() {
  currentState = 'e';
  window.__ELEMENT_PICKER_STATE = 'e';
  window.__ELEMENT_PICKER_ACTIVE = true;
  overlay.style.display = 'none';
  tooltip.style.display = 'none';
  if (updateOverlayRaf) { cancelAnimationFrame(updateOverlayRaf); updateOverlayRaf = null; }
  cleanupVideoPanel();
  updateExitButton();
  showNotification('⛶ 全屏播放中 - 空格播放/暂停 · ←→快退快进 · ↑↓音量 · M静音 · ESC退出全屏', 'info');
}

function restoreLockedState() {
  if (!lockedElement || !lockedElement.isConnected) { handleExit(); return; }
  currentState = 'd';
  window.__ELEMENT_PICKER_STATE = 'd';
  window.__ELEMENT_PICKER_ACTIVE = true;
  if (controlsAddedSet.has(lockedElement)) {
    try { lockedElement.removeAttribute('controls'); } catch (e) {}
    controlsAddedSet.delete(lockedElement);
  }
  updateOverlay(lockedElement);
  const rect = lockedElement.getBoundingClientRect();
  updateTooltip(lockedElement, lockedIndex, lockedPath.length, rect.right, rect.top, true);
  updateExitButton();
  showNotification('已退出全屏，恢复锁定状态', 'success');
}

function attachFullscreenHooks(doc) {
  if (!doc || doc.__pickerFsHooked) return;
  doc.__pickerFsHooked = true;
  doc.addEventListener('fullscreenchange', () => {
    const fs = doc.fullscreenElement;
    if (fs && isMediaEl(fs) && fs === lockedElement && currentState === 'd') {
      enterFullscreenState();
      try { fs.focus(); } catch (e) {}
    } else if (!fs && currentState === 'e') {
      restoreLockedState();
    }
  });
  doc.addEventListener('fullscreenerror', () => {
    showNotification('进入全屏失败', 'info');
  });
}

// ==================== 同源 iframe 事件桥 ====================
function frameHasOwnInstance(doc) {
  try {
    const w = doc.defaultView;
    return !!(w && w !== window && w.__PICKER_RUNNING);
  } catch (e) { return false; }
}

function collectFrameDocs(rootDoc = document, out = []) {
  let iframes = [];
  try { iframes = rootDoc.querySelectorAll('iframe'); } catch (e) { return out; }
  for (const fe of iframes) {
    try {
      const doc = fe.contentDocument;
      if (!doc || out.includes(doc)) continue;
      if (frameHasOwnInstance(doc)) continue;
      out.push(doc);
      collectFrameDocs(doc, out);
    } catch (e) {}
  }
  return out;
}

function bindFrameEvents() {
  for (const doc of collectFrameDocs()) {
    if (doc === document || doc.__pickerBound) continue;
    doc.__pickerBound = true;
    attachFullscreenHooks(doc);
    const dormant = () => frameHasOwnInstance(doc);
    doc.addEventListener('pointermove', (e) => {
      if (dormant()) return;
      if (e.isTrusted === false) return;
      if (currentState !== 'b') return;
      const p = toTopPoint(doc.documentElement, e.clientX, e.clientY);
      handleMouseMoveAt(p.x, p.y);
    }, true);
    doc.addEventListener('click', (e) => {
      if (dormant()) return;
      if (e.isTrusted === false) return;
      if (currentState === 'd') {
        if (lockedElement && e.composedPath().includes(lockedElement)) return;
        const fsDoc = ownerDocOf(lockedElement);
        if (fsDoc && fsDoc.fullscreenElement) return;
        e.preventDefault();
        e.stopPropagation();
        showNotification('锁定状态，请按Numpad0解锁或ESC退出', 'info');
        return;
      }
      if (currentState === 'b' && previewElement) {
        e.preventDefault();
        e.stopPropagation();
        lockCurrentElement('mouse');
      }
    }, true);
    doc.addEventListener('wheel', (e) => {
      if (dormant()) return;
      if (e.isTrusted === false) return;
      handleWheel(e);
      e.preventDefault();
    }, { capture: true, passive: false });
    doc.addEventListener('keydown', (e) => {
      if (dormant()) return;
      handleKeyDown(e);
    }, true);
    if (doc.defaultView) {
      doc.defaultView.addEventListener('scroll', (e) => {
        if (dormant()) return;
        handleScrollResize();
      }, { capture: true, passive: true });
      doc.defaultView.addEventListener('resize', (e) => {
        if (dormant()) return;
        handleScrollResize();
      }, { passive: true });
    }
  }
}

function initFrameBridge() {
  const hookFrame = (fe) => {
    if (fe.__pickerLoadHooked) return;
    fe.__pickerLoadHooked = true;
    fe.addEventListener('load', () => { bindFrameEvents(); });
  };
  const hookAll = (rootDoc) => {
    try { rootDoc.querySelectorAll('iframe').forEach(hookFrame); } catch (e) {}
  };
  hookAll(document);
  bindFrameEvents();
  new MutationObserver(() => {
    hookAll(document);
    bindFrameEvents();
  }).observe(document.documentElement, { childList: true, subtree: true });
}

// ==================== 祖先链 ====================
function getAncestorChain(element, isLocked = false) {
  if (!element) return '';
  const path = getFullPath(element);
  const curEl = path[0];
  let href = location.href.replace(/^https?:\/\//, '');
  try {
    const win = curEl.ownerDocument && curEl.ownerDocument.defaultView;
    if (win && win.location) href = win.location.href.replace(/^https?:\/\//, '');
  } catch (e) {}
  const sel = generateSelector(curEl) || generateSelector2(curEl) || curEl.tagName.toLowerCase();
  const tpl = `@match ${href} {\n  ${sel} {\n    \n  }\n}`;
  let html = '<div style="margin: 12px 0; background: #2d3748; padding: 10px; border-radius: 6px;">';
  html += `<div class="copy-btn" data-copy="${escapeHtmlAttr(tpl)}" style="color: #94a3b8; margin-bottom: 6px; font-weight: 500; cursor: pointer;" title="点击复制样式模板">📋 祖先链 (共${path.length}级):</div>`;
  for (let i = 0; i < path.length; i++) {
    const el = path[i];
    const tag = el.tagName ? el.tagName.toLowerCase() : 'unknown';
    const id = el.id ? `#${el.id}` : '';
    let classText = '';
    if (el.classList && el.classList.length > 0) {
      classText = '.' + Array.from(el.classList).slice(0, 2).join('.');
      if (el.classList.length > 3) classText += '…';
    }
    const shadowDepth = getShadowDepth(el);
    const isInShadow = shadowDepth > 0;
    const bgColor = i === 0 ? '#3b82f6' : `rgba(55, 65, 81, ${1 - i * 0.1})`;
    const shadowMark = isInShadow ? '⚡'.repeat(shadowDepth) + ' ' : '';
    const isFrameBoundary = el.tagName === 'IFRAME' && i > 0;
    const frameMark = isFrameBoundary ? FRAME_MARK + ' ' : '';
    const hasKids = getDomChildren(el).length > 0;
    const toggleHtml = (isLocked && hasKids) ? `<span class="anc-toggle" data-anc="${i}" style="color:#62b5ff;cursor:pointer;user-select:none;flex-shrink:0;width:14px;text-align:center;font-size:11px;" title="展开/收起该元素的后代">▸</span>` : `<span style="flex-shrink:0;width:14px;"></span>`;
    html += `<div style="padding: 5px 10px; margin: 3px 0; background: ${bgColor}; border-radius: 4px; font-size: 11px; display: flex; align-items: center; gap: 8px; border-left: 2px solid ${i === 0 ? '#fbbf24' : '#4b5563'};">
      ${toggleHtml}
      <span style="color: #94a3b8; min-width: 24px;">${i + 1}.</span>
      <span class="copy-btn" data-copy="${escapeHtmlAttr(tag + id + classText)}" style="color: ${i === 0 ? 'white' : '#fbbf24'}; word-break: break-all; flex: 1; cursor: pointer;" title="点击复制selector">
        ${frameMark}${shadowMark}${tag}${id}${classText}
      </span>
      ${i === 0 ? '<span style="color: #fbbf24; font-size: 10px;">当前元素</span>' : ''}
      ${isFrameBoundary ? `<span style="color: #5eead4; font-size: 9px;">${FRAME_MARK} 跨frame</span>` : ''}
      ${isInShadow ? `<span style="color: #a5b4fc; font-size: 10px;">Shadow深度:${shadowDepth}</span>` : ''}
    </div>`;
    if (isLocked && hasKids) {
      html += `<div class="anc-desc" data-anc-panel="${i}" style="display:none;margin:2px 0 6px 10px; background:#1a2332;border:1px solid #334155;border-radius:4px;padding:4px 6px; max-height:220px;overflow-y:auto;font-size:10px;"></div>`;
    }
  }
  html += '</div>';
  return html;
}

// ===== 后代展开面板 =====
const panelRegistries = new WeakMap();
let descUidCounter = 0;

function getDomChildren(el) {
  const kids = Array.from(el.children || []);
  try { if (el.shadowRoot) kids.push(...el.shadowRoot.children); } catch (e) {}
  return kids;
}

const DESC_MAX_DEPTH = 4;
const DESC_MAX_NODES = 500;

function buildDescendantsHtml(el, depth, counter, registry) {
  if (!el || depth > DESC_MAX_DEPTH || counter.n > DESC_MAX_NODES) return '';
  let html = '';
  for (const child of getDomChildren(el)) {
    if (counter.n >= DESC_MAX_NODES) {
      html += `<div style="color:#f59e0b;padding:2px 0 2px ${(depth + 1) * 14}px;">…(节点过多，已截断)</div>`;
      break;
    }
    counter.n++;
    const uid = 'd' + (descUidCounter++);
    registry.set(uid, child);
    const tag = child.tagName ? child.tagName.toLowerCase() : '?';
    const id = child.id ? '#' + child.id : '';
    let cls = '';
    if (child.classList && child.classList.length > 0) {
      cls = '.' + Array.from(child.classList).slice(0, 2).join('.');
      if (child.classList.length > 2) cls += '…';
    }
    const shadowMark = child.shadowRoot ? '⚡' : '';
    const frameMark = child.tagName === 'IFRAME' && child.contentDocument ? FRAME_MARK_HTML : '';
    const textHint = (child.innerText || '').trim().substring(0, 12);
    html += `<div class="desc-node" data-uid="${uid}" style="padding:2px 4px 2px ${depth * 14 + 6}px;cursor:pointer;border-radius:3px;color:#a5d6ff; white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" onmouseover="this.style.background='#334155'" onmouseout="this.style.background=''" title="点击跳转到该元素">
      ${frameMark}${shadowMark}<span style="color:#fbbf24;">${tag}</span>${id}${cls}${textHint ? ` <span style="color:#6b7280;">「${escapeHtml(textHint)}…」</span>` : ''}
    </div>`;
    if (getDomChildren(child).length > 0) {
      html += buildDescendantsHtml(child, depth + 1, counter, registry);
    }
  }
  return html;
}

function renderDescendantsTree(rootEl, panel) {
  const registry = new Map();
  panelRegistries.set(panel, registry);
  descUidCounter = 0;
  const counter = { n: 0 };
  let html = buildDescendantsHtml(rootEl, 0, counter, registry);
  if (!html) html = '<div style="color:#6b7280;padding:2px 6px;">（无后代元素）</div>';
  return html;
}

function bindDescendantClicks(panel) {
  const registry = panelRegistries.get(panel) || new Map();
  panel.querySelectorAll('.desc-node').forEach(node => {
    node.addEventListener('pointerdown', ev => ev.stopPropagation());
    node.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const target = registry.get(node.dataset.uid);
      if (target && target.isConnected) {
        jumpToDescendant(target);
      } else {
        showNotification('该元素已不存在于文档中', 'info');
      }
    });
  });
}

function jumpToDescendant(target) {
  if (!target || !target.isConnected) {
    showNotification('该元素已不存在于文档中', 'info');
    return;
  }
  if (target === lockedElement) return;
  const path = getFullPath(target);
  for (let i = 1; i < path.length; i++) {
    navMemory.set(path[i], path[i - 1]);
  }
  showNotification('已跳转到目标元素', 'success');
  switchToLockedElement(target);
}

// ==================== 元素信息提取 ====================
const SELECTOR_CONFIG = { maxClasses: 1 };

function generateSelector(el, config = SELECTOR_CONFIG) {
  if (!el) return '';
  try {
    const tag = el.tagName.toLowerCase();
    const classCount = Math.max(0, config.maxClasses);
    if (el.id && el.classList && el.classList.length > 0) {
      return `${tag}#${el.id}` + Array.from(el.classList)
        .slice(0, classCount).map(c => `.${CSS.escape ? CSS.escape(c) : c}`).join('');
    }
    if (el.id) return `#${el.id}`;
    if (el.classList && el.classList.length > 0) {
      return tag + Array.from(el.classList)
        .slice(0, classCount).map(c => `.${CSS.escape ? CSS.escape(c) : c}`).join('');
    }
    return generateSelector2(el);
  } catch (e) { return ''; }
}

function generateSelector2(el) {
  if (!isElementNode(el)) return '';
  const scopeDoc = ownerDocOf(el);
  const ok = (root, sel, t) => {
    try {
      const h = root.querySelectorAll(sel);
      return h.length === 1 && h[0] === t;
    } catch (e) { return false; }
  };
  if (el.id && ok(scopeDoc, `#${CSS.escape(el.id)}`, el)) return `#${CSS.escape(el.id)}`;
  const parts = [];
  let cur = el;
  while (isElementNode(cur)) {
    const seg = cur.tagName === 'HTML' ? ':root' : cur.tagName.toLowerCase() + (cur.classList[0] ? '.' + CSS.escape(cur.classList[0]) : '');
    const same = cur.parentElement ? Array.from(cur.parentElement.children).filter(c => c.tagName === cur.tagName) : [];
    if (same.length > 1) parts.unshift(`${seg}:nth-of-type(${same.indexOf(cur) + 1})`);
    else parts.unshift(seg);
    const full = parts.join(' > ');
    if (ok(scopeDoc, full, el)) return full;
    let up = cur.parentElement;
    if (!up) {
      try {
        const win = cur.ownerDocument && cur.ownerDocument.defaultView;
        if (win && win !== window && isElementNode(win.frameElement)) {
          parts.unshift(win.frameElement.tagName.toLowerCase());
          parts.push('>>');
          cur = win.frameElement;
          continue;
        }
      } catch (e) {}
      const root = cur.getRootNode();
      if (!isShadowRoot(root)) break;
      parts.unshift(root.host.tagName.toLowerCase());
      parts.push('>>');
      cur = root.host;
      continue;
    }
    cur = up;
  }
  return ok(scopeDoc, parts.join(' > '), el) ? parts.join(' > ') : '';
}

function generateXPath(el) {
  if (!el) return '';
  try {
    if (el.id) return `//*[@id="${el.id}"]`;
    const parts = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      if (current.id) {
        parts.unshift(`//*[@id="${current.id}"]`);
        break;
      }
      let part = current.tagName.toLowerCase();
      if (current.parentElement) {
        const siblings = Array.from(current.parentElement.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          part += `[${siblings.indexOf(current) + 1}]`;
        }
      }
      parts.unshift(part);
      if (!current.parentElement) {
        try {
          const win = current.ownerDocument && current.ownerDocument.defaultView;
          if (win && win !== window && win.frameElement) {
            parts.unshift('iframe');
            current = win.frameElement;
            continue;
          }
        } catch (e) {}
      }
      current = current.parentElement;
    }
    if (parts[0] && parts[0].startsWith('//')) return parts.join('/');
    else return '/' + parts.join('/');
  } catch (e) { return ''; }
}

function getElementInfo(el) {
  if (!el) return { tag: 'unknown' };
  try {
    const tag = el.tagName ? el.tagName.toLowerCase() : 'unknown';
    const id = el.id ? `#${el.id}` : '';
    let classList = [];
    if (el.classList && el.classList.length > 0) classList = Array.from(el.classList);
    const attributes = [];
    if (el.attributes) {
      for (let attr of el.attributes) attributes.push({ name: attr.name, value: attr.value });
    }
    const shadowDepth = getShadowDepth(el);
    const isInShadow = shadowDepth > 0;
    const inFrame = isInChildFrame(el);
    let displayName = tag;
    if (id) displayName += id;
    if (classList.length > 0) {
      const shortClasses = classList.slice(0, 2).map(c => `.${c}`).join('');
      displayName += shortClasses;
      if (classList.length > 2) displayName += ` +${classList.length - 2}`;
    }
    if (inFrame) displayName = FRAME_MARK + ' ' + displayName;
    if (isInShadow) displayName = '⚡'.repeat(shadowDepth) + ' ' + displayName;
    return {
      tag, id, classList, attributes, displayName, isInShadow, shadowDepth, inFrame,
      innerText: el.innerText ? el.innerText.substring(0, 500) : '',
      childCount: el.children ? el.children.length : 0,
      cssSelector: generateSelector(el) + '\n\n' + generateSelector2(el),
      xpath: generateXPath(el),
      siblingPos: getSiblingPosition(el),
      element: el
    };
  } catch (e) {
    return { tag: 'error', displayName: '获取信息失败' };
  }
}

// ==================== 控制台输出 ====================
function logElementInfo(el, type = 'locked') {
  if (!el) return;
  const info = getElementInfo(el);
  const prefix = type === 'locked' ? '🔒 已锁定元素' : '📍 定位元素';
  console.log(`%c${prefix}:`, 'background: #3b82f6; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;', el);
  if (info.id) console.log(`%c📋 ID: ${info.id}`, 'color: #94a3b8;');
  if (info.classList.length > 0) console.log(`%c📋 类名: ${info.classList.join(' ')}`, 'color: #94a3b8;');
  if (info.inFrame) console.log(`%c${FRAME_MARK} 位于同源 iframe 内`, 'color: #a24811;');
  if (info.isInShadow) console.log(`%c⚡ 位于 Shadow DOM 中 (深度: ${info.shadowDepth})`, 'color: #fbbf24;');
  if (info.cssSelector) console.log(`%c🔧 CSS选择器: ${info.cssSelector}`, 'color: #0c8a60;');
  if (info.xpath) console.log(`%c🔧 XPath: ${info.xpath}`, 'color: #0c8a60;');
}

// ==================== 统一的锁定/解锁入口 ====================
let highlightTimer = null;

function lockCurrentElement(source = 'keyboard') {
  if (currentState !== 'b' || !previewElement) {
    showNotification('没有可锁定的元素', 'info');
    return false;
  }
  console.log(`🔒 锁定元素 (来源: ${source})`);
  lockedElement = previewElement;
  lockedInfo = getElementInfo(lockedElement);
  lockedPath = getFullPath(lockedElement);
  lockedIndex = lockedPath.indexOf(lockedElement);
  if (lockedIndex === -1) lockedIndex = 0;
  currentState = 'd';
  window.__ELEMENT_PICKER_STATE = 'd';
  window.__ELEMENT_PICKER_ACTIVE = true;
  tooltip.classList.remove('mode-preview');
  logElementInfo(lockedElement, 'locked');
  window.rawRemove.call(document, 'pointermove', handleMouseMove, true);
  document.removeEventListener('wheel', handleWheel, { passive: false });
  updateOverlay(lockedElement);
  let rect = lockedElement.getBoundingClientRect();
  updateTooltip(lockedElement, lockedIndex, lockedPath.length, rect.right, rect.top, true);
  updateExitButton();
  showNotification('已锁定 - 使用Numpad0解锁，ESC退出', 'success');
  let event = new CustomEvent('element-picker-state-change', { detail: { state: 'locked', source: source } });
  document.dispatchEvent(event);
  setTimeout(() => {
    if (currentState === 'd' && lockedElement) {
      const activeElement = document.activeElement;
      const isFocusInLockedElement = lockedElement.contains(activeElement) || (shadowHost && shadowHost.contains(activeElement));
      if (!isFocusInLockedElement) {
        try {
          const focusableElements = ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'A'];
          if (focusableElements.includes(lockedElement.tagName) || lockedElement.hasAttribute('tabindex') || lockedElement.isContentEditable) {
            lockedElement.focus();
          } else {
            const focusableChild = lockedElement.querySelector(
              'input, textarea, button, select, a, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]');
            if (focusableChild) focusableChild.focus();
            else {
              lockedElement.setAttribute('tabindex', '-1');
              lockedElement.focus();
            }
          }
          if (1)(function () {
            if (highlightTimer) clearTimeout(highlightTimer);
            const el = lockedElement;
            el.style.outline = '2px solid #10b981';
            el.style.outlineOffset = '2px';
            highlightTimer = setTimeout(() => {
              el.style.removeProperty('outline');
              el.style.removeProperty('outline-offset');
              highlightTimer = null;
            }, 1000);
          })();
        } catch (e) { console.warn('自动聚焦失败:', e); }
      }
    }
  }, 500);
  return true;
}

function unlockCurrentElement(source = 'keyboard') {
  if (currentState !== 'd' || !lockedElement) {
    showNotification('没有锁定的元素', 'info');
    return false;
  }
  console.log(`🔓 解锁元素 (来源: ${source})`);
  if (AUTO_RESTORE) restoreAllEditedStyles();
  lockedElement = null;
  lockedInfo = null;
  lockedPath = [];
  lockedIndex = 0;
  currentState = 'b';
  window.__ELEMENT_PICKER_STATE = 'b';
  window.__ELEMENT_PICKER_ACTIVE = true;
  tooltip.classList.add('mode-preview');
  window.rawAdd.call(document, 'pointermove', handleMouseMove, true);
  document.addEventListener('wheel', handleWheel, { passive: false });
  if (previewElement) {
    updateOverlay(previewElement);
    updateTooltip(previewElement, previewIndex, previewPath.length, lastMouseX, lastMouseY, false);
  } else {
    overlay.style.display = 'none';
    tooltip.style.display = 'none';
    cleanupVideoPanel();
  }
  updateExitButton();
  showNotification('返回选择模式', 'info');
  let event = new CustomEvent('element-picker-state-change', { detail: { state: 'preview', source: source } });
  document.dispatchEvent(event);
  return true;
}

// ==================== 退出处理 ====================
function handleExit() {
  if (currentState === 'e') {
    exitAnyFullscreen();
    unlockCurrentElement('exit');
  } else if (currentState === 'd') {
    unlockCurrentElement('exit');
  } else if (currentState === 'b') {
    exitSelectMode();
  }
  updateExitButton();
}

function updateExitButton() {
  if (!exitButton) return;
  exitButton.style.display = (currentState === 'b' || currentState === 'd') ? 'flex' : 'none';
}

function generateAdGuardRules(attr, el) {
  let rules = [];
  let host = window.location.hostname;
  try {
    const win = el && el.ownerDocument && el.ownerDocument.defaultView;
    if (win && win.location && win.location.hostname) host = win.location.hostname;
  } catch (e) {}
  let name = attr.name;
  let value = attr.value;
  if (!name || !value) return rules;
  switch (name) {
    case 'class':
      if (value) {
        let classes = value.split(/\s+/);
        classes.forEach(cls => {
          if (cls.trim()) rules.push({ rule: `${host}##.${cls}`, desc: `类名选择器: .${cls}` });
        });
        rules.push({ rule: `${host}##[class="${value}"]`, desc: `精确类名匹配: [class="${value}"]` });
        if (classes[0]) {
          rules.push({ rule: `${host}##[class*="${classes[0]}"]`, desc: `模糊类名匹配: [class*="${classes[0]}"]` });
        }
      }
      break;
    case 'id':
      rules.push({ rule: `${host}##${value.startsWith('#') ? value : '#' + value}`, desc: `ID选择器: ${value.startsWith('#') ? value : '#' + value}` });
      break;
    case 'href':
    case 'src':
      if (value) {
        let ext = value.split('.').pop();
        if (ext && ext.length < 10) {
          rules.push({ rule: `${host}##[${name}$=".${ext}"]`, desc: `${name}后缀匹配: [${name}$=".${ext}"]` });
        }
        let prefix = value.substring(0, Math.min(20, value.length));
        rules.push({ rule: `${host}##[${name}^="${prefix}"]`, desc: `${name}开头匹配: [${name}^="..."]` });
      }
      break;
    default:
      if (name.startsWith('data-')) {
        rules.push({ rule: `${host}##[${name}="${value}"]`, desc: `数据属性: [${name}="${value}"]` });
      } else {
        rules.push({ rule: `${host}##[${name}="${value}"]`, desc: `属性选择器: [${name}="${value}"]` });
      }
  }
  return rules;
}

function injectCopyScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injectclipboard.js');
  script.onload = function () { this.remove(); };
  document.documentElement.appendChild(script);
}
injectCopyScript();

// ==================== 悬浮窗更新 ====================
function updateTooltip(el, index, total, mouseX, mouseY, isLocked) {
  if (!el) return;
  cleanupVideoPanel();
  const info = getElementInfo(el);

  let attrsHtml = '<div style="max-height: 150px; overflow-y: auto; pointer-events: auto; margin: 8px 0; background: #2d3748; padding: 8px; border-radius: 4px;">';
  if (info.attributes.length > 0) {
    info.attributes.slice(0, 10).forEach(attr => {
      let value = attr.value;
      if (value.length > 200) value = value.substring(0, 200) + '...';
      let adgRules = generateAdGuardRules(attr, el);
      attrsHtml += `<div style="margin-bottom: 6px; font-size: 11px; word-break: break-all; border-bottom: 1px solid #4a5568; padding-bottom: 4px;">
        <div style="margin-bottom: 2px;">
          <span style="color: #94a3b8;">${attr.name}:</span>
          <span style="color: #fbbf24;">${escapeHtml(value)}</span>
        </div>`;
      if (adgRules.length > 0) {
        attrsHtml += '<div style="margin-left: 12px; margin-top: 4px;">';
        adgRules.forEach(rule => {
          attrsHtml += `
            <div style="display: flex; align-items: center; margin-bottom: 3px; font-family: monospace; font-size: 10px; background: #1e293b; padding: 2px 4px; border-radius: 3px;">
              <span class="copy-btn" data-copy="${escapeHtmlAttr(rule.rule)}" style="color: #a5d6ff; flex: 1; cursor: pointer;" title="点击复制规则">${rule.rule}</span>
              <span style="color: #94a3b8; font-size: 9px; margin: 0 4px;">${rule.desc}</span>
            </div>`;
        });
        attrsHtml += '</div>';
      }
      attrsHtml += '</div>';
    });
  } else {
    attrsHtml += '<div style="color: #94a3b8;">无属性</div>';
  }
  attrsHtml += '</div>';

  let shadowHtml = '';
  if (info.isInShadow) {
    shadowHtml = `<div style="background: #312e81; color: #a5b4fc; padding: 6px 8px; border-radius: 4px; margin: 8px 0; font-size: 11px;">
      ⚡ 位于 Shadow DOM 中 (深度: ${info.shadowDepth})
    </div>`;
  }

  let frameHtml = '';
  if (info.inFrame) {
    frameHtml = `<div style="background: #134e4a; color: #5eead4; padding: 4px 8px; border-radius: 4px; margin: 8px 0; font-size: 10px;">
      ${FRAME_MARK} 位于同源 iframe 内（顶层实例跨frame操控）
    </div>`;
  }

  let elHref = '';
  try {
    const d = ownerDocOf(el);
    elHref = d.location ? d.location.href : window.location.href;
  } catch (e) { elHref = window.location.href; }

  // 🔑 [v9.6.5] 四向导航按钮样式（上下=父子，左右=兄弟）
  const navBtnStyle = `background:#4b5563;color:#fff;border:none;border-radius:3px;min-width:24px;height:20px;font-size:10px;cursor:pointer;line-height:1;padding:0 4px;flex-shrink:0;pointer-events:auto;`;

  tooltip.innerHTML = `
    <div id="tooltip-header" style="padding: 10px 12px; cursor: move; background: #0f172a; border-bottom: 1px solid #334155; user-select: none; touch-action: none;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="color: ${isLocked ? '#10b981' : '#3b82f6'}; font-weight: 600; font-size: 13px;">${info.displayName}</span>
          <span style="background: #374151; padding: 2px 6px; border-radius: 12px; font-size: 10px;">${info.siblingPos.index}/${info.siblingPos.total}</span>
        </div>
        <span style="background: #374151; padding: 2px 8px; border-radius: 12px; font-size: 10px;">${index + 1}/${total}</span>
      </div>
    </div>
    <div style="padding: 12px; height: calc(100% - 80px); overflow-y: auto; pointer-events: auto;">
      ${frameHtml}
      ${shadowHtml}
      <div style="background: #2d3748; padding: 8px; border-radius: 4px; margin: 8px 0;">
        <div style="display:flex;align-items:stretch;gap:8px;">
          <div style="flex:1;min-width:0;">
            <div><span style="color: #94a3b8;">标签:</span> <span style="color: #fbbf24;">${info.tag}</span></div>
            ${info.id ? `<div><span style="color: #94a3b8;">ID:</span> <span style="color: #fbbf24;">${info.id}</span></div>` : ''}
            <div><span style="color: #94a3b8;">类名数量:</span> <span style="color: #fbbf24;">${info.classList.length}</span></div>
            <div><span style="color: #94a3b8;">子元素数:</span> <span style="color: #fbbf24;">${info.childCount}</span></div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;flex-shrink:0;">
            <button class="nav-arrow" data-nav="parent" title="父元素 (快捷键 +)" style="${navBtnStyle}">▲</button>
            <div style="display:flex;gap:2px;">
              <button class="nav-arrow" data-nav="prev" title="上一个同级 (快捷键 /)" style="${navBtnStyle}">◀</button>
              <button class="nav-arrow" data-nav="child" title="子元素 (快捷键 -)" style="${navBtnStyle}">▼</button>
              <button class="nav-arrow" data-nav="next" title="下一个同级 (快捷键 *)" style="${navBtnStyle}">▶</button>
            </div>
          </div>
        </div>
        <div style="margin-top:4px;"><span style="color: #94a3b8;">所在网址:</span> <span class="copy-btn" data-copy="${escapeHtmlAttr(elHref)}" title="点击复制网址" style="color: #fbbf24;word-break: break-all;cursor:pointer;">${escapeHtml(elHref)}</span></div>
      </div>
      <div style="margin: 8px 0;">
        <div style="color: #94a3b8; margin-bottom: 4px;">属性列表:</div>
        ${attrsHtml}
      </div>
      ${info.innerText ? `
      <div style="margin: 8px 0; background: #2d3748; padding: 8px; border-radius: 4px;">
        <div style="color: #94a3b8; margin-bottom: 4px;">文本内容:</div>
        <div style="color: #9ca3af; max-height: 60px; overflow-y: auto; pointer-events: auto; font-size: 11px;">${escapeHtml(info.innerText)}</div>
      </div>` : ''}
      ${getAncestorChain(el, isLocked)}
      ${renderStylePanel(el, isLocked)}
      ${renderVideoPanel(el, isLocked)}
      ${info.cssSelector ? `
      <div style="background: #2d3748; padding: 8px; border-radius: 4px; margin: 8px 0;">
        <div style="color: #94a3b8; margin-bottom: 4px;">CSS选择器:</div>
        <div style="color: #fbbf24; font-size: 11px; word-break: break-all;white-space: pre-wrap;">${escapeHtml(info.cssSelector)}</div>
      </div>` : ''}
      ${info.xpath ? `
      <div style="background: #2d3748; padding: 8px; border-radius: 4px; margin: 8px 0;">
        <div style="color: #94a3b8; margin-bottom: 4px;">XPath:</div>
        <div style="color: #fbbf24; font-size: 11px; word-break: break-all;">${escapeHtml(info.xpath)}</div>
      </div>` : ''}
      <div style="display: flex; gap: 8px; margin-top: 12px;">
        <button id="picker-locate" style="flex:1; background:#3b82f6; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-size:12px; font-weight:500;">📍 存为 window.el0</button>
      </div>
      <div style="margin-top: 8px; font-size: 10px; color: #6b7280; text-align: center; background: #2d3748; padding: 6px; border-radius: 4px;">
        <div><kbd>+</kbd> 祖先 · <kbd>-</kbd> 后代</div>
        <div><kbd>/</kbd> 上一个同级 · <kbd>*</kbd> 下一个同级</div>
        <div><kbd>Numpad0</kbd> 锁定/解锁</div>
        <div><kbd>ESC</kbd> 或 <kbd>\`</kbd> 退出（输入框内按键不触发）</div>
        ${info.inFrame ? `<div style="color: #5eead4;">${FRAME_MARK} 同源iframe内</div>` : ''}
        ${info.isInShadow ? '<div style="color: #a5b4fc;">⚡ Shadow深度: ' + info.shadowDepth + '</div>' : ''}
      </div>
    </div>
  `;

  setTimeout(() => {
    const locateBtnInShadow = tooltip.querySelector('#picker-locate');
    const header = tooltip.querySelector('#tooltip-header');
    if (locateBtnInShadow) {
      locateBtnInShadow.onclick = (e) => {
        e.stopPropagation();
        el.dispatchEvent(new CustomEvent('__picker-store-el0', { bubbles: true, composed: true }));
      };
    }
    if (header) {
      window.rawAdd.call(header, 'pointerdown', startDrag, true);
    }
    initResizeHandles();

    // ===== 🔑 [v9.6.5] 四向导航按钮绑定（点击等效快捷键 + - / *） =====
    tooltip.querySelectorAll('.nav-arrow').forEach(btn => {
      btn.addEventListener('pointerdown', ev => ev.stopPropagation());
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        navigateRelative(btn.dataset.nav);
      });
    });

    // ===== 样式热编辑绑定 =====
    const stylePanel = tooltip.querySelector('#style-panel');
    if (stylePanel) {
      const updateCondHints = () => {
        stylePanel.querySelectorAll('.style-cond-hint').forEach(hint => {
          const prop = hint.dataset.prop;
          const cond = checkStyleCondition(el, prop);
          if (cond && cond.ok === false) {
            hint.style.display = '';
            hint.textContent = cond.hint;
          } else {
            hint.style.display = 'none';
          }
        });
      };
      const applyChange = (prop, value) => {
        try {
          applyStyleValue(el, prop, value);
          const sizeSpan = stylePanel.querySelector('#style-live-size');
          if (sizeSpan) sizeSpan.textContent = `${Math.round(el.offsetWidth)} × ${Math.round(el.offsetHeight)}`;
          refreshStylePanelInputs(stylePanel, el);
          const label = stylePanel.querySelector(`.style-label[data-prop="${prop}"]`);
          if (label) {
            let cur = el.style.getPropertyValue(prop).trim();
            if (!cur) {
              try { cur = getComputedStyle(el).getPropertyValue(prop).trim(); } catch (e) { cur = ''; }
            }
            label.dataset.copy = buildRelatedCopy(el, prop, cur);
          }
          updateCondHints();
        } catch (err) {
          console.error('[Picker] applyChange 异常:', err);
        }
      };

      stylePanel.querySelectorAll('.style-input').forEach(input => {
        const prop = input.dataset.prop;
        input.addEventListener('input', (ev) => {
          ev.stopPropagation();
          applyChange(prop, normalizeStyleValue(prop, input.value.trim()));
        });
        input.addEventListener('pointerdown', ev => ev.stopPropagation());
        input.addEventListener('click', ev => ev.stopPropagation());
        input.addEventListener('keydown', (ev) => {
          if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
          ev.preventDefault();
          ev.stopPropagation();
          const raw = input.value.trim() || (NEED_UNIT_PROPS.includes(prop) ? '0px' : '0');
          const direction = ev.key === 'ArrowUp' ? 1 : -1;
          const next = nudgeStyleProp(prop, raw, direction, ev.shiftKey, ev.altKey);
          if (next === null) {
            showNotification(`"${raw}" 不是可微调的数值（支持 12px / 50% / 1.5 这类格式）`, 'info');
            return;
          }
          input.value = next;
          applyChange(prop, next);
        });
      });

      stylePanel.querySelectorAll('.style-enum').forEach(sel => {
        const prop = sel.dataset.prop;
        sel.addEventListener('change', (ev) => {
          ev.stopPropagation();
          if (sel.value === '') {
            const input = stylePanel.querySelector(`.style-input[data-prop="${prop}"]`);
            if (input) input.focus();
            return;
          }
          const input = stylePanel.querySelector(`.style-input[data-prop="${prop}"]`);
          if (input) input.value = sel.value;
          applyChange(prop, sel.value);
        });
        sel.addEventListener('pointerdown', ev => ev.stopPropagation());
      });

      stylePanel.querySelectorAll('.style-color').forEach(cinput => {
        const prop = cinput.dataset.prop;
        cinput.addEventListener('input', (ev) => {
          ev.stopPropagation();
          applyChange(prop, cinput.value);
          const t = stylePanel.querySelector(`.style-input[data-prop="${prop}"]`);
          if (t) t.value = cinput.value;
        });
        cinput.addEventListener('pointerdown', ev => ev.stopPropagation());
      });

      const fontSel = stylePanel.querySelector('.font-select');
      if (fontSel) {
        fontSel.addEventListener('change', (ev) => {
          ev.stopPropagation();
          if (!fontSel.value) return;
          const v = `'${fontSel.value}'`;
          const input = stylePanel.querySelector('.style-input[data-prop="font-family"]');
          if (input) input.value = v;
          applyChange('font-family', v);
        });
        fontSel.addEventListener('pointerdown', ev => ev.stopPropagation());
      }

      const scanBtn = stylePanel.querySelector('.font-scan');
      if (scanBtn) scanBtn.onclick = (ev) => { ev.stopPropagation(); scanLocalFonts(stylePanel, el); };

      const fileInput = stylePanel.querySelector('.font-file');
      const importBtn = stylePanel.querySelector('.font-import');
      if (importBtn) importBtn.onclick = (ev) => { ev.stopPropagation(); if (fileInput) fileInput.click(); };
      if (fileInput) fileInput.addEventListener('change', (ev) => {
        ev.stopPropagation();
        importFontFile(fileInput.files[0], stylePanel, el);
        fileInput.value = '';
      });

      const resetBtn = stylePanel.querySelector('#style-reset');
      if (resetBtn) resetBtn.onclick = (ev) => { ev.stopPropagation(); resetElementStyles(el); };

      // ===== 🔑 [v9.6.4] 渐变编辑器绑定（事件委托） =====
      const gradEditor = stylePanel.querySelector('.grad-editor');
      if (gradEditor) {
        const gradApply = () => {
          if (currentState === 'd' && el === lockedElement) applyGradientFromEditor(gradEditor, el);
        };
        const onGradInput = (ev) => {
          const t = ev.target;
          if (!(t instanceof Element)) return;
          const isGradCtrl = t.classList.contains('grad-dir') || t.classList.contains('grad-stop-color') ||
            t.classList.contains('grad-stop-hex') || t.classList.contains('grad-stop-pos') ||
            t.classList.contains('grad-preset');
          if (!isGradCtrl) return;
          ev.stopPropagation();
          if (t.classList.contains('grad-preset') && !t.value) return;
          // 颜色代码框 ↔ 取色块 双向同步
          if (t.classList.contains('grad-stop-color')) {
            const codeInput = t.closest('.grad-stop')?.querySelector('.grad-stop-hex');
            if (codeInput) codeInput.value = t.value;
          } else if (t.classList.contains('grad-stop-hex')) {
            const ci = t.closest('.grad-stop')?.querySelector('.grad-stop-color');
            if (ci) ci.value = colorToHex(t.value);
          } else if (!t.classList.contains('grad-preset')) {
            const ps = gradEditor.querySelector('.grad-preset');
            if (ps && ps.value) ps.value = '';
          }
          gradApply();
        };
        gradEditor.addEventListener('input', onGradInput);
        gradEditor.addEventListener('change', onGradInput);
        gradEditor.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); });
        gradEditor.addEventListener('click', (ev) => {
          const t = ev.target;
          if (!(t instanceof Element)) return;
          if (t.closest('.copy-btn')) return;
          if (!t.matches('button')) return;
          ev.stopPropagation();
          if (currentState !== 'd' || el !== lockedElement) return;
          if (t.classList.contains('grad-del')) {
            if (gradEditor.querySelectorAll('.grad-stop').length <= 2) {
              showNotification('渐变至少需要 2 个颜色过渡点', 'info');
              return;
            }
            t.closest('.grad-stop').remove();
            gradApply();
          } else if (t.classList.contains('grad-add')) {
            const box = gradEditor.querySelector('.grad-stops-box');
            if (!box) return;
            const lastColor = box.querySelector('.grad-stop:last-of-type .grad-stop-color');
            const c = lastColor ? lastColor.value : '#3b82f6';
            const tmp = document.createElement('div');
            tmp.innerHTML = renderGradientStopRows(`${c}, ${c}`, '');
            box.insertBefore(tmp.firstElementChild, box.querySelector('.grad-add'));
            gradApply();
          } else if (t.classList.contains('grad-clear')) {
            const ps = gradEditor.querySelector('.grad-preset');
            if (ps) ps.value = '';
            applyStyleValue(el, 'background-image', '');
            syncGradCopyLabel(gradEditor, '');
          }
        });
      }
    }

    // ===== 视频/音频控制面板绑定 =====
    if (isMediaEl(el)) {
      bindVideoPanel(el, isLocked);
    }

    // ===== 祖先链后代展开面板绑定 =====
    const ancToggles = tooltip.querySelectorAll('.anc-toggle');
    if (ancToggles.length) {
      const ancPath = getFullPath(el);
      ancToggles.forEach(btn => {
        btn.addEventListener('pointerdown', ev => ev.stopPropagation());
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const idx = parseInt(btn.dataset.anc, 10);
          const ancEl = ancPath[idx];
          const panel = tooltip.querySelector(`.anc-desc[data-anc-panel="${idx}"]`);
          if (!ancEl || !panel) return;
          const isOpen = panel.style.display !== 'none';
          if (isOpen) {
            panel.style.display = 'none';
            btn.textContent = '▸';
          } else {
            if (!panel.dataset.rendered) {
              panel.innerHTML = renderDescendantsTree(ancEl, panel);
              panel.dataset.rendered = '1';
              bindDescendantClicks(panel);
            }
            panel.style.display = 'block';
            btn.textContent = '▾';
          }
        });
      });
    }
  }, 10);

  positionTooltip(mouseX, mouseY);
}

// 全量刷新面板输入框
function refreshStylePanelInputs(panel, el) {
  panel.querySelectorAll('.style-input').forEach(input => {
    if (document.activeElement === input) return;
    const prop = input.dataset.prop;
    const inline = el.style.getPropertyValue(prop).trim();
    let shown = inline;
    if (!shown) {
      try { shown = getComputedStyle(el).getPropertyValue(prop).trim(); } catch (e) {}
    }
    input.value = shown;
    const edited = !!inline;
    input.style.background = edited ? '#0f2b1e' : '#0f172a';
    input.style.color = edited ? '#34d399' : '#fbbf24';
    input.style.borderColor = edited ? '#10b981' : '#4b5563';
  });
}

function positionTooltip(mouseX, mouseY) {
  if (!tooltip) return;
  tooltip.style.display = 'block';
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  tooltip.style.visibility = 'hidden';
  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;
  tooltip.style.visibility = 'visible';
  let left = mouseX + 15;
  let top = mouseY + 15;
  if (left + width > vw) left = mouseX - width - 15;
  if (top + height > vh) top = mouseY - height - 15;
  left = Math.max(10, Math.min(left, vw - width - 10));
  top = Math.max(10, Math.min(top, vh - height - 10));
  tooltip.style.left = left + 'px';
  tooltip.style.top = top + 'px';
  lastViewportWidth = vw;
  lastViewportHeight = vh;
}

// ==================== 拖拽实现 ====================
function startDrag(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  isDragging = true;
  dragPointerId = e.pointerId;
  const rect = tooltip.getBoundingClientRect();
  dragOffsetX = e.clientX - rect.left;
  dragOffsetY = e.clientY - rect.top;
  try { e.target.setPointerCapture(dragPointerId); } catch (err) {}
  window.rawAdd.call(document, 'pointermove', onDrag, true);
  window.rawAdd.call(document, 'pointerup', stopDrag, true);
  window.rawAdd.call(document, 'pointercancel', stopDrag, true);
  e.stopPropagation();
}

function onDrag(e) {
  if (!isDragging || e.pointerId !== dragPointerId) return;
  e.preventDefault();
  let left = e.clientX - dragOffsetX;
  let top = e.clientY - dragOffsetY;
  left = Math.max(0, Math.min(left, window.innerWidth - tooltip.offsetWidth));
  top = Math.max(0, Math.min(top, window.innerHeight - tooltip.offsetHeight));
  tooltip.style.left = left + 'px';
  tooltip.style.top = top + 'px';
}

function stopDrag(e) {
  if (isDragging && e && e.pointerId === dragPointerId) {
    try { e.target.releasePointerCapture?.(dragPointerId); } catch (err) {}
  }
  isDragging = false;
  dragPointerId = null;
  window.rawRemove.call(document, 'pointermove', onDrag, true);
  window.rawRemove.call(document, 'pointerup', stopDrag, true);
  window.rawRemove.call(document, 'pointercancel', stopDrag, true);
  ensureTooltipInViewport();
}

function handleResize() {
  if (lastViewportWidth !== window.innerWidth || lastViewportHeight !== window.innerHeight) {
    lastViewportWidth = window.innerWidth;
    lastViewportHeight = window.innerHeight;
    if (tooltip.style.display === 'block') ensureTooltipInViewport();
  }
  handleScrollResize();
}

function ensureTooltipInViewport() {
  if (!tooltip || tooltip.style.display !== 'block') return;
  const rect = tooltip.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = rect.left;
  let top = rect.top;
  let changed = false;
  if (rect.right > vw) { left = vw - rect.width - 10; changed = true; }
  if (rect.bottom > vh) { top = vh - rect.height - 10; changed = true; }
  if (rect.left < 0) { left = 10; changed = true; }
  if (rect.top < 0) { top = 10; changed = true; }
  if (changed) {
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }
}

function handleScrollResize() {
  if (updateOverlayRaf) cancelAnimationFrame(updateOverlayRaf);
  updateOverlayRaf = requestAnimationFrame(() => {
    if (currentState === 'd' && lockedElement) {
      updateOverlay(lockedElement);
    }
  });
}

function updateOverlay(el) {
  if (!el) {
    overlay.style.display = 'none';
    return;
  }
  const r = isInChildFrame(el) ? rectInTop(el) : el.getBoundingClientRect();
  overlay.style.display = 'block';
  overlay.style.left = r.left + 'px';
  overlay.style.top = r.top + 'px';
  overlay.style.width = r.width + 'px';
  overlay.style.height = r.height + 'px';
  overlay.style.borderColor = (currentState === 'd' && el === lockedElement) ? '#10b981' : '#3b82f6';
  overlay.style.backgroundColor = (currentState === 'd' && el === lockedElement) ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)';
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== 状态转换 ====================
function enterSelectMode() {
  if (currentState !== 'a') return;
  currentState = 'b';
  window.__ELEMENT_PICKER_STATE = 'b';
  window.__ELEMENT_PICKER_ACTIVE = true;
  if (!overlay) createUI();
  tooltip.classList.add('mode-preview');
  window.rawAdd.call(document, 'pointermove', handleMouseMove, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('wheel', handleWheel, { passive: false });
  bindFrameEvents();
  updateExitButton();
  showNotification('选择模式 - 移动鼠标预览，点击或Numpad0锁定（同源iframe内可直接选中）', 'info');
  let event = new CustomEvent('element-picker-state-change', { detail: { state: 'preview', source: 'enter' } });
  document.dispatchEvent(event);
}

function exitSelectMode() {
  if (currentState !== 'b') return;
  currentState = 'a';
  window.__ELEMENT_PICKER_STATE = 'a';
  window.__ELEMENT_PICKER_ACTIVE = false;
  if (AUTO_RESTORE) restoreAllEditedStyles();
  tooltip.classList.remove('mode-preview');
  window.rawRemove.call(document, 'pointermove', handleMouseMove, true);
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('wheel', handleWheel, { passive: false });
  previewElement = null;
  resetNavMemory();
  cleanupVideoPanel();
  overlay.style.display = 'none';
  tooltip.style.display = 'none';
  updateExitButton();
  let event = new CustomEvent('element-picker-state-change', { detail: { state: 'inactive', source: 'exit' } });
  document.dispatchEvent(event);
}

// ==================== 事件处理 ====================
function handleMouseMoveAt(x, y) {
  lastMouseX = x;
  lastMouseY = y;
  const element = deepElementFromPoint(x, y);
  if (!element) return;
  if (element === shadowHost) return;
  if (element === previewElement) return;
  previewPath = getFullPath(element);
  previewIndex = 0;
  previewElement = previewPath[previewIndex];
  resetNavMemory();
  updateOverlay(previewElement);
  updateTooltip(previewElement, previewIndex, previewPath.length, x, y, false);
}

function handleMouseMove(e) {
  if (e.isTrusted === false) return;
  if (currentState !== 'b') return;
  handleMouseMoveAt(e.clientX, e.clientY);
}

function handleWheel(e) {
  if (e.isTrusted === false) return;
  if (currentState !== 'b' || !previewElement) return;
  if (e.deltaY < 0) {
    if (previewIndex < previewPath.length - 1) {
      previewIndex++;
      navMemory.set(previewPath[previewIndex], previewPath[previewIndex - 1]);
      previewElement = previewPath[previewIndex];
    }
  } else {
    if (previewIndex > 0) {
      previewIndex--;
      previewElement = previewPath[previewIndex];
    }
  }
  updateOverlay(previewElement);
  updateTooltip(previewElement, previewIndex, previewPath.length, lastMouseX, lastMouseY, false);
  e.preventDefault();
}

function handleClick(e) {
  if (e.isTrusted === false) return;
  const path = e.composedPath();
  if (path.includes(tooltip) || path.includes(exitButton)) return;
  if (currentState === 'd') {
    if (lockedElement && path.includes(lockedElement)) return;
    const fsDoc = ownerDocOf(lockedElement);
    if (fsDoc && fsDoc.fullscreenElement) return;
    e.preventDefault();
    e.stopPropagation();
    showNotification('锁定状态，请按Numpad0解锁或ESC退出', 'info');
    return;
  }
  if (currentState === 'b' && previewElement) {
    e.preventDefault();
    e.stopPropagation();
    lockCurrentElement('mouse');
  }
}

function handleKeyDown(e) {
  if (e.isTrusted === false) return;
  if (e.isComposing || e.keyCode === 229) return;

  // 全屏播放态 (e)
  if (currentState === 'e' && isMediaEl(lockedElement)) {
    if (e.key === 'Escape' || e.key === '`' || e.key === 'Backquote') return;
    const el = lockedElement;
    switch (true) {
      case e.code === 'Space':
        e.preventDefault(); e.stopPropagation();
        el.paused ? el.play().catch(() => {}) : el.pause();
        return;
      case e.key === 'ArrowLeft':
        e.preventDefault(); e.stopPropagation();
        applyVideoValue(el, 'currentTime', el.currentTime - 5);
        return;
      case e.key === 'ArrowRight':
        e.preventDefault(); e.stopPropagation();
        applyVideoValue(el, 'currentTime', el.currentTime + 5);
        return;
      case e.key === 'ArrowUp':
        e.preventDefault(); e.stopPropagation();
        applyVideoValue(el, 'volume', el.volume + 0.1);
        return;
      case e.key === 'ArrowDown':
        e.preventDefault(); e.stopPropagation();
        applyVideoValue(el, 'volume', el.volume - 0.1);
        return;
      case e.key === 'm':
        e.preventDefault(); e.stopPropagation();
        applyVideoValue(el, 'muted', !el.muted);
        return;
    }
    return;
  }

  if (!(currentState === 'b' || currentState === 'd')) return;

  const kdPath = e.composedPath ? e.composedPath() : [];
  if (kdPath.includes(tooltip)) {
    const t = e.target;
    const isEditable = !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable));
    if (isEditable) return;
    if (!(e.key === 'Escape' || e.key === '`' || e.key === 'Backquote')) return;
  }

  if (e.key === 'Escape' || e.key === '`' || e.key === 'Backquote') {
    e.preventDefault();
    if (currentState === 'd') {
      unlockCurrentElement('keyboard');
    } else if (currentState === 'b') {
      exitSelectMode();
    }
    return;
  }

  if (e.code === 'Numpad0') {
    e.preventDefault();
    e.stopPropagation();
    if (currentState === 'b' && previewElement) {
      lockCurrentElement('keyboard');
    } else if (currentState === 'd') {
      unlockCurrentElement('keyboard');
    }
    return;
  }

  if (currentState === 'd' && lockedElement) {
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      navigateRelative('parent');
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      navigateRelative('child');
    } else if (e.key === '/') {
      e.preventDefault();
      navigateRelative('prev');
    } else if (e.key === '*') {
      e.preventDefault();
      navigateRelative('next');
    } else if (e.code === 'Numpad9') {
      e.preventDefault();
      navigateRelative('child');
    }
  }

  if (currentState === 'b' && previewElement) {
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      navigateRelative('parent');
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      navigateRelative('child');
    } else if (e.key === '/') {
      e.preventDefault();
      navigateRelative('prev');
    } else if (e.key === '*') {
      e.preventDefault();
      navigateRelative('next');
    }
  }
}

function showNotification(message, type = 'info') {
  const notif = document.createElement('div');
  notif.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: ${type === 'success' ? '#10b981' : '#3b82f6'};
    color: white;
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 12px;
    z-index: 2147483647;
    animation: slideIn 0.3s;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    pointer-events: none;
  `;
  notif.textContent = message;
  document.body.appendChild(notif);
  setTimeout(() => notif.remove(), 2000);
}

// ==================== 键盘监听 ====================
document.addEventListener('keydown', handleKeyDown, true);

// ==================== 消息监听 ====================
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "ACTIVATE_PICKER") {
    if (currentState === 'a') {
      enterSelectMode();
    } else if (currentState === 'e') {
      exitAnyFullscreen();
    } else if (currentState === 'd') {
      unlockCurrentElement('extension');
    } else if (currentState === 'b') {
      exitSelectMode();
    }
  } else if (request.action === "UNSELECT") {
    handleExit();
  }
});

// 闪退诊断
window.addEventListener('error', (ev) => {
  if (window.__ELEMENT_PICKER_ACTIVE) {
    console.error('[Picker] 运行时异常:', ev.message, '@', ev.filename, ':', ev.lineno);
  }
});

// 清理资源
window.addEventListener('beforeunload', () => {
  if (updateOverlayRaf) cancelAnimationFrame(updateOverlayRaf);
  document.removeEventListener('keydown', handleKeyDown, true);
  cleanupVideoPanel();
});

// 初始化
createUI();
console.log('✅ 元素选择器已加载 (v9.6.5)', performance.now());
