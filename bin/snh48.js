#!/usr/bin/env node

// 作为插件从 marketplace 安装时，仓库是被克隆下来的，不带 node_modules。
// 直接 require 会抛 MODULE_NOT_FOUND，堆栈对使用者毫无帮助，先给一句人话。
function preflight() {
    const path = require('path');
    const root = path.join(__dirname, '..');

    for (const dependency of ['axios', 'pngjs']) {
        try {
            require.resolve(dependency, { paths: [root] });
        } catch (error) {
            process.stderr.write([
                `缺少依赖 ${dependency}，snh48 无法启动。`,
                `请先在 ${root} 执行：npm install --omit=dev`,
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
    const { run } = require('../src/cli');

    run(process.argv.slice(2))
        .then((code) => {
            process.exitCode = code;
        })
        .catch((error) => {
            process.stderr.write(`未捕获错误：${error && error.stack ? error.stack : error}\n`);
            process.exitCode = 1;
        });
}
