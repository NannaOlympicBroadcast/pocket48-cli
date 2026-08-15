// 把 `snh48` CLI 当成子进程驱动。
//
// 为什么不 in-process require：CLI 会重定向全局 console、加载 wasm、写 process.exitCode。
// harness 是长驻进程，这些副作用不该渗进去。子进程还顺带给了超时与 AbortSignal 取消。

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const CLI_ENTRY = fileURLToPath(new URL('../bin/snh48.js', import.meta.url))

export class Snh48Error extends Error {
    constructor(message, { hint = '', command = '' } = {}) {
        super(hint ? `${message}（提示：${hint}）` : message)
        this.name = 'Snh48Error'
        this.hint = hint
        this.command = command
    }
}

/**
 * 跑一条 snh48 子命令，返回信封里的 `data`。
 *
 * @param {string[]} argv     子命令与参数，例如 ['room', 'messages', '杨冰怡']
 * @param {object}   options
 * @param {AbortSignal} [options.signal]  取消信号（harness 会在工具调用被中断时传进来）
 * @param {number}   [options.timeoutMs]  超时毫秒数，默认 120000
 * @param {string}   [options.token]      本次调用使用的口袋 Token
 * @returns {Promise<unknown>} 信封的 data 字段
 */
export async function runSnh48(argv, { signal, timeoutMs = 120_000, token = '' } = {}) {
    const args = [CLI_ENTRY, ...argv, '--json']
    if (token) args.push('--token', token)

    const { stdout, stderr, code } = await spawnCli(args, { signal, timeoutMs })

    let envelope
    try {
        envelope = JSON.parse(stdout)
    } catch {
        // 拿不到信封说明 CLI 在写 stdout 之前就崩了，stderr 才是有用的那半边。
        const detail = stderr.trim() || stdout.trim() || `退出码 ${code}`
        throw new Snh48Error(`snh48 输出不是合法 JSON：${truncate(detail, 500)}`, {
            command: argv.join(' '),
        })
    }

    if (!envelope || envelope.ok !== true) {
        throw new Snh48Error(envelope?.error || '命令执行失败', {
            hint: envelope?.hint || '',
            command: envelope?.command || argv.join(' '),
        })
    }

    return envelope.data
}

function spawnCli(args, { signal, timeoutMs }) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Snh48Error('调用已取消'))
            return
        }

        const child = spawn(process.execPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            // 非 TTY 下 CLI 默认就吐 JSON；显式 --json 已经加了，这里只是不继承终端。
            env: { ...process.env },
        })

        let stdout = ''
        let stderr = ''
        let settled = false

        // stderr 只留尾部：--verbose 下日志可能很长，没必要全存在内存里。
        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', (chunk) => { stdout += chunk })
        child.stderr.on('data', (chunk) => { stderr = truncate(stderr + chunk, 8000) })

        const finish = (fn) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            signal?.removeEventListener('abort', onAbort)
            fn()
        }

        const onAbort = () => {
            child.kill('SIGTERM')
            finish(() => reject(new Snh48Error('调用已取消')))
        }

        const timer = setTimeout(() => {
            child.kill('SIGTERM')
            finish(() => reject(new Snh48Error(`snh48 执行超时（${Math.round(timeoutMs / 1000)}s）`, {
                hint: '抓取量大时可以调小 limit/scan，或把 timeoutMs 调大。',
            })))
        }, timeoutMs)

        signal?.addEventListener('abort', onAbort, { once: true })

        child.on('error', (error) => finish(() => reject(new Snh48Error(
            `无法启动 snh48：${error.message}`,
            { hint: '确认插件目录下已执行 `npm install --omit=dev`。' },
        ))))

        child.on('close', (code) => finish(() => resolve({ stdout, stderr, code })))
    })
}

function truncate(text, max) {
    return text.length > max ? `${text.slice(0, max)}…` : text
}
