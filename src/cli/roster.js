// 成员名册。两个数据源合并：
//   1. data.gnz.hk/members.json — 牙牙消息自己维护的索引，含 memberId / channelId / serverId /
//      liveRoomId，是 CLI 用中文名寻址房间的关键，且覆盖已毕业成员。
//   2. h5.48.cn allmembers.php  — 官网在籍名册，补齐期数、队伍、口号、年度排名等档案字段。
// 优先按 memberId 合并（姓名有重名，不能当主键），ID 与房间号取 (1)，档案字段优先取 (2)。

const { CliError } = require('./output');
const { readJsonCache, writeJsonCache } = require('./runtime');

const INDEX_URL = 'https://data.gnz.hk/members.json';
const OFFICIAL_ROSTER_URL = 'https://h5.48.cn/resource/jsonp/allmembers.php?gid=00&callback=get_members_success';
const CACHE_FILE = 'snh48-roster.json';
const DEFAULT_TTL_SECONDS = 86400;

// 官网 gid 与团体的对应关系容易记反（20 是 BEJ、30 是 GNZ），
// 所以优先用返回体自带的 gname 拼出团名，gid 仅作兜底。
const GROUP_NAMES = {
    10: 'SNH48',
    20: 'BEJ48',
    30: 'GNZ48',
    40: 'SHY48',
    50: 'CKG48',
    60: 'CGT48',
    70: 'IDFT'
};

function normalizeGroupName(gname, gid) {
    const code = String(gname || '').trim().toUpperCase();
    if (code === 'IDFT') return 'IDFT';
    if (code) return code.endsWith('48') ? code : `${code}48`;
    return GROUP_NAMES[Number(gid)] || '';
}

const REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    Referer: 'https://www.snh48.com/'
};

function parseJsonp(text) {
    const start = text.indexOf('(');
    const end = text.lastIndexOf(')');
    if (start < 0 || end < 0 || end <= start) {
        throw new CliError('接口返回的不是合法 JSONP');
    }
    return JSON.parse(text.slice(start + 1, end));
}

async function fetchMemberIndex() {
    const response = await fetch(`${INDEX_URL}?t=${Date.now()}`, { headers: REQUEST_HEADERS });
    if (!response.ok) {
        throw new CliError(`拉取成员索引失败：HTTP ${response.status}`);
    }

    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : (payload.roomId || payload.members || []);
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new CliError('成员索引为空，接口可能已变更');
    }

    return rows.map((row) => ({
        memberId: String(row.id || ''),
        name: String(row.ownerName || '').trim(),
        pinyin: String(row.pinyin || ''),
        nickname: String(row.nickname || '').replace(/^-$/, ''),
        group: String(row.groupName || ''),
        team: String(row.team || ''),
        generation: String(row.periodName || ''),
        birthday: String(row.birthday || ''),
        birthPlace: String(row.birthplace || ''),
        starSign: String(row.constellation || ''),
        height: row.height ? String(row.height) : '',
        bloodType: String(row.bloodType || '').replace(/^-$/, ''),
        speciality: String(row.specialty || ''),
        hobby: String(row.hobbies || ''),
        joinDay: String(row.jtime || ''),
        graduateDay: String(row.gtime || ''),
        note: String(row.note || ''),
        channelId: row.channelId ? String(row.channelId) : '',
        serverId: row.serverId ? String(row.serverId) : '',
        liveRoomId: row.liveRoomId ? String(row.liveRoomId) : '',
        weiboUid: String(row.wbUid || '').replace(/^-$/, ''),
        weiboName: String(row.wbName || '').replace(/^-$/, ''),
        avatar: String(row.avatar || ''),
        // 原始信号，最终的 active 由 mergeSources 结合官网名册统一判定。
        active: row.isInGroup === undefined ? !row.gtime : Boolean(row.isInGroup)
    })).filter((member) => member.name);
}

async function fetchOfficialRoster() {
    const response = await fetch(OFFICIAL_ROSTER_URL, { headers: REQUEST_HEADERS });
    if (!response.ok) {
        throw new CliError(`拉取官网名册失败：HTTP ${response.status}`);
    }

    const payload = parseJsonp(await response.text());
    const rows = Array.isArray(payload.rows) ? payload.rows : [];

    return rows.map((row) => ({
        sid: String(row.sid || ''),
        pocketId: String(row.pocket_id || '0') !== '0' ? String(row.pocket_id) : '',
        name: String(row.sname || '').trim(),
        pinyin: String(row.pinyin || ''),
        abbr: String(row.abbr || ''),
        nickname: String(row.nickname || ''),
        group: normalizeGroupName(row.gname, row.gid),
        team: String(row.tname || ''),
        generation: String(row.pname || ''),
        joinDay: String(row.join_day || ''),
        birthday: String(row.birth_day || ''),
        height: String(row.height || ''),
        birthPlace: String(row.birth_place || '').trim(),
        starSign: String(row.star_sign_12 || ''),
        bloodType: String(row.blood_type || '').replace(/^-$/, ''),
        speciality: String(row.speciality || ''),
        hobby: String(row.hobby || ''),
        catchPhrase: String(row.catch_phrase || ''),
        weiboUid: String(row.weibo_uid || '0') !== '0' ? String(row.weibo_uid) : '',
        ranking: String(row.ranking || '0'),
        company: String(row.company || ''),
        inRoster: String(row.status || '') === '99'
    })).filter((member) => member.name);
}

// 「是否在籍」的权威信号是官网名册的 status=99（351 人），但它把荣誉毕业生也算进去，
// 所以要再按队伍名剔一次。索引自带的 isInGroup 明显滞后（931 人里只有 217 个 true），只作兜底。
function computeActive({ inRoster, team, graduateDay, isInGroup, officialAvailable }) {
    if (String(team || '').includes('毕业')) return false;

    // 官网名册拿不到时退回索引启发式，否则会把所有人误判成已毕业。
    if (!officialAvailable) {
        return !graduateDay && Boolean(isInGroup === undefined ? true : isInGroup);
    }

    return Boolean(inRoster);
}

// 姓名不是唯一键——官网名册有 18 组重名，索引里也有（例如两个不同的「李沁洁」）。
// 因此优先按 memberId 合并，只有在双方姓名都唯一时才退回按姓名匹配。
function mergeSources(index, official) {
    const officialAvailable = official.length > 0;
    const records = index.map((member) => ({
        ...member,
        abbr: '',
        catchPhrase: '',
        ranking: '0',
        company: '',
        inRoster: false,
        isInGroup: member.active
    }));

    const byMemberId = new Map();
    const nameCounts = new Map();
    const nameGroupCounts = new Map();
    const nameGroupKey = (name, group) => `${name}\u0000${group}`;

    for (const record of records) {
        if (record.memberId) byMemberId.set(record.memberId, record);
        nameCounts.set(record.name, (nameCounts.get(record.name) || 0) + 1);
        const key = nameGroupKey(record.name, record.group);
        nameGroupCounts.set(key, (nameGroupCounts.get(key) || 0) + 1);
    }

    const officialNameCounts = new Map();
    const officialNameGroupCounts = new Map();
    for (const member of official) {
        officialNameCounts.set(member.name, (officialNameCounts.get(member.name) || 0) + 1);
        const key = nameGroupKey(member.name, member.group);
        officialNameGroupCounts.set(key, (officialNameGroupCounts.get(key) || 0) + 1);
    }

    const consumed = new Set();
    const isFree = (record) => record && !consumed.has(record);

    for (const member of official) {
        let target = member.pocketId ? byMemberId.get(member.pocketId) : null;

        // 姓名唯一时可直接按姓名配对。
        if (!isFree(target) && nameCounts.get(member.name) === 1 && officialNameCounts.get(member.name) === 1) {
            target = records.find((record) => record.name === member.name && isFree(record));
        }

        // 重名时再用「姓名 + 团体」区分，例如分属 SNH48 与 GNZ48 的两位「李沁洁」。
        if (!isFree(target)) {
            const key = nameGroupKey(member.name, member.group);
            if (nameGroupCounts.get(key) === 1 && officialNameGroupCounts.get(key) === 1) {
                target = records.find((record) => isFree(record)
                    && record.name === member.name
                    && record.group === member.group);
            }
        }

        if (!isFree(target)) target = null;

        if (!target) {
            // 官网独有（多为没登记口袋账号的成员），单独建档。
            records.push({
                ...member,
                memberId: member.pocketId,
                channelId: '',
                serverId: '',
                liveRoomId: '',
                graduateDay: '',
                note: '',
                avatar: '',
                weiboName: '',
                isInGroup: undefined,
                active: computeActive({ inRoster: member.inRoster, team: member.team, officialAvailable })
            });
            continue;
        }

        consumed.add(target);

        // 官网档案字段更权威，但 ID / 房间号只有索引里有。
        target.abbr = member.abbr;
        target.group = member.group || target.group;
        target.team = member.team || target.team;
        target.generation = member.generation || target.generation;
        target.catchPhrase = member.catchPhrase;
        target.ranking = member.ranking;
        target.company = member.company;
        target.starSign = member.starSign || target.starSign;
        target.weiboUid = target.weiboUid || member.weiboUid;
        target.memberId = target.memberId || member.pocketId;
        target.inRoster = member.inRoster;
    }

    for (const record of records) {
        record.active = computeActive({
            inRoster: record.inRoster,
            team: record.team,
            graduateDay: record.graduateDay,
            isInGroup: record.isInGroup,
            officialAvailable
        });
        delete record.isInGroup;
    }

    return records;
}

async function loadRoster(context, { refresh = false } = {}) {
    const ttl = Number(process.env.SNH48_ROSTER_TTL || DEFAULT_TTL_SECONDS);
    if (!refresh) {
        const cached = readJsonCache(context.cacheDir, CACHE_FILE, ttl);
        if (cached && Array.isArray(cached.members) && cached.members.length > 0) {
            return cached.members;
        }
    }

    // 官网名册挂了也不该让整个 CLI 停摆，索引源才是硬依赖。
    const [index, official] = await Promise.all([
        fetchMemberIndex(),
        fetchOfficialRoster().catch(() => [])
    ]);

    const members = mergeSources(index, official);
    writeJsonCache(context.cacheDir, CACHE_FILE, { fetchedAt: new Date().toISOString(), members });
    return members;
}

function filterRoster(members, { group = '', team = '', generation = '', activeOnly = true } = {}) {
    const groupKey = String(group || '').trim().toUpperCase();
    const teamKey = String(team || '').trim().toUpperCase();
    const generationKey = String(generation || '').trim();

    return members.filter((member) => {
        if (activeOnly && !member.active) return false;
        if (groupKey && !member.group.toUpperCase().includes(groupKey)) return false;
        if (teamKey && !member.team.toUpperCase().includes(teamKey)) return false;
        if (generationKey && !member.generation.includes(generationKey)) return false;
        return true;
    });
}

function scoreMatch(member, query) {
    const needle = query.toLowerCase();
    const name = member.name.toLowerCase();
    const pinyin = String(member.pinyin || '').toLowerCase().replace(/\s+/g, '');
    const abbr = String(member.abbr || '').toLowerCase();
    const nickname = String(member.nickname || '').toLowerCase();

    if (name === needle || (abbr && abbr === needle) || (pinyin && pinyin === needle)) return 100;
    if (nickname && nickname.split(/[、,，\s]+/).includes(needle)) return 90;
    if (name.startsWith(needle)) return 80;
    if ((pinyin && pinyin.startsWith(needle)) || (abbr && abbr.startsWith(needle))) return 70;
    if (name.includes(needle)) return 60;
    if (nickname.includes(needle)) return 50;
    if (pinyin.includes(needle)) return 40;
    return 0;
}

function searchRoster(members, query, { limit = 20, activeOnly = false } = {}) {
    const trimmed = String(query || '').trim();
    if (!trimmed) return [];

    return members
        .filter((member) => (activeOnly ? member.active : true))
        .map((member) => ({ member, score: scoreMatch(member, trimmed) }))
        .filter((entry) => entry.score > 0)
        // 同分时在籍成员优先，避免同名毕业生把在籍成员挤掉。
        .sort((a, b) => b.score - a.score
            || Number(b.member.active) - Number(a.member.active)
            || a.member.name.localeCompare(b.member.name))
        .slice(0, limit)
        .map((entry) => entry.member);
}

// 把用户输入解析成口袋 memberId。纯数字直接透传，其余走名册模糊匹配。
async function resolveMember(context, query, { refresh = false, requireRoom = false } = {}) {
    const trimmed = String(query || '').trim();
    if (!trimmed) {
        throw new CliError('请提供成员名称或 memberId');
    }

    const members = await loadRoster(context, { refresh }).catch(() => []);

    if (/^\d+$/.test(trimmed)) {
        const known = members.find((member) => member.memberId === trimmed);
        return { memberId: trimmed, member: known || null };
    }

    if (members.length === 0) {
        throw new CliError('名册加载失败，无法用名字寻址成员', { hint: '改传数字 memberId，或检查网络。' });
    }

    const matches = searchRoster(members, trimmed, { limit: 6 });
    if (matches.length === 0) {
        throw new CliError(`名册中找不到成员「${trimmed}」`, {
            hint: '用 `snh48 roster --search <关键词>` 确认写法，或直接传口袋 memberId。'
        });
    }

    const usable = matches.filter((member) => member.memberId && (!requireRoom || member.channelId));
    if (usable.length === 0) {
        throw new CliError(
            requireRoom
                ? `成员「${matches[0].name}」没有登记口袋房间`
                : `成员「${matches[0].name}」没有登记口袋账号`,
            { hint: '该成员可能未开通口袋房间，请直接传 memberId / channelId。' }
        );
    }

    const describe = (list) => list.slice(0, 5)
        .map((member) => `${member.name}(${member.group} ${member.team}, id=${member.memberId})`)
        .join('；');
    const ambiguous = (candidates) => new CliError(`「${trimmed}」匹配到多位成员，请写得更具体`, {
        hint: `${describe(candidates)}。可直接传 memberId 消除歧义。`
    });

    // 名册里存在重名（例如分属 SNH48 与 GNZ48 的两位「李沁洁」），
    // 全名精确命中多条时同样要报歧义，不能默默选第一个。
    const exactMatches = usable.filter((member) => member.name === trimmed);
    if (exactMatches.length > 1) {
        const activeExact = exactMatches.filter((member) => member.active);
        // 只有一位在籍时按在籍那位解析，其余情况交回用户判断。
        if (activeExact.length !== 1) throw ambiguous(exactMatches);
        return { memberId: activeExact[0].memberId, member: activeExact[0] };
    }

    if (exactMatches.length === 1) {
        return { memberId: exactMatches[0].memberId, member: exactMatches[0] };
    }

    // 模糊匹配同分时也报错而不是静默选一个，避免查错人。
    if (usable.length > 1 && scoreMatch(usable[0], trimmed) === scoreMatch(usable[1], trimmed)) {
        throw ambiguous(usable);
    }

    return { memberId: usable[0].memberId, member: usable[0] };
}

// 房间类命令需要 channelId + serverId，允许直接传数字 channelId 绕过名册。
async function resolveRoom(context, query) {
    const trimmed = String(query || '').trim();
    if (!trimmed) {
        throw new CliError('请提供成员名称或 channelId');
    }

    if (/^\d+$/.test(trimmed)) {
        const members = await loadRoster(context).catch(() => []);
        const byChannel = members.find((member) => member.channelId === trimmed);
        if (byChannel) {
            return { channelId: byChannel.channelId, serverId: byChannel.serverId, member: byChannel };
        }

        const byMemberId = members.find((member) => member.memberId === trimmed);
        if (byMemberId && byMemberId.channelId) {
            return { channelId: byMemberId.channelId, serverId: byMemberId.serverId, member: byMemberId };
        }

        // 未知数字按 channelId 透传，serverId 交给接口自己解析。
        return { channelId: trimmed, serverId: '', member: byMemberId || null };
    }

    const { member } = await resolveMember(context, trimmed, { requireRoom: true });
    return { channelId: member.channelId, serverId: member.serverId, member };
}

module.exports = {
    loadRoster,
    filterRoster,
    searchRoster,
    resolveMember,
    resolveRoom,
    parseJsonp,
    REQUEST_HEADERS
};
