// CLI 运行时：把 Electron 主进程里的 pocket-service 装配成一次性的命令行上下文。

const fs = require('fs');
const path = require('path');

const { CliError, resolveFormat } = require('./output');

// pocket-service 里散落着 console.log / console.warn，必须挪到 stderr，
// 否则会污染 stdout 上的 JSON。
function redirectConsoleToStderr({ verbose = false } = {}) {
    const write = (args) => {
        if (!verbose) return;
        process.stderr.write(`${args.map(stringifyLogArg).join(' ')}\n`);
    };

    console.log = (...args) => write(args);
    console.info = (...args) => write(args);
    console.debug = (...args) => write(args);
    console.warn = (...args) => process.stderr.write(`${args.map(stringifyLogArg).join(' ')}\n`);
    console.error = (...args) => process.stderr.write(`${args.map(stringifyLogArg).join(' ')}\n`);
}

function stringifyLogArg(value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || value.message;
    try {
        return JSON.stringify(value);
    } catch (error) {
        return String(value);
    }
}

function loadServices() {
    // require 必须发生在 console 重定向之后，wasm-service 会在加载时打日志。
    return {
        pocket: require('../main/services/pocket-service'),
        settings: require('../main/services/settings-service'),
        wasm: require('../main/services/wasm-service'),
        storagePaths: require('../common/storage-paths')
    };
}

function resolveToken(flags, settings) {
    const fromFlag = typeof flags.token === 'string' ? flags.token.trim() : '';
    if (fromFlag) return fromFlag;

    const fromEnv = String(process.env.SNH48_TOKEN || process.env.POCKET48_TOKEN || '').trim();
    if (fromEnv) return fromEnv;

    return settings.getToken();
}

async function createContext({ command, flags }) {
    redirectConsoleToStderr({ verbose: flags.verbose === true });

    const services = loadServices();
    const format = resolveFormat(flags);

    const context = {
        command,
        flags,
        format,
        raw: flags.raw === true,
        services,
        pocket: services.pocket,
        settings: services.settings,
        token: resolveToken(flags, services.settings),
        pa: null,
        cacheDir: resolveCacheDir(services.storagePaths)
    };

    context.requireToken = () => {
        if (!context.token) {
            throw new CliError('尚未登录，缺少口袋 48 Token', {
                hint: '运行 `snh48 login sms <手机号>` 与 `snh48 login code <手机号> <验证码>`，或用 `snh48 login token <token>` / 环境变量 SNH48_TOKEN 直接注入。'
            });
        }
        return context.token;
    };

    // 每次调用都重新生成 pa（签名带时间戳，复用会被服务端拒绝）。
    context.auth = async () => {
        const token = context.requireToken();
        await services.wasm.ensureWasmLoaded();
        return { token, pa: services.wasm.generatePa() };
    };

    return context;
}

function resolveCacheDir(storagePaths) {
    const override = String(process.env.SNH48_CACHE_DIR || '').trim();
    const dir = override || storagePaths.getStoragePaths().internalDataDir;
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// pocket-service 的返回值有三种形状：{success, content}、{success, data}、以及裸响应体。
function unwrap(result, fallbackMessage = '接口调用失败') {
    if (!result || typeof result !== 'object') {
        throw new CliError(fallbackMessage);
    }

    if (result.success === false) {
        throw new CliError(result.msg || result.message || fallbackMessage, { data: result.data });
    }

    if (Object.prototype.hasOwnProperty.call(result, 'content') && result.content !== undefined) {
        return result.content;
    }

    if (Object.prototype.hasOwnProperty.call(result, 'data') && result.data !== undefined) {
        return result.data;
    }

    return result;
}

function readJsonCache(cacheDir, name, ttlSeconds) {
    if (!(ttlSeconds > 0)) return null;

    const file = path.join(cacheDir, name);
    try {
        const stats = fs.statSync(file);
        const ageSeconds = (Date.now() - stats.mtimeMs) / 1000;
        if (ageSeconds > ttlSeconds) return null;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        return null;
    }
}

function writeJsonCache(cacheDir, name, value) {
    const file = path.join(cacheDir, name);
    try {
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(`${file}.tmp`, JSON.stringify(value), 'utf8');
        fs.renameSync(`${file}.tmp`, file);
    } catch (error) {
        // 缓存写失败不影响命令本身。
    }
}

module.exports = {
    createContext,
    unwrap,
    readJsonCache,
    writeJsonCache
};
