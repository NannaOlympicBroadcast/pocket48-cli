#!/usr/bin/env node

// 插件的 CLI 入口。
//
// 刻意不叫 bin/ ——claude.ai 托管的插件不允许插件根目录下存在 bin/，
// 那里的可执行文件会被加进 PATH 但不出现在管理员审批界面，所以校验会直接失败。
// 调用方一律显式执行：node "$CLAUDE_PLUGIN_ROOT/cli.js" <命令>

const path = require('path');

const ROOT = __dirname;

// 插件是被克隆/解引用下来的，不带 node_modules。直接 require 会抛
// MODULE_NOT_FOUND，堆栈对使用者毫无帮助，先给一句能照做的提示。
function preflight() {
    for (const dependency of ['axios', 'pngjs']) {
        try {
            require.resolve(dependency, { paths: [ROOT] });
        } catch (error) {
            process.stderr.write([
                `snh48：缺少运行时依赖 ${dependency}。`,
                `请先执行：cd ${ROOT} && npm install --omit=dev`,
                ''
            ].join('\n'));
            return false;
        }
    }
    return true;
}

if (!preflight()) {
    process.exitCode = 1;
} else {
    const { run } = require(path.join(ROOT, 'src', 'cli'));

    run(process.argv.slice(2))
        .then((code) => {
            process.exitCode = code;
        })
        .catch((error) => {
            process.stderr.write(`未捕获错误：${error && error.stack ? error.stack : error}\n`);
            process.exitCode = 1;
        });
}
