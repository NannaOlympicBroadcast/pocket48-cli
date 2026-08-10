#!/usr/bin/env node

const { run } = require('../src/cli');

run(process.argv.slice(2))
    .then((code) => {
        process.exitCode = code;
    })
    .catch((error) => {
        process.stderr.write(`未捕获错误：${error && error.stack ? error.stack : error}\n`);
        process.exitCode = 1;
    });
