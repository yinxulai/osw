#!/usr/bin/env node
/**
 * 生成所有位图图标。
 *
 * 唯一矢量源是 `packages/console/public/icon.svg`——网页 favicon、侧栏标志、打包图标、
 * 托盘图标、文档与宣发导出**全部**由它派生，不存在「第二份几何」。想改标志就改那一个文件，
 * 然后跑 `pnpm icons`（根目录脚本）重新生成。
 *
 * 为什么不是手工导出几张 PNG：
 *   1. 标志几乎每一版都会微调，手导一定会漏掉某个尺寸；
 *   2. 手工导出会各自留不同的边距，结果同一个标志在托盘、任务栏、favicon 上大小不一。
 * 所以这里统一走 `composeSvg`：先量出「含描边的实际墨迹」包围盒，再把这块墨迹等比塞进
 * 目标画布并按图心居中——任何尺寸、任何构图下的留白比例都一致。
 *
 * 输出（全部会被写盘，无中间产物）：
 *   apps/app/build/icon.png            1024²  打包主图标（win / linux）
 *   apps/app/build/icon-mac.png        1024²  macOS（electron-builder 会自行转 icns）
 *   apps/app/build/icon.ico            7 档   Windows 可执行文件与 NSIS 安装包
 *   apps/app/build/tray-icon.png        16²   托盘（纯白蒙版）
 *   apps/app/build/tray-icon@2x.png     32²   ↑ 的 2× 档
 *   apps/app/build/tray-icon@3x.png     48²   ↑ 的 3× 档
 *   apps/app/build/tray-icon-dev*.png   同上  托盘开发版（白蒙版 + 右下角一个圆点）
 *   apps/app/build/tray-icon-win*.png   48²   托盘 · Windows 专用大图（见文件尾部说明）
 *   apps/docs/assets/brand/**           文档 / 宣发用导出（含备选标志）
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '..')
const repoRoot = resolve(appDir, '..', '..')

const SOURCE_SVG = resolve(repoRoot, 'packages/console/public/icon.svg')
/** 备选标志：双刃（冷色霓虹），本轮不作为产品标志，但保留下来继续做视觉延续。 */
const ALT_SVG = resolve(repoRoot, 'apps/docs/assets/brand/icon-alt-blades.svg')

const BUILD_DIR = resolve(appDir, 'build')
const BRAND_DIR = resolve(repoRoot, 'apps/docs/assets/brand')
const BRAND_PNG_DIR = resolve(BRAND_DIR, 'png')

const XMLNS = 'http://www.w3.org/2000/svg'
/** Windows 的 icon.ico 惯例档位；256 是 Vista 之后的上限，再大没有意义。 */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
/** 打包图标留白：墨迹占画布 88%，和改版前的视觉体量基本一致，换图不会「变小一圈」。 */
const APP_MARGIN = 0.06
/** 托盘只有 16px，留白要更小才看得清。 */
const TRAY_MARGIN = 0.02
/** 托盘的逻辑尺寸；实际输出 1×/2×/3× 三档位图，由 `source/tray-icon.ts` 组装成多倍率 nativeImage。 */
const TRAY_BASE_SIZE = 16
const TRAY_SCALES = [1, 2, 3]
/**
 * Windows 专用：只出一档，但像素足够多（16 的 3 倍）。
 *
 * Windows 的多倍率是假的：Electron 的 `Tray::SetImage` 在 Win 上走
 * `NativeImage::GetHICON(GetSystemMetrics(SM_CXSMICON))`，而位图版本的这个方法
 * **完全不看传进来的 size**，直接 `IconUtil::CreateHICONFromSkBitmap(image().AsBitmap())`
 * ——`AsBitmap()` 取的就是 1× 那一档。于是 `addRepresentation` 挂上去的 2×/3× 在
 * Windows 上永远不会被读到，系统只会拿到 16² 再放大到 24/32px，必然糊。
 * 所以给 Windows 单发一张大图当「1×」，让 HICON 自带像素，由系统自己缩小。
 */
const TRAY_WINDOWS_SIZE = 48
/** 文档 / 宣发导出留白稍大，四周有呼吸感。 */
const BRAND_MARGIN = 0.08
/**
 * 开发版托盘标记：标志右下角一颗圆点。
 *
 * 上一版的做法是「把闪电尾巴切掉一块」，但残掉的闪电看起来像图没画完，16px 下尤其难看。
 * 现在改成**满血标志 + 右下角一颗独立圆点**：标志本身完整、视觉体量几乎不变，
 * 和正式版并排时仍然一眼可分。
 *
 * 为什么放右下角：闪电是左上→右下的斜切，墨迹框的右下角本来就是空的，圆点塞进去
 * 既不会和标志粘连，也不用把标志缩小多少（只让出 16% 的画布）。
 * 试过的其它方案（正下方圆点、下方横条、右侧竖条）在 16px 下要么把标志压得太小、
 * 要么和闪电尾巴糊成一坨。
 */
const DEV_BADGE = {
  /** 标志占用的画布区域（归一化），剩下的那角留给圆点。 */
  region: [0, 0, 0.84, 0.84],
  /** 圆点圆心（画布归一化）。 */
  x: 0.84,
  y: 0.84,
  /** 半径，相对画布的较短边。 */
  radius: 0.13,
  fill: '#fff',
}

// ---------------------------------------------------------------- SVG 解析

/**
 * 拆出 viewBox 与「<svg> 内部的内容」。
 *
 * 只做这一层拆分，不解析 DOM：所有输出都复刻用户空间的原始坐标，改标志的人随手写什么都行。
 */
function parseSvg(source, label) {
  const viewBox = /\bviewBox="([^"]+)"/.exec(source)?.[1]
  if (!viewBox) throw new Error(`${label} 缺少 viewBox，无法推算构图`)
  const numbers = viewBox.trim().split(/[\s,]+/).map(Number)
  if (numbers.length !== 4 || numbers.some(Number.isNaN)) {
    throw new Error(`${label} 的 viewBox 不是四个数字：${viewBox}`)
  }
  const [minX, minY, width, height] = numbers
  const open = source.indexOf('<svg')
  const inner = source.slice(source.indexOf('>', open) + 1, source.lastIndexOf('</svg>'))
  return { box: { minX, minY, width, height }, inner }
}

/**
 * 量出「含描边的墨迹」包围盒（用户空间坐标）。
 *
 * 必须真渲染一遍再扫 alpha，不能信 path 的 `d`：标志是靠 `stroke-width` 喂胖的，
 * 描边能占到整体尺寸的三成，只看路径顶点会算出偏小一圈的框、留白全部失真。
 */
async function measureArtwork(source, probe = 512) {
  const { box, inner } = source
  const svg = wrapSvg(inner, box, probe, probe)
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1
  // 阈值取 12 而不是 0：边缘反锯齿会产生一大片 1/255 的近透明像素，会把框撑到整张画布。
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + 3] > 12) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) throw new Error('标志渲染后完全透明，检查 fill / stroke 是否指向了不存在的渐变')
  const scale = box.width / probe
  return {
    x: box.minX + minX * scale,
    y: box.minY + minY * scale,
    w: (maxX - minX + 1) * scale,
    h: (maxY - minY + 1) * scale,
  }
}

/** 把一段内部内容套回一个定尺寸的 <svg>。 */
function wrapSvg(inner, box, width, height, extra = '') {
  return `<svg xmlns="${XMLNS}" width="${width}" height="${height}" viewBox="${box.minX} ${box.minY} ${box.width} ${box.height}">${extra}${inner}</svg>`
}

// ---------------------------------------------------------------- 构图

/**
 * 把标志等比装进一张画布。
 *
 * `artwork` 是上面量出来的墨迹框；标志按 contain 塞进「画布减去留白」的方框，然后按图心居中。
 * 因为用的是墨迹框而不是 viewBox，400×120 的横向画布和正方形画布的视觉重量是一样的。
 *
 * @param {object}   options
 * @param {{x:number,y:number,w:number,h:number}} options.artwork 墨迹框（用户空间）
 * @param {number}   options.width   画布宽（px）
 * @param {number}   [options.height] 画布高（px），默认与宽相同
 * @param {number}   [options.margin] 四边留白占画布的比例
 * @param {string}   [options.paint]  单色替换：把渐变引用换成这个颜色
 * @param {string}   [options.background] 底色，默认透明
 * @param {{region:number[],x:number,y:number,radius:number,fill:string}} [options.badge] 开发版圆点
 */
function composeSvg(options) {
  const { box, inner, artwork, width, margin = 0, paint, background, badge } = options
  const height = options.height ?? width
  const content = paint ? inner.replaceAll(/url\(#[^)]*\)/g, paint) : inner

  // 有徽标时标志只占 `region`（画布归一化），把另一角让给徽标。
  const [rx, ry, rw, rh] = badge ? badge.region : [0, 0, 1, 1]
  const regionWidth = rw * width
  const regionHeight = rh * height
  const scale = Math.min(
    (regionWidth * (1 - 2 * margin)) / artwork.w,
    (regionHeight * (1 - 2 * margin)) / artwork.h,
  )
  const translateX = rx * width + regionWidth / 2 - scale * (artwork.x + artwork.w / 2)
  const translateY = ry * height + regionHeight / 2 - scale * (artwork.y + artwork.h / 2)

  let badgeSvg = ''
  let shiftX = 0
  let shiftY = 0
  if (badge) {
    const radius = badge.radius * Math.min(width, height)
    const dotX = badge.x * width
    const dotY = badge.y * height
    // 「标志 + 圆点」合起来才是这张图，所以要按合并后的包围盒居中，
    // 否则圆点会把整个图形拽向右下、看起来偏一边。
    const left = Math.min(translateX + scale * artwork.x, dotX - radius)
    const right = Math.max(translateX + scale * (artwork.x + artwork.w), dotX + radius)
    const top = Math.min(translateY + scale * artwork.y, dotY - radius)
    const bottom = Math.max(translateY + scale * (artwork.y + artwork.h), dotY + radius)
    shiftX = width / 2 - (left + right) / 2
    shiftY = height / 2 - (top + bottom) / 2
    badgeSvg = `<circle cx="${round(dotX)}" cy="${round(dotY)}" r="${round(radius)}" fill="${badge.fill}"/>`
  }

  return [
    `<svg xmlns="${XMLNS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    background ? `<rect x="0" y="0" width="${width}" height="${height}" fill="${background}"/>` : '',
    `<g transform="translate(${round(shiftX)} ${round(shiftY)})">`,
    `<g transform="translate(${round(translateX)} ${round(translateY)}) scale(${round(scale)})">${content}</g>`,
    badgeSvg,
    `</g>`,
    `</svg>`,
  ].join('')
}

/** 变换矩阵里留 6 位小数足够，再多只会让生成的 SVG 难读。 */
function round(value) {
  return Math.round(value * 1e6) / 1e6
}

/**
 * 光栅化到指定的像素尺寸。
 *
 * 不用 sharp 的 `density`：那会把 SVG 按「倍率 × 声明尺寸」放大，拿到一张比目标大好几倍的图。
 * 这里一律先按 4 倍画一张（SVG 里的比例全是相对的，放大不会变形），再用 Lanczos 降采样，
 * 边缘比「直接按目标尺寸光栅化」干净得多，16px 的托盘图标尤其明显。
 */
const SUPERSAMPLE = 4

async function rasterize(svg, width, height) {
  return sharp(Buffer.from(svg))
    .resize(width, height, { kernel: 'lanczos3', fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/** 画一张再降采样。`width` / `height` 是成品的像素尺寸，构图仍按同一套相对比例计算。 */
async function render(options) {
  const { width } = options
  const height = options.height ?? width
  const svg = composeSvg({ ...options, width: width * SUPERSAMPLE, height: height * SUPERSAMPLE })
  return rasterize(svg, width, height)
}

/** 打出 ICO 容器；Vista 之后每帧都是一张完整 PNG，不需要自己写 BMP 与调色板。 */
function packIco(frames) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: 1 = icon
  header.writeUInt16LE(frames.length, 4)

  const directory = Buffer.alloc(16 * frames.length)
  let offset = header.length + directory.length
  frames.forEach(({ size, png }, index) => {
    const at = index * 16
    // 256 在这一栏里用 0 表示（一个字节放不下 256）。
    directory.writeUInt8(size >= 256 ? 0 : size, at)
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1)
    directory.writeUInt8(0, at + 2) // 调色板颜色数：真彩色写 0
    directory.writeUInt8(0, at + 3) // reserved
    directory.writeUInt16LE(1, at + 4) // color planes
    directory.writeUInt16LE(32, at + 6) // bits per pixel
    directory.writeUInt32LE(png.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += png.length
  })

  return Buffer.concat([header, directory, ...frames.map((frame) => frame.png)])
}

// ---------------------------------------------------------------- 主流程

async function main() {
  const source = await readFile(SOURCE_SVG, 'utf8')
  const mark = parseSvg(source, 'icon.svg')
  const artwork = await measureArtwork(mark)

  await mkdir(BUILD_DIR, { recursive: true })
  await mkdir(BRAND_PNG_DIR, { recursive: true })

  const written = []
  const emit = async (file, options) => {
    await writeFile(file, await render(options))
    written.push({ file })
  }

  // 打包图标
  const appPng = { box: mark.box, inner: mark.inner, artwork, margin: APP_MARGIN }
  await emit(resolve(BUILD_DIR, 'icon.png'), { ...appPng, width: 1024 })
  await emit(resolve(BUILD_DIR, 'icon-mac.png'), { ...appPng, width: 1024 })

  // ICO 里每一帧都是一张独立位图，按各自的目标尺寸重新光栅化（不是把 1024 缩下去）。
  const frames = []
  for (const size of ICO_SIZES) {
    frames.push({ size, png: await render({ ...appPng, width: size }) })
  }
  await writeFile(resolve(BUILD_DIR, 'icon.ico'), packIco(frames))
  written.push({ file: resolve(BUILD_DIR, 'icon.ico'), note: `${ICO_SIZES.length} 档：${ICO_SIZES.join('/')}` })

  // 托盘：纯白蒙版（macOS 由系统当作 template image 着色，彩色不会被采用）。
  //
  // 三档都要出。托盘是唯一「必定会被系统按屏幕 DPI 重新取样」的地方：只给一张 16² 的位图，
  // macOS Retina 拿到的就是被插值糊过的图。文件名里的 `@2x` 只是给人看的——`?url` 导入会
  // 把它们内联成 data URL，倍率由 `source/tray-icon.ts` 用 `addRepresentation` 声明。
  const tray = { box: mark.box, inner: mark.inner, artwork, margin: TRAY_MARGIN, paint: '#fff' }
  for (const scale of TRAY_SCALES) {
    const suffix = scale === 1 ? '' : `@${scale}x`
    const width = TRAY_BASE_SIZE * scale
    await emit(resolve(BUILD_DIR, `tray-icon${suffix}.png`), { ...tray, width })
    await emit(resolve(BUILD_DIR, `tray-icon-dev${suffix}.png`), { ...tray, width, badge: DEV_BADGE })
  }
  // Windows 单独一张大图，理由见 `TRAY_WINDOWS_SIZE`。
  await emit(resolve(BUILD_DIR, 'tray-icon-win.png'), { ...tray, width: TRAY_WINDOWS_SIZE })
  await emit(resolve(BUILD_DIR, 'tray-icon-dev-win.png'), {
    ...tray,
    width: TRAY_WINDOWS_SIZE,
    badge: DEV_BADGE,
  })

  // 备选标志（双刃 · 冷色霓虹）：只导出文档用的位图，不进产物。
  const altSource = await readFile(ALT_SVG, 'utf8')
  const alt = parseSvg(altSource, 'icon-alt-blades.svg')
  const altArtwork = await measureArtwork(alt)

  // 文档 / 宣发导出
  const brandPng = { box: mark.box, inner: mark.inner, artwork, margin: BRAND_MARGIN }
  for (const size of [1024, 512, 256, 128, 64, 32]) {
    await emit(resolve(BRAND_PNG_DIR, `icon-${size}.png`), { ...brandPng, width: size })
  }
  for (const paint of ['#fff', '#000']) {
    const name = paint === '#fff' ? 'icon-mono-white' : 'icon-mono-black'
    await emit(resolve(BRAND_PNG_DIR, `${name}-1024.png`), { ...brandPng, width: 1024, paint })
  }
  await emit(resolve(BRAND_PNG_DIR, 'icon-on-dark-1024.png'), { ...brandPng, width: 1024, background: '#121212' })
  for (const size of [1024, 512]) {
    await emit(resolve(BRAND_PNG_DIR, `icon-alt-blades-${size}.png`), {
      box: alt.box,
      inner: alt.inner,
      artwork: altArtwork,
      width: size,
      margin: BRAND_MARGIN,
    })
  }
  // GitHub 仓库的 social preview 固定 1280×640；暗底 + 霓虹标志，缩略图里最跳。
  await emit(resolve(BRAND_PNG_DIR, 'social-preview.png'), {
    ...brandPng,
    width: 1280,
    height: 640,
    margin: 0.18,
    background: '#121212',
  })

  // 唯一矢量源同样留一份到品牌目录，方便对外只发一个文件夹。
  await writeFile(resolve(BRAND_DIR, 'icon.svg'), source)

  for (const { file, note } of written) {
    const relative = file.slice(repoRoot.length + 1).replaceAll('\\', '/')
    const { size } = await stat(file)
    console.log(`${relative}  ${(size / 1024).toFixed(1)} KB${note ? `  (${note})` : ''}`)
  }
  console.log(`\n墨迹框 ${artwork.w.toFixed(1)} × ${artwork.h.toFixed(1)}（用户空间），共 ${written.length} 个产物`)
}

await main()
