// 交互式输入。提示语一律走 stderr，保证 stdout 只有最终结果（JSON 或表格）。

const readline = require('readline');

const { CliError } = require('./output');

function isInteractive() {
    return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

function requireInteractive(commandHint) {
    if (isInteractive()) return;
    throw new CliError('当前不是交互式终端，无法读取输入', {
        hint: `改用可脚本化的命令：${commandHint}`
    });
}

function createInterface() {
    return readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
}

function ask(question, { mask = false } = {}) {
    const rl = createInterface();

    return new Promise((resolve, reject) => {
        rl.question(question, (answer) => {
            if (mask) process.stderr.write('\n');
            rl.close();
            resolve(String(answer || '').trim());
        });

        rl.on('SIGINT', () => {
            rl.close();
            process.stderr.write('\n');
            reject(new CliError('已取消', { code: 130 }));
        });

        if (!mask) return;

        // 屏蔽回显：readline 写提示语之后，把后续输出吞掉。
        let promptWritten = false;
        rl._writeToOutput = (chunk) => {
            if (!promptWritten) {
                rl.output.write(question);
                promptWritten = true;
                return;
            }
            if (String(chunk).includes('\n')) rl.output.write('');
        };
    });
}

async function askRequired(question, { mask = false, validate } = {}) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const answer = await ask(question, { mask });
        if (!answer) {
            process.stderr.write('不能为空，请重新输入。\n');
            continue;
        }
        if (validate) {
            const problem = validate(answer);
            if (problem) {
                process.stderr.write(`${problem}\n`);
                continue;
            }
        }
        return answer;
    }

    throw new CliError('连续三次输入无效，已中止');
}

async function askChoice(question, options) {
    const lines = options.map((option, index) => `  ${index + 1}) ${option}`);
    process.stderr.write(`${question}\n${lines.join('\n')}\n`);

    const answer = await askRequired('请输入序号：', {
        validate: (value) => {
            const index = Number(value);
            return Number.isInteger(index) && index >= 1 && index <= options.length
                ? ''
                : `请输入 1 到 ${options.length} 之间的序号`;
        }
    });

    return { index: Number(answer) - 1, value: options[Number(answer) - 1] };
}

function status(message) {
    process.stderr.write(`${message}\n`);
}

module.exports = {
    isInteractive,
    requireInteractive,
    ask,
    askRequired,
    askChoice,
    status
};
