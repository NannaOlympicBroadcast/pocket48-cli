// snh48 CLI 入口：把牙牙消息的口袋 48 能力拆成可脚本化的子命令。

const { parseArgs } = require('./args');
const { CliError, emitError, resolveFormat } = require('./output');
const { createContext } = require('./runtime');
const { renderHelp, HELP_TOPICS } = require('./help');

const VERSION = require('../../package.json').version;

const COMMANDS = {
    ...require('./commands/auth').commands,
    ...require('./commands/member').commands,
    ...require('./commands/room').commands,
    ...require('./commands/live').commands,
    ...require('./commands/feed').commands,
    ...require('./commands/data').commands
};

// 会改动账号状态、发出内容或消耗鸡腿/星币的命令。
// 登录类不算在内——不登录整个工具都用不了。
const WRITE_COMMANDS = new Set([
    'checkin',
    'account switch',
    'member follow',
    'member unfollow',
    'dm send',
    'flip ask',
    'flip delete',
    'live send-gift'
]);

// 作为插件安装时默认只读：CLAUDE_PLUGIN_ROOT 由插件运行时注入子进程，
// 以此判断「这是别人从 marketplace 装来的」，避免代理误触发付费/发送类操作。
function isReadonly(flags) {
    if (flags['allow-write'] === true || process.env.SNH48_ALLOW_WRITE === '1') return false;
    if (process.env.SNH48_READONLY === '1') return true;
    return Boolean(process.env.CLAUDE_PLUGIN_ROOT);
}

// 子命令名最长两段（如 `room messages`），先长后短匹配。
function matchCommand(positionals) {
    for (let depth = Math.min(2, positionals.length); depth >= 1; depth -= 1) {
        const name = positionals.slice(0, depth).join(' ');
        if (COMMANDS[name]) {
            return { name, handler: COMMANDS[name], rest: positionals.slice(depth) };
        }
    }
    return null;
}

async function run(argv) {
    const { positionals, flags } = parseArgs(argv);

    if (flags.version) {
        process.stdout.write(`snh48 ${VERSION}\n`);
        return 0;
    }

    if (positionals.length === 0 || positionals[0] === 'help' || flags.help) {
        const topic = positionals[0] === 'help' ? positionals.slice(1).join(' ') : positionals.join(' ');

        if (resolveFormat(flags) === 'json') {
            const entries = Object.entries(HELP_TOPICS)
                // 带主题时按分组名或命令前缀过滤，与文本模式保持一致。
                .filter(([group]) => !topic || group === topic)
                .map(([group, commands]) => [group, commands
                    .filter(([usage]) => !topic || group === topic || usage.startsWith(topic))
                    .map(([usage, description]) => ({ usage, description }))])
                .filter(([, commands]) => commands.length > 0);

            const groups = Object.fromEntries(entries.length > 0
                ? entries
                : Object.entries(HELP_TOPICS).map(([group, commands]) => [group, commands
                    .filter(([usage]) => usage.startsWith(topic))
                    .map(([usage, description]) => ({ usage, description }))])
                    .filter(([, commands]) => commands.length > 0));

            process.stdout.write(`${JSON.stringify({ ok: true, command: 'help', data: { version: VERSION, topic: topic || null, groups } }, null, 2)}\n`);
            return 0;
        }

        process.stdout.write(`${renderHelp(topic)}\n`);
        return 0;
    }

    const matched = matchCommand(positionals);
    if (!matched) {
        const attempted = positionals.slice(0, 2).join(' ');
        process.stderr.write(`未知命令：${attempted}\n\n${renderHelp(positionals[0])}\n`);
        return 127;
    }

    // 上下文创建前先算好输出格式，早期报错也要遵守 --json。
    let context = { command: matched.name, format: resolveFormat(flags), raw: flags.raw === true };

    if (WRITE_COMMANDS.has(matched.name) && isReadonly(flags)) {
        emitError(context, new CliError(`只读模式下不允许执行「${matched.name}」`, {
            hint: '该命令会改动账号状态或消耗鸡腿/星币。确需执行时加 --allow-write，或设置环境变量 SNH48_ALLOW_WRITE=1。'
        }));
        return 1;
    }

    try {
        context = await createContext({ command: matched.name, flags });
        await matched.handler(context, matched.rest);
        return 0;
    } catch (error) {
        emitError(context, error);
        return error instanceof CliError ? error.code : 1;
    }
}

module.exports = { run, COMMANDS, HELP_TOPICS, VERSION };
