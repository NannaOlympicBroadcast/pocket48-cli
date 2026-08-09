const fs = require('fs');
const path = require('path');
const wasmInit = require('../../../rust-wasm.js');

// CLI 与无头脚本会直接 require 本模块，此时进程里没有 electron。
function getElectronApp() {
    try {
        return require('electron').app || null;
    } catch (error) {
        return null;
    }
}

const { __x6c2adf8__ } = wasmInit;

let wasmInitialized = false;

async function ensureWasmLoaded() {
    if (wasmInitialized) {
        return;
    }

    try {
        const wasmName = '2.wasm';
        const app = getElectronApp();
        const wasmPath = app && app.isPackaged
            ? path.join(process.resourcesPath, wasmName)
            : path.join(__dirname, '../../../2.wasm');

        if (!fs.existsSync(wasmPath)) {
            console.error('WASM 文件未找到:', wasmPath);
            return;
        }

        const wasmBuffer = fs.readFileSync(wasmPath);
        await wasmInit.default(wasmBuffer);
        wasmInitialized = true;
        console.log('WASM 模块加载成功');
    } catch (error) {
        console.error('WASM 加载失败:', error);
    }
}

function generatePa() {
    if (!wasmInitialized) {
        return null;
    }

    try {
        return __x6c2adf8__();
    } catch (error) {
        console.error('生成 PA 失败:', error);
        return null;
    }
}

module.exports = {
    ensureWasmLoaded,
    generatePa
};
