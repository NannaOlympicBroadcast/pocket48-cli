// 输出层：管道/`--json` 走 JSON 信封，TTY 走人类可读文本。

class CliError extends Error {
    constructor(message, { code = 1, hint = '', data = null } = {}) {
        super(message);
        this.name = 'CliError';
        this.code = code;
        this.hint = hint;
        this.data = data;
    }
}

function resolveFormat(flags = {}) {
    if (flags.json) return 'json';
    if (flags.text) return 'text';
    return process.stdout.isTTY ? 'text' : 'json';
}

function writeStdout(text) {
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

function emit(context, data, renderText) {
    if (context.format === 'json') {
        writeStdout(JSON.stringify({ ok: true, command: context.command, data }, null, context.raw ? 0 : 2));
        return;
    }

    const rendered = typeof renderText === 'function' ? renderText(data) : renderText;
    if (rendered === undefined || rendered === null || rendered === '') {
        writeStdout(JSON.stringify(data, null, 2));
        return;
    }

    writeStdout(String(rendered));
}

function emitError(context, error) {
    const message = error instanceof Error ? error.message : String(error);
    const hint = error && error.hint ? String(error.hint) : '';

    if (context.format === 'json') {
        writeStdout(JSON.stringify({
            ok: false,
            command: context.command,
            error: message,
            hint: hint || undefined,
            data: (error && error.data) || undefined
        }, null, 2));
        return;
    }

    process.stderr.write(`错误：${message}\n`);
    if (hint) {
        process.stderr.write(`提示：${hint}\n`);
    }
}

function displayWidth(value) {
    // CJK 字符在等宽终端里占两列，按 2 计宽表格才不会错位。
    let width = 0;
    for (const char of String(value)) {
        const code = char.codePointAt(0);
        const isWide = (code >= 0x1100 && code <= 0x115f)
            || (code >= 0x2e80 && code <= 0xa4cf)
            || (code >= 0xac00 && code <= 0xd7a3)
            || (code >= 0xf900 && code <= 0xfaff)
            || (code >= 0xfe30 && code <= 0xfe6f)
            || (code >= 0xff00 && code <= 0xff60)
            || (code >= 0xffe0 && code <= 0xffe6)
            || (code >= 0x1f300 && code <= 0x1f9ff);
        width += isWide ? 2 : 1;
    }
    return width;
}

function padCell(value, width) {
    const text = String(value ?? '');
    return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}

function table(rows, columns) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return '（无数据）';
    }

    const specs = columns.map((column) => (typeof column === 'string' ? { key: column, label: column } : column));
    const widths = specs.map((spec) => Math.max(
        displayWidth(spec.label),
        ...rows.map((row) => displayWidth(formatCell(row, spec)))
    ));

    const header = specs.map((spec, index) => padCell(spec.label, widths[index])).join('  ');
    const divider = widths.map((width) => '─'.repeat(width)).join('  ');
    const body = rows.map((row) => specs
        .map((spec, index) => padCell(formatCell(row, spec), widths[index]))
        .join('  '));

    return [header, divider, ...body].join('\n');
}

function formatCell(row, spec) {
    const raw = typeof spec.value === 'function' ? spec.value(row) : row[spec.key];
    const text = raw === undefined || raw === null ? '' : String(raw);
    const collapsed = text.replace(/\s+/g, ' ').trim();
    if (spec.max && displayWidth(collapsed) > spec.max) {
        return `${truncate(collapsed, spec.max - 1)}…`;
    }
    return collapsed;
}

function truncate(value, max) {
    let width = 0;
    let output = '';
    for (const char of String(value)) {
        width += displayWidth(char);
        if (width > max) break;
        output += char;
    }
    return output;
}

function formatTimestamp(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return '';
    }
    // 口袋接口混用秒与毫秒。
    const millis = numeric < 1e12 ? numeric * 1000 : numeric;
    const date = new Date(millis);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    const pad = (input) => String(input).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
        + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

module.exports = {
    CliError,
    resolveFormat,
    emit,
    emitError,
    table,
    formatTimestamp,
    displayWidth,
    truncate
};
