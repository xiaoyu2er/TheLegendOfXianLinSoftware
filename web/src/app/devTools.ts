/**
 * 开发用入口是否可见（目前只有场景选择器）。
 *
 * 开发服务器里恒为开。构建产物里默认关，但可以用 `?dev` 打开 —— 部署一份
 * 静态产物给别人看的时候，"跳到任意场景做检查"这件事不能只在本机能做，
 * 否则验收的人只能看到起始场景。
 */
export function devToolsEnabled(): boolean {
  if (import.meta.env.DEV) return true
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('dev')
}
