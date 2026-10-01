// 首帧渲染前执行（普通脚本，非模块）：Chrome 插件页面禁止内联脚本，所以放在独立文件里。
// 1. 应用显式选择的主题，避免闪烁；“跟随系统”由 CSS 媒体查询处理
// 2. 插件浮窗：恢复记住的浮窗大小
;(function () {
  var root = document.documentElement
  function get(key, fallback) {
    try {
      var raw = localStorage.getItem(key)
      return raw == null ? fallback : JSON.parse(raw)
    } catch (e) {
      return fallback
    }
  }

  var theme = get('stickydo.theme', 'system')
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme

  if (root.dataset.surface === 'extension') {
    var isWindow = /[?&]window(=|&|$)/.test(location.search)
    root.classList.add(isWindow ? 'ext-window' : 'ext-popup')
    if (!isWindow) {
      // 与 src/extension/popupSize.ts 中的常量保持一致
      var size = get('stickydo.ext.popupSize', null) || { w: 480, h: 560 }
      var w = Math.min(800, Math.max(320, size.w | 0))
      var h = Math.min(600, Math.max(360, size.h | 0))
      root.style.setProperty('--popup-w', w + 'px')
      root.style.setProperty('--popup-h', h + 'px')
    }
  }
})()
