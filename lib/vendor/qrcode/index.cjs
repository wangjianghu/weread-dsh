/**
 * vendored QR 生成入口（源自 qrcode@1.5.x MIT + dijkstrajs MIT，见同目录 LICENSE-*）。
 * v1.8.8：登录二维码此前依赖境外公共服务 api.qrserver.com——网络不可达时二维码破损（图 1 实况）。
 * 本地生成 SVG 彻底去除该外网依赖；仅 vendor 生成路径所需（core + svg-tag renderer），未动算法。
 */
const QRCode = require('./core/qrcode.cjs')
const SvgTag = require('./svg-tag.cjs')

/** 生成二维码 SVG 字符串。text: 内容；opts: {ecc='M', margin=2, width} */
exports.createSvg = function createSvg(text, opts = {}) {
  const qr = QRCode.create(String(text), { errorCorrectionLevel: opts.ecc || 'M' })
  return SvgTag.render(qr, { margin: opts.margin ?? 2, width: opts.width, height: opts.width })
}
