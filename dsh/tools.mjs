// snh48 的 DSH 工具集。
//
// CLI 有 60 多条子命令，全量注册会把模型的工具列表撑爆，所以这里按领域收敛成
// 九个工具：八个覆盖高频只读链路，外加一个受限的逃生舱 `snh48_run`。

import { defineTool } from '@deepseek-ai/dsh-tools'

import { runSnh48 } from './runner.mjs'
import { formatJson, formatMessages, formatRoster, formatShows } from './format.mjs'

// 会花钱、对外产生真实动作或改动凭据的子命令。默认一律拒绝，
// 只有 profile 里显式打开 allowWrites 才放行——模型不该替用户送礼/发私信/翻牌。
const WRITE_COMMANDS = [
    'flip ask',
    'flip delete',
    'dm send',
    'live send-gift',
    'member follow',
    'member unfollow',
    'checkin',
    'account switch',
    'login',
    'logout',
    // api 是 CLI 直连口袋接口的逃生舱，能打到任意写接口，按写操作对待。
    'api',
]

// 交互式命令在子进程里必然失败（CLI 自己会报「当前不是交互式终端」），
// 与其让模型撞一次墙，不如在这里就说清楚该怎么办。
const INTERACTIVE_HINT = '短信验证码只会发到用户手机上，必须由用户自己在终端执行 `snh48 login`。'

export function createTools(config) {
    const call = (argv, options = {}) => runSnh48(argv, {
        token: config.token,
        timeoutMs: config.timeoutMs,
        signal: options.signal,
    })

    return [
        defineTool({
            name: 'snh48_roster',
            description: '检索 SNH48 GROUP 成员名册：按姓名/拼音/昵称搜索，或按团体、队伍、期数筛选。'
                + '返回姓名、昵称、团体、队伍、期数、生日与 memberId。免登录。',
            parameters: {
                search: { type: 'string', description: '姓名、昵称、拼音或缩写；留空则列出全部' },
                group: { type: 'string', description: '团体：SNH48 / BEJ48 / GNZ48 / CKG48 / CGT48' },
                team: { type: 'string', description: '队伍代号，例如 X、SII、NII、HII' },
                generation: { type: 'string', description: '期数，例如「四期」' },
                limit: { type: 'number', description: '返回条数上限，默认 30' },
                includeGraduated: { type: 'boolean', description: '是否包含毕业成员，默认 false' },
            },
            output: {
                schema: { type: 'string' },
                render: renderText,
            },
            async execute(args, options) {
                const argv = ['roster']
                pushFlag(argv, 'search', args.search)
                pushFlag(argv, 'group', args.group)
                pushFlag(argv, 'team', args.team)
                pushFlag(argv, 'generation', args.generation)
                pushFlag(argv, 'limit', args.limit ?? 30)
                if (args.includeGraduated) argv.push('--all')
                return formatRoster(await call(argv, options))
            },
        }),

        defineTool({
            name: 'snh48_member',
            description: '查询单个成员的资料。mode=info 取档案（队伍/期数/生日/身高/口号），'
                + 'photos 取公式照，history 取历史动态，lives 取直播记录。'
                + '成员可用中文名、昵称、拼音或 memberId。info 免登录，其余需要口袋 Token。',
            parameters: {
                member: { type: 'string', required: true, description: '成员：中文名、昵称、拼音或 memberId' },
                mode: { type: 'string', description: 'info（默认）| photos | history | lives' },
                limit: { type: 'number', description: '返回条数上限，默认 20' },
            },
            output: {
                schema: { type: 'string' },
                render: renderText,
            },
            async execute(args, options) {
                const mode = pickMode(args.mode, ['info', 'photos', 'history', 'lives'], 'info')
                const argv = ['member', mode, args.member]
                if (mode !== 'info') pushFlag(argv, 'limit', args.limit ?? 20)
                return formatJson(await call(argv, options))
            },
        }),

        defineTool({
            name: 'snh48_room',
            description: '读取成员的口袋 48 房间。mode=messages 抓最新消息，search 按关键词检索历史消息，'
                + 'stats 统计消息条数，album 取房间相册，radio 取上麦地址。需要口袋 Token。',
            parameters: {
                member: { type: 'string', required: true, description: '成员：中文名、昵称、拼音或 memberId' },
                mode: { type: 'string', description: 'messages（默认）| search | stats | album | radio' },
                keyword: { type: 'string', description: 'mode=search 时的检索关键词' },
                limit: { type: 'number', description: 'messages 抓取条数，默认 30' },
                scan: { type: 'number', description: 'search 先抓多少条再本地过滤，默认 500；查久远历史就调大' },
                includeOthers: { type: 'boolean', description: '是否连房间里其他人的消息一起抓，默认 false（只抓成员本人）' },
            },
            output: {
                schema: { type: 'string' },
                render: renderText,
            },
            async execute(args, options) {
                const mode = pickMode(args.mode, ['messages', 'search', 'stats', 'album', 'radio'], 'messages')

                if (mode === 'search' && !String(args.keyword || '').trim()) {
                    throw new Error('mode=search 需要提供 keyword')
                }

                const argv = ['room', mode, args.member]
                if (mode === 'search') {
                    argv.push(args.keyword)
                    pushFlag(argv, 'scan', args.scan ?? 500)
                }
                if (mode === 'messages') {
                    pushFlag(argv, 'limit', args.limit ?? 30)
                    if (args.includeOthers) argv.push('--all')
                }
                if (mode === 'stats') pushFlag(argv, 'scan', args.scan ?? 500)

                const data = await call(argv, options)
                return mode === 'messages' || mode === 'search' ? formatMessages(data) : formatJson(data)
            },
        }),

        defineTool({
            name: 'snh48_live',
            description: '口袋 48 直播。mode=list 列出正在直播的成员，replay 取某成员的直播回放，'
                + 'info 取某场直播的详情与播放地址。需要口袋 Token。',
            parameters: {
                mode: { type: 'string', description: 'list（默认）| replay | info' },
                member: { type: 'string', description: 'mode=replay 时的成员' },
                liveId: { type: 'string', description: 'mode=info 时的直播 ID' },
                limit: { type: 'number', description: 'replay 返回条数，默认 10' },
            },
            output: {
                schema: { type: 'string' },
                render: renderText,
            },
            async execute(args, options) {
                const mode = pickMode(args.mode, ['list', 'replay', 'info'], 'list')

                if (mode === 'replay' && !String(args.member || '').trim()) {
                    throw new Error('mode=replay 需要提供 member')
                }
                if (mode === 'info' && !String(args.liveId || '').trim()) {
                    throw new Error('mode=info 需要提供 liveId')
                }

                const argv = ['live', mode]
                if (mode === 'replay') {
                    argv.push(args.member)
                    pushFlag(argv, 'limit', args.limit ?? 10)
                }
                if (mode === 'info') argv.push(args.liveId)

                return formatJson(await call(argv, options))
            },
        }),

        defineTool({
            name: 'snh48_shows',
            description: '近期公演场次与票务状态（VIP票有售/普通票有售/售罄）及购票链接。'
                + 'mode=plan 给按天合并的日程摘要，含参演成员与地址。免登录。',
            parameters: {
                group: { type: 'string', description: '团体：SNH48（默认）/ BEJ48 / GNZ48 / CKG48 / CGT48' },
                days: { type: 'number', description: '往后看几天，默认 7' },
                mode: { type: 'string', description: 'shows（默认，含票务）| plan（日程摘要）' },
            },
            output: {
                schema: { type: 'string' },
                render: renderText,
            },
            async execute(args, options) {
                const mode = pickMode(args.mode, ['shows', 'plan'], 'shows')
                const argv = [mode]
                pushFlag(argv, 'group', args.group || 'SNH48')
                pushFlag(argv, 'days', args.days ?? 7)
                return formatShows(await call(argv, options))
            },
        }),

        defineTool({
            name: 'snh48_rank',
            description: '鸡腿榜单。mode=week 周榜，list 总榜，year 年榜，member 取某成员的粉丝贡献榜。'
                + '需要口袋 Token。',
            parameters: {
                mode: { type: 'string', description: 'week（默认）| list | year | member' },
                member: { type: 'string', description: 'mode=member 时的成员' },
            },
            output: {
                schema: { type: 'string' },
                render: renderText,
            },
            async execute(args, options) {
                const mode = pickMode(args.mode, ['week', 'list', 'year', 'member'], 'week')
                if (mode === 'member' && !String(args.member || '').trim()) {
                    throw new Error('mode=member 需要提供 member')
                }
                const argv = ['rank', mode]
                if (mode === 'member') argv.push(args.member)
                return formatJson(await call(argv, options))
            },
        }),

        defineTool({
            name: 'snh48_feed',
            description: '成员的对外动态。mode=dynamic 取口袋动态，weibo 取微博。需要口袋 Token。',
            parameters: {
                member: { type: 'string', required: true, description: '成员：中文名、昵称、拼音或 memberId' },
                mode: { type: 'string', description: 'dynamic（默认）| weibo' },
                limit: { type: 'number', description: '返回条数上限，默认 20' },
            },
            output: {
                schema: { type: 'string' },
                render: renderText,
            },
            async execute(args, options) {
                const mode = pickMode(args.mode, ['dynamic', 'weibo'], 'dynamic')
                const argv = [mode, args.member]
                pushFlag(argv, 'limit', args.limit ?? 20)
                return formatMessages(await call(argv, options))
            },
        }),

        defineTool({
            name: 'snh48_login',
            description: '登录与凭据管理。mode=status（默认）查看口袋 48 与 live.48.cn 两套凭据的状态——'
                + '任何命令报「尚未登录」时先调这个，不要盲目重试。'
                + 'mode=token 注入已有 Token；sms 发送短信验证码；code 用验证码换 Token；'
                + 'qr 扫码登录 live.48.cn（只给公演直播源，不产生口袋 Token）；logout 清除凭据。'
                + '注意口袋 Token 与 live.48.cn 是两套互不相通的凭据。',
            parameters: {
                mode: { type: 'string', description: 'status（默认）| token | sms | code | qr | logout' },
                token: { type: 'string', description: 'mode=token 时要注入的口袋 Token' },
                phone: { type: 'string', description: 'mode=sms / code 时的手机号' },
                code: { type: 'string', description: 'mode=code 时的短信验证码' },
                answer: { type: 'string', description: 'mode=sms 遇到图形验证时的答案（题目与候选在上一次的报错 hint 里）' },
                timeoutSeconds: { type: 'number', description: 'mode=qr 等待扫码的秒数，默认 300' },
                all: { type: 'boolean', description: 'mode=logout 时是否连 live.48.cn 一起清除，默认 false' },
            },
            output: {
                schema: { type: 'string' },
                render: renderText,
            },
            async execute(args, options) {
                const mode = pickMode(args.mode, ['status', 'token', 'sms', 'code', 'qr', 'logout'], 'status')
                const need = (value, label) => {
                    const text = String(value || '').trim()
                    if (!text) throw new Error(`mode=${mode} 需要提供 ${label}`)
                    return text
                }

                if (mode === 'status') {
                    return `${formatJson(await call(['login', 'status'], options))}\n\n`
                        + `注意：这是两套互不相通的凭据。扫码登录只给 live.48.cn（公演直播源），不产生口袋 Token；`
                        + `房间消息、私信、直播、翻牌等仍需短信登录。${INTERACTIVE_HINT}`
                }

                if (mode === 'logout') {
                    const argv = ['logout']
                    if (args.all) argv.push('--all')
                    return formatJson(await call(argv, options))
                }

                if (mode === 'token') {
                    // CLI 会先拿这个 Token 打一次接口校验，失败不会落盘。
                    return formatJson(await call(['login', 'token', need(args.token, 'token')], options))
                }

                if (mode === 'sms') {
                    const argv = ['login', 'sms', need(args.phone, 'phone')]
                    pushFlag(argv, 'answer', args.answer)
                    return `${formatJson(await call(argv, options))}\n\n`
                        + `验证码已发往用户手机。拿到验证码后用 mode=code 完成登录——`
                        + `你无法自己读取验证码，必须由用户口述。`
                }

                if (mode === 'code') {
                    const argv = ['login', 'code', need(args.phone, 'phone'), need(args.code, 'code')]
                    return formatJson(await call(argv, options))
                }

                // qr：CLI 默认等 300 秒，子进程超时必须留出富余，否则会先被 runner 杀掉。
                const waitSeconds = Number(args.timeoutSeconds) > 0 ? Math.floor(Number(args.timeoutSeconds)) : 300
                const argv = ['login', 'qr', '--timeout', String(waitSeconds)]
                const data = await runSnh48(argv, {
                    token: config.token,
                    timeoutMs: (waitSeconds + 30) * 1000,
                    signal: options?.signal,
                })
                return `${formatJson(data)}\n\n`
                    + `非交互环境下二维码会存成 PNG，路径在上面的返回里；把它交给用户去扫。`
                    + `扫码只登录 live.48.cn，口袋功能仍需短信登录。`
            },
        }),

        defineTool({
            name: 'snh48_run',
            description: '逃生舱：执行上面八个工具没覆盖到的 snh48 只读子命令，'
                + '例如 `dm list`、`area newest`、`trip 杨冰怡`、`account money`、`albums`。'
                + '先用 `help` 查可用命令。写操作（送礼、发私信、翻牌、关注、签到、直连 api）默认被拒绝。',
            parameters: {
                command: {
                    type: 'string',
                    required: true,
                    description: '完整子命令与参数，不含 `snh48` 前缀与 --json，例如 `area newest --limit 10`',
                },
            },
            output: {
                schema: { type: 'string' },
                render: renderText,
            },
            async execute(args, options) {
                const argv = tokenize(String(args.command || ''))
                if (argv.length === 0) throw new Error('command 不能为空')

                const blocked = matchWriteCommand(argv)
                if (blocked === 'login' || blocked === 'logout') {
                    // 登录有专门的工具，它处理了二维码超时、验证码分步这些细节。
                    throw new Error(`\`${blocked}\` 请改用 snh48_login 工具。${INTERACTIVE_HINT}`)
                }
                if (blocked && !config.allowWrites) {
                    throw new Error(
                        `\`${blocked}\` 会花钱或对外产生真实动作，已被拒绝。`
                        + `确需放行时在 profile 里给本插件配置 allowWrites: true。`,
                    )
                }

                return formatJson(await call(argv, options))
            },
        }),
    ]
}

function renderText(_args, value) {
    return [{ type: 'text', text: String(value) }]
}

function pushFlag(argv, name, value) {
    if (value === undefined || value === null || value === '') return
    argv.push(`--${name}`, String(value))
}

function pickMode(value, allowed, fallback) {
    const mode = String(value || '').trim() || fallback
    if (!allowed.includes(mode)) {
        throw new Error(`mode 只能是 ${allowed.join(' / ')}，收到「${mode}」`)
    }
    return mode
}

// 子命令名最长两段，与 CLI 的 matchCommand 保持一致。
function matchWriteCommand(argv) {
    const two = argv.slice(0, 2).join(' ')
    const one = argv[0]
    return WRITE_COMMANDS.find((entry) => entry === two || entry === one) || null
}

// 简易分词：认单引号与双引号，够应付「room search 杨冰怡 "生日 快乐"」这类参数。
// 走的是 spawn 的 argv 数组，不经过 shell，所以这里不存在注入面。
function tokenize(input) {
    const tokens = []
    let current = ''
    let quote = null
    let started = false

    for (const char of input.trim()) {
        if (quote) {
            if (char === quote) quote = null
            else current += char
            continue
        }
        if (char === '"' || char === "'") {
            quote = char
            started = true
            continue
        }
        if (/\s/.test(char)) {
            if (started) tokens.push(current)
            current = ''
            started = false
            continue
        }
        current += char
        started = true
    }

    if (started) tokens.push(current)
    // --json 由 runner 统一追加，模型手写的重复项在这里剔掉。
    return tokens.filter((token) => token !== '--json')
}
