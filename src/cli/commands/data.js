// 数据类：公演票务与日程（官网源）、鸡腿榜（口袋源）。

const { CliError, emit, table } = require('../output');
const { unwrap } = require('../runtime');
const { flagNumber, flagString } = require('../args');
const { resolveMember } = require('../roster');
const { getShows, getPlan } = require('../shows');

async function shows(context) {
    const rows = await getShows({
        group: flagString(context.flags, 'group', '1'),
        days: flagNumber(context.flags, 'days', 7)
    });

    return emit(context, { total: rows.length, shows: rows }, (data) => table(data.shows, [
        { key: 'date', label: '日期' },
        { key: 'time', label: '开演' },
        { key: 'team', label: '队伍' },
        { key: 'theme', label: '剧目', max: 26 },
        { key: 'venue', label: '场馆', max: 18 },
        { key: 'ticketStatus', label: '票务' },
        { key: 'special', label: '备注', max: 14 }
    ]));
}

async function plan(context) {
    const rows = await getPlan({
        group: flagString(context.flags, 'group', '1'),
        days: flagNumber(context.flags, 'days', 7)
    });

    return emit(context, { total: rows.length, plan: rows }, (data) => data.plan.map((item) => [
        `${item.year}.${item.date}  ${item.team}  ${item.title}`,
        item.clock1 ? `  场次：${[item.clock1, item.clock2].filter(Boolean).join(' / ')}` : '',
        item.detail ? item.detail.split('\n').map((line) => `  ${line}`).join('\n') : ''
    ].filter(Boolean).join('\n')).join('\n\n') || '（无数据）');
}

// 榜单接口在周榜/总榜/年榜之间换了好几种键名，这里一并兜住。
function normalizeRankRows(content) {
    const list = content?.rankList
        || content?.rankUserList
        || content?.rankStarList
        || content?.list
        || content?.data
        || [];
    if (!Array.isArray(list)) return [];

    return list.map((item, index) => ({
        rank: Number(item.rank ?? item.rankNo ?? item.rankNum ?? index + 1),
        name: String(item.starName || item.memberName || item.nickName || item.nickname || item.name || ''),
        score: String(item.score ?? item.total ?? item.value ?? item.giftTotal ?? ''),
        memberId: String(item.starId || item.memberId || item.userId || '')
    }));
}

const RANK_COLUMNS = [
    { key: 'rank', label: '名次' },
    { key: 'name', label: '成员', max: 16 },
    { key: 'score', label: '鸡腿' },
    { key: 'memberId', label: '成员ID' }
];

async function rankWeek(context) {
    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchMeleeWeekRank({
        ...auth,
        rankId: flagNumber(context.flags, 'rank-id', 0),
        nextId: flagString(context.flags, 'next', '')
    }), '获取鸡腿周榜失败');

    return emit(context, content, () => table(normalizeRankRows(content), RANK_COLUMNS));
}

async function rankPage(context) {
    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchMeleeRankPage({
        ...auth,
        rankId: flagNumber(context.flags, 'rank-id', 0),
        nextId: flagString(context.flags, 'next', '')
    }), '获取鸡腿榜失败');

    return emit(context, content, () => table(normalizeRankRows(content), RANK_COLUMNS));
}

async function rankYear(context) {
    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchMeleeYearRankPage({
        ...auth,
        rankId: flagString(context.flags, 'rank-id', ''),
        nextId: flagString(context.flags, 'next', '')
    }), '获取鸡腿年榜失败');

    return emit(context, content, () => table(normalizeRankRows(content), RANK_COLUMNS));
}

async function rankMember(context, positionals) {
    const query = positionals.join(' ').trim();
    if (!query) throw new CliError('用法：snh48 rank member <成员名|memberId>');

    const { memberId, member } = await resolveMember(context, query);
    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchPersonMeleeRankPage({ ...auth, resId: memberId }), '获取成员贡献榜失败');

    return emit(context, { member, memberId, rank: content }, () => table(normalizeRankRows(content), [
        { key: 'rank', label: '名次' },
        { key: 'name', label: '粉丝', max: 18 },
        { key: 'score', label: '鸡腿' }
    ]));
}

async function albums(context) {
    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchAlbumList({
        ...auth,
        groupId: flagNumber(context.flags, 'group-id', 0),
        limit: flagNumber(context.flags, 'limit', 20),
        ctime: flagNumber(context.flags, 'since', 0)
    }), '获取专辑列表失败');

    const rows = Array.isArray(content?.albumList) ? content.albumList
        : (Array.isArray(content?.list) ? content.list : []);

    return emit(context, content, () => table(rows, [
        { key: 'albumId', label: '专辑ID' },
        { key: 'title', label: '标题', max: 36 },
        { key: 'total', label: '数量' }
    ]));
}

const commands = {
    shows,
    plan,
    'rank week': rankWeek,
    'rank list': rankPage,
    'rank year': rankYear,
    'rank member': rankMember,
    albums
};

module.exports = { commands };
