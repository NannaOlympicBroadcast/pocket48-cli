// 消息类：房间消息抓取/检索、房间相册、房间上麦、口袋私信。

const { CliError, emit, table, formatTimestamp, truncate } = require('../output');
const { unwrap } = require('../runtime');
const { flagNumber, flagString } = require('../args');
const { loadRoster, resolveRoom, resolveMember } = require('../roster');
const { normalizeMessage, extractMessageList } = require('../messages');

const MESSAGE_COLUMNS = [
    { label: '时间', value: (row) => formatTimestamp(row.time) },
    { key: 'typeLabel', label: '类型' },
    { key: 'senderName', label: '发送者', max: 12 },
    { key: 'text', label: '内容', max: 60 }
];

async function roomList(context) {
    const members = await loadRoster(context, { refresh: context.flags.refresh === true });
    const rows = members
        .filter((member) => member.channelId && (context.flags.all === true || member.active))
        .slice(0, flagNumber(context.flags, 'limit', 100));

    return emit(context, { total: rows.length, rooms: rows }, (data) => table(data.rooms, [
        { key: 'name', label: '姓名' },
        { key: 'group', label: '团体' },
        { key: 'team', label: '队伍', max: 12 },
        { key: 'memberId', label: '成员ID' },
        { key: 'channelId', label: '房间ID' },
        { key: 'serverId', label: 'ServerID' }
    ]));
}

// 分页拉取直到攒够 limit 条或没有更多。
async function collectMessages(context, { channelId, serverId, limit, fetchAll, since }) {
    const collected = [];
    let nextTime = Number(since) || 0;
    let guard = 0;

    while (collected.length < limit && guard < 40) {
        guard += 1;

        const auth = await context.auth();
        const result = await context.pocket.fetchRoomMessages({
            ...auth,
            channelId,
            serverId,
            nextTime,
            fetchAll
        });

        if (!result.success) {
            throw new CliError(result.msg || '获取房间消息失败');
        }

        const content = result.data?.content || {};
        const batch = extractMessageList(content);
        if (batch.length === 0) break;

        collected.push(...batch.map(normalizeMessage));

        const cursor = Number(content.nextTime || 0);
        if (!cursor || cursor === nextTime) break;
        nextTime = cursor;
    }

    return collected.slice(0, limit);
}

async function roomMessages(context, positionals) {
    const query = positionals.join(' ').trim();
    if (!query) throw new CliError('用法：snh48 room messages <成员名|channelId> [--limit 50] [--all] [--since <毫秒时间戳>]');

    const { channelId, serverId, member } = await resolveRoom(context, query);
    const messages = await collectMessages(context, {
        channelId,
        serverId,
        limit: flagNumber(context.flags, 'limit', 50),
        // --all 抓房间全部人的消息，默认只抓成员本人（homeowner）。
        fetchAll: context.flags.all === true,
        since: flagString(context.flags, 'since', '0')
    });

    return emit(context, {
        member: member ? { name: member.name, memberId: member.memberId } : null,
        channelId,
        serverId,
        total: messages.length,
        messages
    }, (data) => table(data.messages, MESSAGE_COLUMNS));
}

async function roomSearch(context, positionals) {
    const [target, ...rest] = positionals;
    const keyword = rest.join(' ').trim();
    if (!target || !keyword) {
        throw new CliError('用法：snh48 room search <成员名|channelId> <关键词> [--limit 50] [--scan 500]');
    }

    const { channelId, serverId, member } = await resolveRoom(context, target);
    const scan = flagNumber(context.flags, 'scan', 500);
    const limit = flagNumber(context.flags, 'limit', 50);

    const pool = await collectMessages(context, {
        channelId,
        serverId,
        limit: scan,
        fetchAll: context.flags.all === true,
        since: flagString(context.flags, 'since', '0')
    });

    const needle = keyword.toLowerCase();
    const type = flagString(context.flags, 'type', '').toUpperCase();
    const hits = pool
        .filter((message) => (type ? message.type === type : true))
        .filter((message) => message.text.toLowerCase().includes(needle))
        .slice(0, limit);

    return emit(context, {
        member: member ? { name: member.name, memberId: member.memberId } : null,
        channelId,
        keyword,
        scanned: pool.length,
        total: hits.length,
        messages: hits
    }, (data) => `扫描 ${data.scanned} 条，命中 ${data.total} 条\n\n${table(data.messages, MESSAGE_COLUMNS)}`);
}

async function roomStats(context, positionals) {
    const query = positionals.join(' ').trim();
    if (!query) throw new CliError('用法：snh48 room stats <成员名|channelId> [--scan 500]');

    const { channelId, serverId, member } = await resolveRoom(context, query);
    const messages = await collectMessages(context, {
        channelId,
        serverId,
        limit: flagNumber(context.flags, 'scan', 500),
        fetchAll: context.flags.all === true,
        since: '0'
    });

    const byDay = new Map();
    const byType = new Map();

    for (const message of messages) {
        const day = formatTimestamp(message.time).slice(0, 10) || '未知';
        byDay.set(day, (byDay.get(day) || 0) + 1);
        byType.set(message.typeLabel, (byType.get(message.typeLabel) || 0) + 1);
    }

    const daily = [...byDay.entries()]
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => b.date.localeCompare(a.date));
    const types = [...byType.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count);

    return emit(context, {
        member: member ? { name: member.name, memberId: member.memberId } : null,
        channelId,
        scanned: messages.length,
        range: {
            from: formatTimestamp(Math.min(...messages.map((message) => message.time || Infinity))),
            to: formatTimestamp(Math.max(...messages.map((message) => message.time || 0)))
        },
        daily,
        types
    }, (data) => [
        `共 ${data.scanned} 条（${data.range.from} ~ ${data.range.to}）`,
        '',
        '— 按类型 —',
        table(data.types, [{ key: 'type', label: '类型' }, { key: 'count', label: '条数' }]),
        '',
        '— 按日期 —',
        table(data.daily.slice(0, 30), [{ key: 'date', label: '日期' }, { key: 'count', label: '条数' }])
    ].join('\n'));
}

async function roomAlbum(context, positionals) {
    const query = positionals.join(' ').trim();
    const { channelId, member } = await resolveRoom(context, query);
    const auth = await context.auth();

    const content = unwrap(await context.pocket.fetchRoomAlbum({
        ...auth,
        channelId,
        nextTime: flagNumber(context.flags, 'since', 0)
    }), '获取房间相册失败');

    const items = extractMessageList(content).map(normalizeMessage).filter((item) => item.media);

    return emit(context, {
        member: member ? { name: member.name, memberId: member.memberId } : null,
        channelId,
        total: items.length,
        items
    }, (data) => table(data.items, [
        { label: '时间', value: (row) => formatTimestamp(row.time) },
        { key: 'typeLabel', label: '类型' },
        { key: 'media', label: '地址', max: 70 }
    ]));
}

async function roomRadio(context, positionals) {
    const query = positionals.join(' ').trim();
    const { channelId, serverId, member } = await resolveRoom(context, query);
    const auth = await context.auth();

    const result = await context.pocket.fetchRoomRadio({ ...auth, channelId, serverId });
    if (!result.success) throw new CliError(result.msg || '电台未开启或获取失败');

    return emit(context, {
        member: member ? { name: member.name, memberId: member.memberId } : null,
        channelId,
        radio: result.content
    }, (data) => JSON.stringify(data.radio, null, 2));
}

async function roomDetail(context, positionals) {
    const query = positionals.join(' ').trim();
    const { serverId, member } = await resolveRoom(context, query);
    if (!serverId) throw new CliError('该房间没有已知的 serverId');

    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchSeineServerDetail({ ...auth, serverId }), '获取频道详情失败');
    return emit(context, { member, serverId, detail: content });
}

async function dmList(context) {
    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchPrivateMessageList({
        ...auth,
        lastTime: flagNumber(context.flags, 'since', 0)
    }), '获取私信列表失败');

    const rows = Array.isArray(content?.sessionList) ? content.sessionList
        : (Array.isArray(content?.list) ? content.list : []);

    return emit(context, content, () => table(rows, [
        { label: '时间', value: (row) => formatTimestamp(row.lastTime || row.msgTime) },
        { key: 'targetUserId', label: '对方ID' },
        { key: 'nickName', label: '昵称', max: 14 },
        { label: '最近消息', value: (row) => truncate(String(row.lastMsg || row.msgContent || ''), 50) }
    ]));
}

async function dmRead(context, positionals) {
    const query = positionals.join(' ').trim();
    if (!query) throw new CliError('用法：snh48 dm read <成员名|对方用户ID>');

    const { memberId } = await resolveMember(context, query);
    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchPrivateMessageInfo({
        ...auth,
        targetUserId: memberId,
        lastTime: flagNumber(context.flags, 'since', 0)
    }), '获取私信内容失败');

    const messages = extractMessageList(content).map(normalizeMessage);
    return emit(context, { targetUserId: memberId, total: messages.length, messages },
        (data) => table(data.messages, MESSAGE_COLUMNS));
}

async function dmSend(context, positionals) {
    const [target, ...rest] = positionals;
    const text = rest.join(' ').trim();
    if (!target || !text) throw new CliError('用法：snh48 dm send <成员名|对方用户ID> <内容>');

    const { memberId, member } = await resolveMember(context, target);
    const auth = await context.auth();
    const result = await context.pocket.sendPrivateMessageReply({ ...auth, targetUserId: memberId, text });
    if (!result.success) throw new CliError(result.msg || '私信发送失败');

    return emit(context, { targetUserId: memberId, member, text, sent: true },
        () => `已发送私信给 ${member ? member.name : memberId}`);
}

const commands = {
    'room list': roomList,
    'room messages': roomMessages,
    'room search': roomSearch,
    'room stats': roomStats,
    'room album': roomAlbum,
    'room radio': roomRadio,
    'room detail': roomDetail,
    'dm list': dmList,
    'dm read': dmRead,
    'dm send': dmSend
};

module.exports = { commands };
