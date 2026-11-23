/* ui/tips.js — 悬停说明（ⓘ）。文案里的数值由调用方从 GameConfig 读取后拼入，这里只负责渲染。
   align: 'l'（默认，向右展开）| 'r'（向左展开，用于靠右边缘的元素） */
const GameTips = (() => {
  const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  function tip(text, align) {
    return `<span class="tip ${align === 'r' ? 'tip-r' : ''}" tabindex="0" data-tip="${attr(text)}">ⓘ</span>`;
  }
  return { tip };
})();
