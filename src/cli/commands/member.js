// 成员类：名册检索 + 口袋档案、历史、公式照、关注、行程。

const { CliError, emit, table, formatTimestamp } = require('../output');
const { unwrap } = require('../runtime');
const { flagNumber, flagString } = require('../args');
const { loadRoster, filterRoster, searchRoster, resolveMember } = require('../roster');

const ROSTER_COLUMNS = [
    { key: 'name', label: '姓名' },
    { key: 'group', label: '团体' },
    { key: 'team', label: '队伍', max: 12 },
    { key: 'generation', label: '期数', max: 18 },
    { key: 'memberId', label: '成员ID' },
    { key: 'channelId', label: '房间ID' },
    { key: 'birthday', label: '生日' }
];

function rosterFlags(flags) {
    return {
        group: flagString(flags, 'group', ''),
        team: flagString(flags, 'team', ''),
        generation: flagString(flags, 'generation', ''),
        activeOnly: flags.all !== true
    };
}

async function roster(context) {
    const members = await loadRoster(context, { refresh: context.flags.refresh === true });
    const search = flagString(context.flags, 'search', '');
    const limit = flagNumber(context.flags, 'limit', search ? 20 : 50);

    const rows = search
        ? searchRoster(members, search, { limit, activeOnly: context.flags.all !== true })
        : filterRoster(members, rosterFlags(context.flags)).slice(0, limit);

    return emit(context, { total: rows.length, members: rows },
        (data) => table(data.members, ROSTER_COLUMNS));
}

async function memberSearch(context, positionals) {
    const query = positionals.join(' ').trim();
    if (!query) throw new CliError('用法：snh48 member search <关键词>');

    const members = await loadRoster(context, { refresh: context.flags.refresh === true });
    const rows = searchRoster(members, query, {
        limit: flagNumber(context.flags, 'limit', 20),
        activeOnly: context.flags.all !== true
    });

    return emit(context, { query, total: rows.length, members: rows },
        (data) => table(data.members, ROSTER_COLUMNS));
}

function renderProfile(member) {
    return [
        `${member.name}（${member.group}${member.team ? ` ${member.team}` : ''}）${member.active ? '' : ' [已毕业/非在籍]'}`,
        `期数    ${member.generation}`,
        `昵称    ${member.nickname}`,
        `生日    ${member.birthday}    星座 ${member.starSign}`,
        `身高    ${member.height}${member.height ? 'cm' : ''}    血型 ${member.bloodType}`,
        `出身地  ${member.birthPlace}`,
        `加入    ${member.joinDay}${member.graduateDay ? `    毕业 ${member.graduateDay}` : ''}`,
        `特长    ${member.speciality}`,
        `爱好    ${member.hobby}`,
        member.catchPhrase ? `口号    ${member.catchPhrase}` : '',
        `成员ID  ${member.memberId || '（无）'}    房间ID ${member.channelId || '（无）'}`,
        `微博    ${member.weiboName || ''} ${member.weiboUid || ''}`.trimEnd()
    ].filter(Boolean).join('\n');
}

async function memberProfile(context, positionals) {
    const query = positionals.join(' ').trim();
    const { memberId, member } = await resolveMember(context, query);

    // 未登录时退化为本地名册资料，仍然有用。
    if (!context.token) {
        if (!member) throw new CliError('未登录且名册中无此成员');
        return emit(context, { source: 'roster', memberId, profile: member }, () => renderProfile(member));
    }

    const auth = await context.auth();
    const archives = unwrap(await context.pocket.fetchStarArchives({ ...auth, memberId }), '获取成员档案失败');

    return emit(context, { source: 'pocket', memberId, profile: member, archives }, () => {
        const lines = member ? [renderProfile(member), ''] : [];
        lines.push('— 口袋档案 —', JSON.stringify(archives, null, 2));
        return lines.join('\n');
    });
}

async function memberHistory(context, positionals) {
    const { memberId, member } = await resolveMember(context, positionals.join(' ').trim());
    const auth = await context.auth();
    const history = unwrap(await context.pocket.fetchStarHistory({ ...auth, memberId }), '获取成员历史失败');
    return emit(context, { memberId, member, history });
}

async function memberPhotos(context, positionals) {
    const { memberId, member } = await resolveMember(context, positionals.join(' ').trim());
    const auth = await context.auth();
    const photos = unwrap(await context.pocket.fetchMemberPhotos({
        ...auth,
        memberId,
        page: flagNumber(context.flags, 'page', 0),
        size: flagNumber(context.flags, 'size', 20)
    }), '获取公式照失败');

    return emit(context, { memberId, member, photos });
}

async function memberFollow(context, positionals) {
    const { memberId, member } = await resolveMember(context, positionals.join(' ').trim());
    const auth = await context.auth();
    const result = await context.pocket.followMember({ ...auth, memberId });
    if (!result.success) throw new CliError(result.msg || '关注失败');

    return emit(context, { memberId, member, followed: true },
        () => `已关注 ${member ? member.name : memberId}`);
}

async function memberUnfollow(context, positionals) {
    const { memberId, member } = await resolveMember(context, positionals.join(' ').trim());
    const auth = await context.auth();
    const result = await context.pocket.unfollowMember({ ...auth, memberId });
    if (!result.success) throw new CliError(result.msg || '取关失败');

    return emit(context, { memberId, member, followed: false },
        () => `已取消关注 ${member ? member.name : memberId}`);
}

async function memberFollowing(context) {
    const auth = await context.auth();
    const response = await context.pocket.fetchFriendsIds(auth);
    if (!response || response.status !== 200) {
        throw new CliError(response?.message || '获取关注列表失败');
    }

    const ids = (response.content?.data || response.content?.friends || []).map(String);
    const members = await loadRoster(context).catch(() => []);
    const byId = new Map(members.map((member) => [member.memberId, member]));

    const rows = ids.map((id) => {
        const member = byId.get(id);
        return {
            memberId: id,
            name: member ? member.name : '',
            group: member ? member.group : '',
            team: member ? member.team : '',
            channelId: member ? member.channelId : ''
        };
    });

    return emit(context, { total: rows.length, following: rows }, (data) => table(data.following, [
        { key: 'memberId', label: '成员ID' },
        { key: 'name', label: '姓名' },
        { key: 'group', label: '团体' },
        { key: 'team', label: '队伍', max: 12 },
        { key: 'channelId', label: '房间ID' }
    ]));
}

async function trip(context, positionals) {
    const query = positionals.join(' ').trim();
    const auth = await context.auth();
    const payload = { ...auth, lastTime: flagString(context.flags, 'since', '0') };

    if (query) {
        const { memberId } = await resolveMember(context, query);
        payload.memberId = memberId;
    } else {
        payload.groupId = flagNumber(context.flags, 'group-id', 0);
    }

    const content = unwrap(await context.pocket.fetchTripList(payload), '获取行程失败');
    const rows = Array.isArray(content?.tripList) ? content.tripList
        : (Array.isArray(content?.list) ? content.list : (Array.isArray(content) ? content : []));

    return emit(context, content, () => table(rows, [
        { label: '时间', value: (row) => formatTimestamp(row.showTime || row.tripTime || row.createTime) },
        { key: 'title', label: '标题', max: 40 },
        { key: 'address', label: '地点', max: 24 }
    ]));
}

const commands = {
    roster,
    'member search': memberSearch,
    'member info': memberProfile,
    'member history': memberHistory,
    'member photos': memberPhotos,
    'member follow': memberFollow,
    'member unfollow': memberUnfollow,
    'member following': memberFollowing,
    trip
};

module.exports = { commands, renderProfile };
