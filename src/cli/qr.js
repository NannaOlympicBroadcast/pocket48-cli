// 把 live.48.cn 返回的二维码 PNG 还原成模块矩阵，并渲染成终端可扫的图形。
// 接口给的是服务端生成的位图而不是二维码内容，所以只能反解像素，没法用 qrcode 重新编码。

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const WHITE_FG = '\u001b[38;5;231m';
const WHITE_BG = '\u001b[48;5;231m';
const BLACK_FG = '\u001b[38;5;16m';
const BLACK_BG = '\u001b[48;5;16m';
const RESET = '\u001b[0m';

function decodeDataUri(dataUri) {
    const match = String(dataUri || '').match(/^data:image\/png;base64,(.+)$/);
    if (!match) return null;
    return Buffer.from(match[1], 'base64');
}

// PNG → 二值矩阵（true = 深色模块）
function toBitmap(buffer) {
    const png = PNG.sync.read(buffer);
    const rows = [];

    for (let y = 0; y < png.height; y += 1) {
        const row = new Array(png.width);
        for (let x = 0; x < png.width; x += 1) {
            const index = (png.width * y + x) << 2;
            const alpha = png.data[index + 3];
            // 亮度低于中值即视为深色；全透明像素按浅色处理。
            const luma = (png.data[index] * 299 + png.data[index + 1] * 587 + png.data[index + 2] * 114) / 1000;
            row[x] = alpha > 128 && luma < 128;
        }
        rows.push(row);
    }

    return rows;
}

function trimQuietZone(bitmap) {
    let top = 0;
    let bottom = bitmap.length - 1;
    let left = 0;
    let right = bitmap[0].length - 1;

    const rowBlank = (y) => bitmap[y].every((cell) => !cell);
    const colBlank = (x) => bitmap.every((row) => !row[x]);

    while (top <= bottom && rowBlank(top)) top += 1;
    while (bottom > top && rowBlank(bottom)) bottom -= 1;
    while (left <= right && colBlank(left)) left += 1;
    while (right > left && colBlank(right)) right -= 1;

    if (top > bottom || left > right) return null;
    return bitmap.slice(top, bottom + 1).map((row) => row.slice(left, right + 1));
}

// 模块边长由左上定位符推出：它固定是 7 个模块宽。
// 不能用「最短同色游程」——二维码中间盖了个彩色 logo，它的抗锯齿边缘会产生 1px 游程。
function detectModuleSize(bitmap) {
    const leadingDarkRun = (values) => {
        let start = 0;
        while (start < values.length && !values[start]) start += 1;
        let length = 0;
        while (start + length < values.length && values[start + length]) length += 1;
        return length;
    };

    // 首行与首列都穿过左上定位符，取两者的一致结果更稳。
    const candidates = [leadingDarkRun(bitmap[0]), leadingDarkRun(bitmap.map((row) => row[0]))]
        .map((run) => Math.round(run / 7))
        .filter((size) => size >= 1);

    if (candidates.length === 0) return 0;
    return Math.min(...candidates);
}

// 合法的二维码版本尺寸为 21、25、29 …… 即 (count - 17) 能被 4 整除。
function isValidModuleCount(count) {
    return count >= 21 && count <= 177 && (count - 17) % 4 === 0;
}

function toModules(bitmap) {
    const trimmed = trimQuietZone(bitmap);
    if (!trimmed) return null;

    const moduleSize = detectModuleSize(trimmed);
    if (!moduleSize) return null;

    const count = Math.round(trimmed.length / moduleSize);
    if (!isValidModuleCount(count)) return null;

    const modules = [];
    for (let row = 0; row < count; row += 1) {
        const line = new Array(count);
        // 取模块中心像素，避开边缘的抗锯齿。
        const y = Math.min(trimmed.length - 1, Math.floor((row + 0.5) * moduleSize));
        for (let column = 0; column < count; column += 1) {
            const x = Math.min(trimmed[0].length - 1, Math.floor((column + 0.5) * moduleSize));
            line[column] = trimmed[y][x];
        }
        modules.push(line);
    }

    return modules;
}

// 半块字符：一个字符格 = 横向 1 模块、纵向 2 模块，比例接近正方形。
// 前景/背景色都显式指定，避免深色主题下二维码反相导致扫不出来。
function renderModules(modules, { quietZone = 2 } = {}) {
    const size = modules.length + quietZone * 2;
    const at = (row, column) => {
        const r = row - quietZone;
        const c = column - quietZone;
        if (r < 0 || c < 0 || r >= modules.length || c >= modules.length) return false;
        return modules[r][c];
    };

    const lines = [];
    for (let row = 0; row < size; row += 2) {
        let line = '';
        for (let column = 0; column < size; column += 1) {
            const top = at(row, column);
            const bottom = row + 1 < size ? at(row + 1, column) : false;
            line += `${top ? BLACK_FG : WHITE_FG}${bottom ? BLACK_BG : WHITE_BG}▀`;
        }
        lines.push(line + RESET);
    }

    return lines.join('\n');
}

function renderQrFromDataUri(dataUri, options = {}) {
    const buffer = decodeDataUri(dataUri);
    if (!buffer) return null;

    try {
        const modules = toModules(toBitmap(buffer));
        return modules ? renderModules(modules, options) : null;
    } catch (error) {
        return null;
    }
}

function saveQrImage(dataUri, targetDir, fileName = 'snh48-login-qr.png') {
    const buffer = decodeDataUri(dataUri);
    if (!buffer) return '';

    const filePath = path.join(targetDir, fileName);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(filePath, buffer);
    return filePath;
}

module.exports = {
    decodeDataUri,
    renderQrFromDataUri,
    saveQrImage
};
