// 直播类：口袋直播列表、回放、播放地址、礼物榜、公演直播。

const { CliError, emit, table, formatTimestamp } = require('../output');
const { unwrap } = require('../runtime');
const { flagNumber, flagString } = require('../args');
const { resolveMember } = require('../roster');

const LIVE_COLUMNS = [
    { label: '开播', value: (row) => formatTimestamp(row.startTime || row.ctime) },
    { key: 'userName', label: '成员', max: 14 },
    { key: 'title', label: '标题', max: 40 },
    { key: 'liveType', label: '类型' },
    { key: 'liveId', label: 'liveId' }
];

function normalizeLiveRows(content) {
    const list = content?.liveList || content?.list || content?.openLiveList || [];
    if (!Array.isArray(list)) return [];

    return list.map((item) => ({
        liveId: String(item.liveId || item.id || ''),
        title: String(item.title || item.liveTitle || ''),
        userName: String(item.userInfo?.nickname || item.userInfo?.starName || item.userName || item.starName || ''),
        userId: String(item.userInfo?.userId || item.userId || ''),
        liveType: Number(item.liveType || 0) === 2 ? '电台' : '视频',
        startTime: Number(item.startTime || item.ctime || 0) || 0,
        cover: String(item.coverPath || item.picPath || ''),
        raw: item
    }));
}

async function liveList(context) {
    const auth = await context.auth();
    const payload = {
        ...auth,
        groupId: flagNumber(context.flags, 'group-id', 0),
        next: flagNumber(context.flags, 'next', 0),
        record: context.flags.record === true
    };

    const member = flagString(context.flags, 'member', '');
    if (member) {
        const resolved = await resolveMember(context, member);
        payload.userId = resolved.memberId;
    }

    const content = unwrap(await context.pocket.fetchLiveList(payload), '获取直播列表失败');
    const rows = normalizeLiveRows(content);

    return emit(context, { total: rows.length, next: content?.next ?? null, lives: rows },
        (data) => table(data.lives, LIVE_COLUMNS));
}

async function liveReplay(context, positionals) {
    const query = positionals.join(' ').trim();
    if (!query) throw new CliError('用法：snh48 live replay <成员名|memberId> [--limit 20]');

    const { memberId, member } = await resolveMember(context, query);
    const auth = await context.auth();

    const content = unwrap(await context.pocket.fetchLiveList({
        ...auth,
        userId: memberId,
        record: true,
        next: flagNumber(context.flags, 'next', 0)
    }), '获取回放列表失败');

    const rows = normalizeLiveRows(content).slice(0, flagNumber(context.flags, 'limit', 20));

    return emit(context, { member, memberId, total: rows.length, replays: rows },
        (data) => table(data.replays, LIVE_COLUMNS));
}

async function liveInfo(context, [liveId]) {
    if (!liveId) throw new CliError('用法：snh48 live info <liveId>');

    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchLiveOne({ ...auth, liveId: String(liveId) }), '获取直播详情失败');

    const streams = [];
    const playStreamPath = content?.playStreamPath || content?.streamPath || '';
    if (playStreamPath) streams.push({ quality: 'default', url: String(playStreamPath) });
    for (const item of content?.playStreams || []) {
        streams.push({ quality: String(item.streamName || item.quality || ''), url: String(item.streamPath || item.url || '') });
    }

    return emit(context, { liveId: String(liveId), streams, detail: content }, (data) => [
        `标题    ${data.detail?.title || ''}`,
        `成员    ${data.detail?.user?.userName || data.detail?.userInfo?.nickname || ''}`,
        `开播    ${formatTimestamp(data.detail?.ctime || data.detail?.startTime)}`,
        '',
        table(data.streams, [{ key: 'quality', label: '清晰度' }, { key: 'url', label: '地址', max: 90 }])
    ].join('\n'));
}

async function liveRank(context, [liveId]) {
    if (!liveId) throw new CliError('用法：snh48 live rank <liveId>');

    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchLiveRank({ ...auth, liveId: String(liveId) }), '获取直播榜单失败');
    const list = content?.rankList || content?.rankUserList || content?.list || (Array.isArray(content) ? content : []);
    const rows = (Array.isArray(list) ? list : []).map((item, index) => ({
        rank: Number(item.rank ?? item.rankNo ?? index + 1),
        nickName: String(item.nickName || item.nickname || item.userName || ''),
        score: String(item.score ?? item.total ?? item.giftTotal ?? '')
    }));

    return emit(context, content, () => table(rows, [
        { key: 'rank', label: '名次' },
        { key: 'nickName', label: '昵称', max: 16 },
        { key: 'score', label: '贡献' }
    ]));
}

async function liveGifts(context, [liveId]) {
    if (!liveId) throw new CliError('用法：snh48 live gifts <liveId>');

    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchGiftList({ ...auth, liveId: String(liveId) }), '获取礼物列表失败');
    const rows = Array.isArray(content?.giftList) ? content.giftList : (Array.isArray(content) ? content : []);

    return emit(context, content, () => table(rows, [
        { key: 'giftId', label: '礼物ID' },
        { key: 'giftName', label: '名称', max: 18 },
        { key: 'money', label: '鸡腿' }
    ]));
}

async function liveSendGift(context, [liveId, giftId, giftNum]) {
    if (!liveId || !giftId) throw new CliError('用法：snh48 live send-gift <liveId> <giftId> [数量] --accept <成员用户ID>');

    const acceptUserId = flagString(context.flags, 'accept', '');
    if (!acceptUserId) throw new CliError('缺少 --accept <接收礼物的成员用户ID>');

    const auth = await context.auth();
    const result = await context.pocket.sendLiveGift({
        ...auth,
        liveId: String(liveId),
        giftId: String(giftId),
        acceptUserId: String(acceptUserId),
        giftNum: Number(giftNum) || 1
    });

    if (!result.success) throw new CliError(result.msg || '送礼失败');
    return emit(context, { sent: true, liveId, giftId, giftNum: Number(giftNum) || 1 }, () => '送礼成功');
}

async function openLive(context) {
    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchOpenLivePublicList({
        ...auth,
        groupId: flagNumber(context.flags, 'group-id', 0),
        next: flagNumber(context.flags, 'next', 0),
        record: context.flags.record === true
    }), '获取公演直播列表失败');

    const rows = normalizeLiveRows(content);
    return emit(context, { total: rows.length, lives: rows }, (data) => table(data.lives, LIVE_COLUMNS));
}

async function openLiveOne(context, [liveId]) {
    if (!liveId) throw new CliError('用法：snh48 openlive info <liveId>');

    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchOpenLiveOne({ ...auth, liveId: String(liveId) }), '获取公演详情失败');
    return emit(context, content);
}

const commands = {
    'live list': liveList,
    'live replay': liveReplay,
    'live info': liveInfo,
    'live rank': liveRank,
    'live gifts': liveGifts,
    'live send-gift': liveSendGift,
    'openlive list': openLive,
    'openlive info': openLiveOne
};

module.exports = { commands };
