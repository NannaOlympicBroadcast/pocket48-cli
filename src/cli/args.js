// 极简参数解析：只认已声明的布尔开关，其余 --key 一律吃掉下一个 token 作为值。
// 这样 `snh48 --json room messages 牙牙` 不会把 `room` 误当成 --json 的值。

const BOOLEAN_FLAGS = new Set([
    'json',
    'text',
    'all',
    'refresh',
    'record',
    'debug',
    'raw',
    'verbose',
    'help',
    'version',
    'no-color',
    'allow-write'
]);

function parseArgs(argv) {
    const positionals = [];
    const flags = {};

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];

        if (token === '--') {
            positionals.push(...argv.slice(index + 1));
            break;
        }

        if (token === '-h') {
            flags.help = true;
            continue;
        }

        if (token === '-v') {
            flags.version = true;
            continue;
        }

        if (!token.startsWith('--')) {
            positionals.push(token);
            continue;
        }

        const body = token.slice(2);
        const equalsIndex = body.indexOf('=');

        if (equalsIndex >= 0) {
            flags[body.slice(0, equalsIndex)] = body.slice(equalsIndex + 1);
            continue;
        }

        if (BOOLEAN_FLAGS.has(body)) {
            flags[body] = true;
            continue;
        }

        const next = argv[index + 1];
        if (next === undefined) {
            flags[body] = true;
            continue;
        }

        flags[body] = next;
        index += 1;
    }

    return { positionals, flags };
}

function flagNumber(flags, name, fallback) {
    if (!Object.prototype.hasOwnProperty.call(flags, name)) {
        return fallback;
    }

    const parsed = Number(flags[name]);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function flagString(flags, name, fallback = '') {
    const value = flags[name];
    if (value === undefined || value === true) {
        return fallback;
    }
    return String(value);
}

module.exports = {
    BOOLEAN_FLAGS,
    parseArgs,
    flagNumber,
    flagString
};
