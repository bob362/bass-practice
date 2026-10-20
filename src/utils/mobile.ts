export const MOBILE_BREAKPOINT_PX = 768
export const MOBILE_MEDIA_QUERY = '(max-width: 767.98px)'
export const DESKTOP_SCORE_SCALE = 1.1

/** 画面幅に応じた alphaTab の display.scale */
export function scoreScaleForWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return DESKTOP_SCORE_SCALE
  if (width < 400) return 0.8
  if (width < MOBILE_BREAKPOINT_PX) return 0.9
  return DESKTOP_SCORE_SCALE
}

export const TEMPO_MIN = 50
export const TEMPO_MAX = 120
export const TEMPO_STEP = 5

/** 速度(%)を delta だけ変えて [min,max] に収め整数に丸める。current が非有限なら100を基準にする */
export function stepTempo(current: number, delta: number, min = TEMPO_MIN, max = TEMPO_MAX): number {
  const base = Number.isFinite(current) ? current : 100
  return Math.round(Math.min(max, Math.max(min, base + delta)))
}
