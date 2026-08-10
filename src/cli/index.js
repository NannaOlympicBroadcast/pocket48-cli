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
