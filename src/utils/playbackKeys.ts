/**
 * キー入力対象が編集可能・操作可能要素（input, textarea, select, button, a,
 * role=button, contenteditable、summary、checkbox/switch/slider/radio/
 * menuitem/tab/option/spinbutton/textbox/combobox ロール要素）を指しているか
 * どうかを判定する。Element でないターゲット（null, window, document など）は
 * false を返す。
 */
export function isEditableOrActivatableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false
  const element = target as Element
  const selector = [
    'input',
    'textarea',
    'select',
    'button',
    'a',
    '[role="button"]',
    'summary',
    '[role="checkbox"]',
    '[role="switch"]',
    '[role="slider"]',
    '[role="radio"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="option"]',
    '[role="spinbutton"]',
    '[role="textbox"]',
    '[role="combobox"]',
    '[contenteditable]:not([contenteditable="false"])',
  ].join(', ')
  if (element.closest(selector)) return true
  if ((target as HTMLElement).isContentEditable === true) return true
  return false
}

export type PlayPauseKeyAction = 'toggle' | 'consume' | 'ignore'

type PlayPauseKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'code' | 'repeat' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'target' | 'defaultPrevented' | 'isComposing'
>

/**
 * スペースキー入力に対する処理の種別を判定する。
 * - 'ignore': スペース以外のキー、修飾キー押下、デフォルト動作済み、IME変換中、
 *   または編集可能/操作可能要素上の入力（ショートカットとしては扱わない）
 * - 'consume': スペースキーかつリピート入力（既定のスクロールのみ抑制し、
 *   再生/一時停止は切り替えない）
 * - 'toggle': スペースキーによる再生/一時停止の切り替え
 */
export function getPlayPauseKeyAction(event: PlayPauseKeyEvent): PlayPauseKeyAction {
  const isSpace = event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar'
  if (!isSpace) return 'ignore'
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return 'ignore'
  if (event.defaultPrevented) return 'ignore'
  if (event.isComposing) return 'ignore'
  if (isEditableOrActivatableTarget(event.target)) return 'ignore'
  if (event.repeat) return 'consume'
  return 'toggle'
}

/**
 * スペースキーによる再生/一時停止ショートカットかどうかを判定する。
 * リピート入力・修飾キー押下・デフォルト動作済み・IME変換中の場合、また
 * 編集可能/操作可能要素上の入力の場合は false を返す。
 */
export function isPlayPauseShortcut(event: PlayPauseKeyEvent): boolean {
  return getPlayPauseKeyAction(event) === 'toggle'
}

/**
 * 巻き戻し可能なプレイヤーの再生位置を先頭に戻す。
 * スクロール要素が指定された場合はそのスクロール位置も先頭にリセットする。
 * 再生/一時停止は呼び出さない（再生状態はプレイヤー側で保持される）。
 */
export interface RewindablePlayer {
  tickPosition: number
}

export function rewindToStart(
  api: RewindablePlayer | null | undefined,
  scrollEl?: { scrollTop: number; scrollLeft?: number } | null,
): boolean {
  if (!api) return false
  api.tickPosition = 0
  if (scrollEl) {
    scrollEl.scrollTop = 0
    if ('scrollLeft' in scrollEl) {
      scrollEl.scrollLeft = 0
    }
  }
  return true
}
