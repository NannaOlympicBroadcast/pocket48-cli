// 把 CLI 信封里的 data 压成适合喂给模型的文本。
//
// 口袋接口的原始 JSON 很胖（一条消息能带十几个用不上的字段），直接塞进上下文是浪费。
// 这里对已知形状做紧凑渲染，其余退回到裁剪过的 JSON。

const MAX_JSON_CHARS = 12_000

export function formatMessages(data) {
    const list = pickArray(data, ['messages'])
    if (!list) return formatJson(data)

    const header = describeCount(data, list.length, '条消息')
    const lines = list.map((item) => {
        const time = formatTime(item.time)
        const who = item.senderName || item.senderId || ''
        const kind = item.typeLabel && item.type !== 'TEXT' ? `[${item.typeLabel}] ` : ''
        const body = collapse(item.text || '')
        const media = item.media ? `\n    ${item.media}` : ''
        return `- ${time} ${who}：${kind}${body}${media}`
    })

    return [header, ...lines].join('\n')
}

export function formatRoster(data) {
    const list = pickArray(data, ['members'])
    if (!list) return formatJson(data)

    const header = describeCount(data, list.length, '位成员')
    const lines = list.map((item) => {
        const parts = [
            item.name,
            item.nickname ? `（${item.nickname}）` : '',
            '  ',
            [item.group, item.team && `Team ${item.team}`, item.generation].filter(Boolean).join(' / '),
        ].join('')
        const extra = [
            item.birthday && `生日 ${item.birthday}`,
            item.graduateDay && `已毕业 ${item.graduateDay}`,
            item.memberId && `id ${item.memberId}`,
        ].filter(Boolean).join('  ')
        return `- ${parts}${extra ? `\n    ${extra}` : ''}`
    })

    return [header, ...lines].join('\n')
}

export function formatShows(data) {
    const list = pickArray(data, ['shows', 'plan'])
    if (!list) return formatJson(data)

    const header = describeCount(data, list.length, '场公演')
    const lines = list.map((item) => {
        const when = [item.year, item.date, item.time || item.clock1].filter(Boolean).join(' ')
        const what = [item.team, item.theme || item.title].filter(Boolean).join(' · ')
        const where = item.venue ? `@${item.venue}` : ''
        const ticket = item.ticketStatus ? `  票务：${item.ticketStatus}` : ''
        const note = item.special ? `  备注：${item.special}` : ''
        return `- ${when}  ${what} ${where}${ticket}${note}`.trimEnd()
    })

    return [header, ...lines].join('\n')
}

// 兜底：裁掉超长字符串与超长数组后再 stringify，避免一次工具调用吃掉半个上下文。
export function formatJson(data) {
    const text = JSON.stringify(clip(data), null, 2)
    if (text === undefined) return String(data)
    return text.length > MAX_JSON_CHARS
        ? `${text.slice(0, MAX_JSON_CHARS)}\n…（输出已截断，缩小 limit/scan 可拿到完整结果）`
        : text
}

function clip(value, depth = 0) {
    if (typeof value === 'string') {
        return value.length > 600 ? `${value.slice(0, 600)}…` : value
    }
    if (Array.isArray(value)) {
        const head = value.slice(0, 80).map((item) => clip(item, depth + 1))
        return value.length > 80 ? [...head, `…（另有 ${value.length - 80} 条）`] : head
    }
    if (value && typeof value === 'object') {
        if (depth > 6) return '…'
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clip(item, depth + 1)]))
    }
    return value
}

function pickArray(data, keys) {
    if (!data || typeof data !== 'object') return null
    for (const key of keys) {
        if (Array.isArray(data[key])) return data[key]
    }
    return null
}

function describeCount(data, shown, unit) {
    const total = Number(data?.total)
    return Number.isFinite(total) && total !== shown
        ? `共 ${total} ${unit}，以下 ${shown} 条：`
        : `共 ${shown} ${unit}：`
}

function collapse(text) {
    return String(text).replace(/\s+/g, ' ').trim()
}

// 口袋接口秒/毫秒混用，跟 CLI 的输出层保持同一套判断。
function formatTime(value) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) return '?'
    const date = new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    if (Number.isNaN(date.getTime())) return '?'
    const pad = (input) => String(input).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
        + `${pad(date.getHours())}:${pad(date.getMinutes())}`
}
