/* ui/modal.js — 弹窗的可访问性管理（所有 .overlay 通用）
   · 任何弹窗打开时，背景（#app 与下层弹窗）设为 inert：鼠标、键盘、读屏都碰不到
   · 焦点限制在最上层弹窗内循环（Tab / Shift+Tab），焦点不在弹窗内时按键一律拦截
   · 弹窗打开时把焦点移进去（主按钮优先）；全部关闭后焦点回到打开前的位置
   · onChange(open) 在弹窗开关变化时回调（app.js 用它暂停/恢复回合计时）
   通过监听各 .overlay 的 hidden 属性工作，各弹窗模块不用改。 */
const GameModal = (() => {
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let restoreTo = null;      // 第一个弹窗打开前的焦点
  let lastTop = null;
  const listeners = [];

  const overlays = () => Array.from(document.querySelectorAll('.overlay'));
  const isShown = (el) => !el.hidden;

  /** 最上层的可见弹窗（z-index 最高，相同则 DOM 里靠后的） */
  function top() {
    let best = null, bz = -Infinity;
    overlays().forEach((el) => {
      if (!isShown(el)) return;
      const z = parseInt(getComputedStyle(el).zIndex, 10) || 0;
      if (z >= bz) { best = el; bz = z; }
    });
    return best;
  }
  const isOpen = () => overlays().some(isShown);

  const focusables = (root) => Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);

  function focusInto(el) {
    if (el.contains(document.activeElement)) return;
    const prefer = el.querySelector('.actions .primary:not([disabled])') || focusables(el)[0];
    if (prefer) prefer.focus({ preventScroll: true });
    else { el.tabIndex = -1; el.focus({ preventScroll: true }); }
  }

  function sync() {
    const t = top();
    const app = document.getElementById('app');
    if (app) app.inert = !!t;
    overlays().forEach((el) => { el.inert = !!t && el !== t; });
    if (t && !lastTop) {                     // 从"无弹窗"到"有弹窗"：记下原焦点
      const a = document.activeElement;
      restoreTo = a && a !== document.body ? a : null;
    }
    if (t) focusInto(t);
    else if (lastTop) {                      // 全部关闭：回到原焦点（仍可用时），否则放到页面上
      const r = restoreTo;
      restoreTo = null;
      if (r && r.isConnected && !r.disabled && !r.closest('[inert]')) r.focus({ preventScroll: true });
      else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    }
    const changed = !!t !== !!lastTop;
    lastTop = t;
    if (changed) listeners.forEach((f) => f(!!t));
  }

  /** 键盘：弹窗打开时 Tab 在弹窗内循环；焦点在弹窗外时拦截所有按键（Enter/Space 等不会作用到背景） */
  function onKey(e) {
    const t = top();
    if (!t) return;
    const inside = t.contains(document.activeElement);
    // 按住 Enter/Space 的自动重复不算：防止一口气连过回合小结和季度成绩单
    if (e.repeat && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === 'Tab') {
      const f = focusables(t);
      e.preventDefault();
      if (!f.length) return;
      let i = f.indexOf(document.activeElement);
      i = i < 0 ? (e.shiftKey ? f.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + f.length) % f.length;
      f[i].focus();
      return;
    }
    if (!inside) { e.preventDefault(); e.stopPropagation(); focusInto(t); }
  }

  function init() {
    const mo = new MutationObserver(sync);
    overlays().forEach((el) => mo.observe(el, { attributes: true, attributeFilter: ['hidden'] }));
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', () => { const t = top(); if (t && !t.contains(document.activeElement)) focusInto(t); });
    sync();
  }

  function onChange(f) { listeners.push(f); }

  return { init, sync, isOpen, top, onChange };
})();
