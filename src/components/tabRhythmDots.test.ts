import { describe, expect, it } from 'vitest'
import {
  SMUFL_AUGMENTATION_DOT, collectBeams, collectStems,
  enhanceTabRhythmDots, findBeamBottom, parseTranslate,
} from './tabRhythmDots'

const DOT = SMUFL_AUGMENTATION_DOT
const REST = String.fromCodePoint(0xE4E3)

/** alphaTab と同じマークアップで SVG を組み立てる */
function createContainer(markup: string): HTMLElement {
  const container = document.createElement('div')
  container.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="at-surface-svg">${markup}</svg>`
  return container
}

/** 付点の text 要素（stroke: none、110% は実機の描画例どおり） */
const dotG = (x: number, y: number): string =>
  `<g class="b1"><g transform="translate(${x} ${y})" class="at">` +
  `<text style="font-size: 110%; stroke: none;" fill="#F2F2F2">${DOT}</text></g></g>`

/** 休符の text 要素 */
const restG = (x: number, y: number): string =>
  `<g transform="translate(${x} ${y})" class="at"><text style="font-size: 110%">${REST}</text></g>`

const STEM = '<rect x="95" y="30" width="1.76" height="73.4"></rect>'
const BAR_LINE = '<rect x="47.1" y="15.2" width="1.584" height="44.2"></rect>'
const BEAM_103_4 = '<path d=" M90,103.4 L120,103.4 L120,99.88 L90,99.88 z"></path>'
const BEAM_FAR = '<path d=" M70,104 L85,104 L85,100.48 L70,100.48 z"></path>'
const BEAM_NEIGHBOR = '<path d=" M130,104 L160,104 L160,100.48 L130,100.48 z"></path>'
const FAR_STEM = '<rect x="80" y="30" width="1.76" height="73.4"></rect>'

/** 上下 3.52（0.32 譜線間隔 × 11）だけ開いた平行な連桁を作る */
const beam = (bottom: number): string =>
  `<path d=" M90,${bottom.toFixed(2)} L120,${bottom.toFixed(2)} ` +
  `L120,${(bottom - 3.52).toFixed(2)} L90,${(bottom - 3.52).toFixed(2)} z"></path>`

/** transform 属性から translate の数値を読む（jsdom では属性直読みが確実） */
function readTranslate(g: Element): [number, number] | null {
  const m = /translate\(\s*([-\d.e]+)[\s,]+([-\d.e]+)\s*\)/.exec(g.getAttribute('transform') ?? '')
  return m ? [Number(m[1]), Number(m[2])] : null
}

function dotTextOf(container: HTMLElement, char = DOT): SVGTextElement {
  const texts = Array.from(container.querySelectorAll('svg text'))
  const text = texts.find(t => t.textContent === char)
  if (!text) throw new Error('text 要素が見つからない')
  return text as SVGTextElement
}

describe('parseTranslate', () => {
  it('translate の x と y を数値で返す', () => {
    const c = createContainer(
      '<g transform="translate(1.5 -2)" class="a"></g>' +
      '<g transform="translate(1.5,2e1)" class="b"></g>' +
      '<g class="c"></g>',
    )
    expect(parseTranslate(c.querySelector('.a')!)).toEqual([1.5, -2])
    expect(parseTranslate(c.querySelector('.b')!)).toEqual([1.5, 20])
    expect(parseTranslate(c.querySelector('.c')!)).toBeNull()
  })
})

describe('collectBeams', () => {
  it('4 点のパスから連桁の左右端と下端を集める（ほかのパスは無視）', () => {
    const c = createContainer(`${BEAM_103_4}<path d="M0,0 L10,10"></path>`)
    expect(collectBeams(c.querySelector('svg')!)).toEqual([
      { left: 90, right: 120, bottom: 103.4 },
    ])
  })
})

describe('collectStems', () => {
  it('細く縦長の rect を符尾候補として集める（横長の譜表の線は無視）', () => {
    const c = createContainer(`${STEM}<rect x="0" y="15.2" width="300" height="1.3"></rect>`)
    expect(collectStems(c.querySelector('svg')!)).toEqual([
      { left: 95, right: 96.76, bottom: 103.4 },
    ])
  })
})

describe('findBeamBottom', () => {
  const DOT_X = 101.9
  const DOT_Y = 103.4
  const RATIO = 1.1

  it('付点の左にあるいちばん近い符尾を選ぶ', () => {
    const c = createContainer(`${FAR_STEM}${STEM}${BEAM_FAR}${BEAM_103_4}${dotG(DOT_X, DOT_Y)}`)
    const stems = collectStems(c.querySelector('svg')!)
    const beams = collectBeams(c.querySelector('svg')!)
    // 遠い符尾にだけ接する連桁（下端 104）ではなく、近い符尾の連桁（下端 103.4）が選ばれる
    expect(findBeamBottom(DOT_X, DOT_Y, RATIO, stems, beams)).toBe(103.4)
  })

  it('選んだ符尾に接する、いちばん低い位置の連桁の下端を返す', () => {
    const c = createContainer(`${STEM}${BEAM_103_4}${beam(104)}${dotG(DOT_X, DOT_Y)}`)
    const stems = collectStems(c.querySelector('svg')!)
    const beams = collectBeams(c.querySelector('svg')!)
    expect(findBeamBottom(DOT_X, DOT_Y, RATIO, stems, beams)).toBe(104)
  })

  it('符尾がなければ null を返す', () => {
    const c = createContainer(`${BEAM_103_4}${dotG(DOT_X, DOT_Y)}`)
    const stems = collectStems(c.querySelector('svg')!)
    const beams = collectBeams(c.querySelector('svg')!)
    expect(findBeamBottom(DOT_X, DOT_Y, RATIO, stems, beams)).toBeNull()
  })

  it('選んだ符尾に接しない、隣のグループの連桁は無視する', () => {
    const c = createContainer(`${STEM}${BEAM_103_4}${BEAM_NEIGHBOR}${dotG(DOT_X, DOT_Y)}`)
    const stems = collectStems(c.querySelector('svg')!)
    const beams = collectBeams(c.querySelector('svg')!)
    // 隣の連桁（下端 104）より低い 103.4 が返る
    expect(findBeamBottom(DOT_X, DOT_Y, RATIO, stems, beams)).toBe(103.4)
  })

  it('付点の高さまで届かない小節線は符尾とみなさない', () => {
    const c = createContainer(
      `${BAR_LINE}<path d=" M40,103.4 L60,103.4 L60,99.88 L40,99.88 z"></path>${dotG(DOT_X, DOT_Y)}`,
    )
    const stems = collectStems(c.querySelector('svg')!)
    const beams = collectBeams(c.querySelector('svg')!)
    expect(findBeamBottom(DOT_X, DOT_Y, RATIO, stems, beams)).toBeNull()
  })
})

describe('enhanceTabRhythmDots', () => {
  it('2 本の連桁に隠れる付点を 220% に拡大し、低い連桁の下に移す', () => {
    const c = createContainer(`${STEM}${BEAM_103_4}${beam(95)}${dotG(101.9, 103.4)}`)
    enhanceTabRhythmDots(c)
    const svg = c.querySelector('svg')!
    const text = dotTextOf(c)
    expect(text.style.fontSize).toBe('220%')
    const pos = readTranslate(text.parentElement!)
    expect(pos).not.toBeNull()
    // 上下 2 本の連桁のうち低い方（下端 103.4）の下へ移る
    expect(pos![1]).toBeGreaterThan(103.4)
    expect(svg.getAttribute('data-bp-dots')).toBe('1')
  })

  it('休符と同じ高さの付点（休符の付点）は変更しない', () => {
    const c = createContainer(`${restG(101.9, 91.75)}${dotG(122.9, 91.75)}`)
    const text = dotTextOf(c)
    const rest = dotTextOf(c, REST)
    const sizeBefore = text.style.fontSize
    const transformBefore = text.parentElement!.getAttribute('transform')
    const restBefore = rest.parentElement!.getAttribute('transform')
    enhanceTabRhythmDots(c)
    expect(text.style.fontSize).toBe(sizeBefore)
    expect(text.style.fontSize).toBe('110%')
    expect(text.parentElement!.getAttribute('transform')).toBe(transformBefore)
    expect(rest.parentElement!.getAttribute('transform')).toBe(restBefore)
  })

  it('複付点は拡大しても重ならない間隔で並べ直す', () => {
    const c = createContainer(`${dotG(101.9, 103.4)}${dotG(107.84, 103.4)}`)
    enhanceTabRhythmDots(c)
    const dots = Array.from(c.querySelectorAll('svg text'))
      .map(t => readTranslate((t as SVGTextElement).parentElement!)!)
      .sort((a, b) => a[0] - b[0])
    const sizes = Array.from(c.querySelectorAll('svg text')).map(t => (t as SVGTextElement).style.fontSize)
    expect(sizes).toEqual(['220%', '220%'])
    expect(dots[0][1]).toBe(dots[1][1])
    // 2 倍サイズでも重ならない: 間隔は 2x の付点直径（3.6 * 2 * 1.1）以上
    const diameterAt2x = 3.6 * 2 * 1.1
    expect(dots[1][0] - dots[0][0]).toBeGreaterThanOrEqual(diameterAt2x)
  })

  it('符尾・連桁が近くにない付点は、少し下へずらすだけにする', () => {
    const c = createContainer(dotG(101.9, 103.4))
    enhanceTabRhythmDots(c)
    const pos = readTranslate(dotTextOf(c).parentElement!)!
    expect(pos[1]).toBeGreaterThan(103.4)
    expect(pos[1]).toBeLessThan(113.4)
  })

  it('二度処理しても拡大率と位置が変わらない', () => {
    const c = createContainer(`${STEM}${BEAM_103_4}${beam(95)}${dotG(101.9, 103.4)}`)
    enhanceTabRhythmDots(c)
    const text = dotTextOf(c)
    const transformAfterFirst = text.parentElement!.getAttribute('transform')
    enhanceTabRhythmDots(c)
    expect(text.style.fontSize).toBe('220%')
    expect(text.style.fontSize).not.toBe('440%')
    expect(text.parentElement!.getAttribute('transform')).toBe(transformAfterFirst)
  })
})

describe('enhanceTabRhythmDots の休符の判定', () => {
  it('別の拍の休符と高さが近くても音符の付点は拡大し、休符のすぐ右の付点はそのままにする', () => {
    // 休符（x 40, y 91.75）とその付点（すぐ右）、別の拍の連桁の下にある音符の付点（y 103.4、12px 差）
    const c = createContainer(
      `${restG(40, 91.75)}${dotG(52.6, 91.75)}${STEM}${BEAM_103_4}${dotG(101.9, 103.4)}`,
    )
    enhanceTabRhythmDots(c)
    const dots = Array.from(c.querySelectorAll('svg text'))
      .filter(t => t.textContent === DOT) as SVGTextElement[]
    const restDot = dots.find(t => readTranslate(t.parentElement!)![0] === 52.6)!
    const noteDot = dots.find(t => t !== restDot)!
    expect(restDot.style.fontSize).toBe('110%')
    expect(restDot.parentElement!.getAttribute('transform')).toBe('translate(52.6 91.75)')
    expect(noteDot.style.fontSize).toBe('220%')
    expect(readTranslate(noteDot.parentElement!)![1]).toBeGreaterThan(103.4)
  })
})
