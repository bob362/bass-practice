/**
 * TAB+リズム表示の付点を見やすくする、描画済み SVG の後処理。
 * alphaTab は TAB の付点を符尾の下端（連桁と同じ高さ）に小さく描くため、連桁に隠れてしまう。
 * 付点を拡大し、その音の符尾にかかる連桁のすぐ下へ移す。複付点は拡大後も重ならないよう並べ直す。
 */

/** SMuFL の付点（augmentationDot）グリフ */
export const SMUFL_AUGMENTATION_DOT = ''
/** SMuFL の休符グリフの範囲（restMaxima〜） */
export const SMUFL_REST_FIRST = 0xE4E0
export const SMUFL_REST_LAST = 0xE4FF
/** 付点の拡大率（以下の長さはすべて px、表示倍率前） */
export const TAB_DOT_SCALE = 2
/** 付点の直径（SMuFL の augmentationDot は 0.4 譜線間隔 = 3.6px、拡大前） */
const DOT_DIAMETER = 3.6
/** 拡大後の付点の半径 */
const TAB_DOT_RADIUS = DOT_DIAMETER / 2 * TAB_DOT_SCALE
/** 連桁の下端と付点の間のすき間 */
const TAB_DOT_GAP = 2.5
/** 複付点を並べ直すときの付点どうしのすき間 */
const TAB_DOT_SPACING = 2.4
/** alphaTab が複付点を並べる間隔（付点の幅の 1.5 倍 = 5.4px）より少し広い、同じ拍とみなす距離 */
const DOT_GROUP_DISTANCE = 8
/** 近くに連桁がない（旗・4分音符など）ときに符尾の下端から下げる量 */
const TAB_DOT_OFFSET_Y = 4.5
const TAB_DOT_OFFSET_X = -1
/**
 * 付点から左にある自分の符尾までの最大距離。符尾はフレット番号の中央、付点は番号の右に置かれるため、
 * 2 桁の番号でも 11px 程度。次の拍の符尾は付点より右にあるので、左側だけを探せば取り違えない
 */
const STEM_SEARCH_DISTANCE = 25
/** 符尾とみなす rect の最大幅（stemThickness 1.6px × 表示倍率。小節線もこの幅だが譜表の下端で終わる） */
const STEM_MAX_WIDTH = 4
/**
 * 休符の付点を見分ける範囲。alphaTab は休符の付点を休符と同じ y（譜表の中央の線）に、休符のすぐ右へ並べる
 * （実測で休符の原点から 12〜15px、複付点の 2 つ目で 19px）。いちばん幅の広い 128 分休符（約 19px）に
 * 付点 3 つ分（5.4px × 3）を足しても収まる 40px までを、その休符の付点とみなす
 */
const REST_DOT_MAX_DISTANCE = 40
/** 休符と付点の y の許容差（alphaTab は同じ値で置くので、丸め誤差だけ許す） */
const REST_DOT_Y_TOLERANCE = 1
/** alphaTab が連桁として描く 4 点の閉じたパス（M x,y L x,y L x,y L x,y z） */
const BEAM_PATH = /^\s*M([-\d.e]+),([-\d.e]+) L([-\d.e]+),([-\d.e]+) L([-\d.e]+),([-\d.e]+) L([-\d.e]+),([-\d.e]+) z\s*$/

export interface Beam { left: number; right: number; bottom: number }
export interface Stem { left: number; right: number; bottom: number }

export function parseTranslate(g: Element): [number, number] | null {
  const m = /translate\(\s*([-\d.e]+)[\s,]+([-\d.e]+)\s*\)/.exec(g.getAttribute('transform') ?? '')
  return m ? [Number(m[1]), Number(m[2])] : null
}

/** 連桁（4 点のパス）の左右端と下端を集める */
export function collectBeams(svg: Element): Beam[] {
  const beams: Beam[] = []
  svg.querySelectorAll('path').forEach(path => {
    const m = BEAM_PATH.exec(path.getAttribute('d') ?? '')
    if (!m) return
    const xs = [m[1], m[3], m[5], m[7]].map(Number)
    const ys = [m[2], m[4], m[6], m[8]].map(Number)
    beams.push({ left: Math.min(...xs), right: Math.max(...xs), bottom: Math.max(...ys) })
  })
  return beams
}

/** 符尾の候補（細い縦長の rect）を集める。小節線も含まれるが、付点の高さまで届かないので除外される */
export function collectStems(svg: Element): Stem[] {
  const stems: Stem[] = []
  svg.querySelectorAll('rect').forEach(rect => {
    const x = Number(rect.getAttribute('x'))
    const y = Number(rect.getAttribute('y'))
    const w = Number(rect.getAttribute('width'))
    const h = Number(rect.getAttribute('height'))
    if (!(w > 0 && w <= STEM_MAX_WIDTH && h > w)) return
    stems.push({ left: x, right: x + w, bottom: y + h })
  })
  return stems
}

/**
 * 付点（元の位置）の音にかかる連桁の下端を返す。見つからなければ null。
 * 付点の左にあり、付点の高さまで届くいちばん近い符尾を自分の符尾とし、その符尾に接する連桁だけを見る。
 */
export function findBeamBottom(dotX: number, dotY: number, ratio: number, stems: Stem[], beams: Beam[]): number | null {
  let stem: Stem | null = null
  for (const s of stems) {
    if (s.left > dotX + ratio || dotX - s.left > STEM_SEARCH_DISTANCE * ratio) continue
    if (s.bottom < dotY - ratio) continue
    if (!stem || s.left > stem.left) stem = s
  }
  if (!stem) return null
  let bottom: number | null = null
  for (const beam of beams) {
    if (beam.left > stem.right + ratio || beam.right < stem.left - ratio) continue
    if (beam.bottom < dotY - ratio || beam.bottom > dotY + 40 * ratio) continue
    bottom = bottom === null ? beam.bottom : Math.max(bottom, beam.bottom)
  }
  return bottom
}

interface Dot { g: Element; text: SVGTextElement; x: number; y: number }

/** 付点が休符の付点か（同じ高さで、どれかの休符のすぐ右にある）を判定する */
export function isRestDot(dotX: number, dotY: number, ratio: number, rests: [number, number][]): boolean {
  return rests.some(([x, y]) =>
    Math.abs(y - dotY) <= REST_DOT_Y_TOLERANCE * ratio &&
    dotX > x && dotX - x <= REST_DOT_MAX_DISTANCE * ratio)
}

function ratioOf(text: SVGTextElement): number {
  return (parseFloat(text.style.fontSize) || 100) / 100
}

/**
 * TAB+リズム表示の付点を見やすくする。処理済みの SVG には印を付け、二度処理しない
 * （alphaTab は再描画のたびに SVG を作り直すので、新しい SVG だけが処理される）。
 */
export function enhanceTabRhythmDots(root: HTMLElement): void {
  root.querySelectorAll('svg:not([data-bp-dots])').forEach(svg => {
    svg.setAttribute('data-bp-dots', '1')
    const rests: [number, number][] = []
    const dots: Dot[] = []
    svg.querySelectorAll('g > text').forEach(node => {
      const text = node as SVGTextElement
      const content = text.textContent ?? ''
      if (content.length !== 1) return
      const code = content.codePointAt(0) ?? 0
      const g = text.parentElement
      if (!g || g.tagName.toLowerCase() !== 'g') return
      const pos = parseTranslate(g)
      if (!pos) return
      if (content === SMUFL_AUGMENTATION_DOT) dots.push({ g, text, x: pos[0], y: pos[1] })
      else if (code >= SMUFL_REST_FIRST && code <= SMUFL_REST_LAST) rests.push(pos)
    })
    // 休符の付点は位置を変えない（音符の付点は譜表の下、リズム領域にある）
    const noteDots = dots.filter(dot => !isRestDot(dot.x, dot.y, ratioOf(dot.text), rests))
    if (!noteDots.length) return
    const stems = collectStems(svg)
    const beams = collectBeams(svg)
    noteDots.sort((a, b) => a.y - b.y || a.x - b.x)
    let first: Dot | null = null
    let prev: Dot | null = null
    let index = 0
    let y = 0
    for (const dot of noteDots) {
      const size = parseFloat(dot.text.style.fontSize) || 100
      const ratio = size / 100
      // 同じ高さで alphaTab の付点間隔ほどしか離れていなければ、同じ拍の複付点として扱う
      const sameBeat = prev && Math.abs(dot.y - prev.y) < 0.5 && dot.x - prev.x <= DOT_GROUP_DISTANCE * ratio
      if (!sameBeat || !first) {
        first = dot
        index = 0
        const beamBottom = findBeamBottom(dot.x, dot.y, ratio, stems, beams)
        y = beamBottom !== null
          ? beamBottom + (TAB_DOT_GAP + TAB_DOT_RADIUS) * ratio
          : dot.y + TAB_DOT_OFFSET_Y * ratio
      } else {
        index++
      }
      prev = dot
      const x = first.x + (TAB_DOT_OFFSET_X + index * (DOT_DIAMETER * TAB_DOT_SCALE + TAB_DOT_SPACING)) * ratio
      dot.text.style.fontSize = `${size * TAB_DOT_SCALE}%`
      dot.g.setAttribute('transform', `translate(${x} ${y})`)
    }
  })
}
