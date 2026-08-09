// 公演场次、票务与日程（api.snh48.com 官方 JSONP 源）。

const { CliError } = require('./output');
const { parseJsonp, REQUEST_HEADERS } = require('./roster');

const TICKET_API = 'https://api.snh48.com/m/getmtickets.php?callback=cb';
const PLAN_API = 'https://api.snh48.com/getevents.php?callback=cb';

// 票务/日程接口用的是另一套团体编号，与名册 gid 无关。
const SHOW_GROUP_IDS = {
    SNH48: '1',
    BEJ48: '2',
    GNZ48: '3',
    CKG48: '5',
    CGT48: '6'
};

const SHOW_GROUP_NAMES = {
    1: 'SNH48',
    2: 'BEJ48',
    3: 'GNZ48',
    5: 'CKG48',
    6: 'CGT48'
};

function resolveShowGroupId(value) {
    const raw = String(value === undefined || value === true ? '1' : value).trim();
    if (!raw) return '1';
    if (/^\d+$/.test(raw)) return raw;

    const key = raw.toUpperCase().replace(/48$/, '') + '48';
    if (SHOW_GROUP_IDS[key]) return SHOW_GROUP_IDS[key];

    throw new CliError(`未知团体「${value}」`, {
        hint: `可用值：${Object.keys(SHOW_GROUP_IDS).join(' / ')}，或直接传数字 gid。`
    });
}

async function fetchJsonp(url, label) {
    const response = await fetch(url, { headers: REQUEST_HEADERS });
    if (!response.ok) {
        throw new CliError(`${label}失败：HTTP ${response.status}`);
    }

    const payload = parseJsonp(await response.text());
    if (String(payload.status) !== '200') {
        throw new CliError(`${label}失败：接口状态 ${payload.status}`);
    }

    return Array.isArray(payload.desc) ? payload.desc : [];
}

function ticketStatus(item) {
    const vip = Number(item.vstatus || 0);
    const standard = Number(item.sstatus || 0);
    const common = Number(item.cstatus || 0);

    if (!vip && !standard && !common) return '售罄';

    const parts = [];
    if (vip) parts.push('VIP票有售');
    if (standard) parts.push('普通票有售');
    else if (!vip && common) parts.push('有售');

    return parts.length > 0 ? parts.join('、') : '有售';
}

function stripHtml(html) {
    return String(html || '')
        .replace(/<[^>]+>/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n');
}

function parseShowTime(value) {
    // 接口给的是 "YYYY-MM-DD HH:MM" 本地时间。
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (!match) return null;
    const [, year, month, day, hour, minute] = match;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
}

async function getShows({ group = '1', days = 7 } = {}) {
    const gid = resolveShowGroupId(group);
    const groupName = SHOW_GROUP_NAMES[Number(gid)] || `gid=${gid}`;
    const rows = await fetchJsonp(`${TICKET_API}&gid=${gid}`, '拉取公演票务');

    const now = new Date();
    const cutoff = new Date(now.getTime() + Number(days) * 86400000);

    return rows
        .map((item) => {
            const when = parseShowTime(item.addtime);
            if (!when || when < now || when > cutoff) return null;

            return {
                date: item.addtime.slice(0, 10),
                time: item.addtime.slice(11, 16),
                datetime: item.addtime,
                title: String(item.title || ''),
                theme: String(item.theme || ''),
                team: String(item.teamname || ''),
                venue: String(item.theatre_id_name || ''),
                special: String(item.special || ''),
                ticketStatus: ticketStatus(item),
                ticketUrl: String(item.vip_url || ''),
                group: groupName
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.datetime.localeCompare(b.datetime));
}

async function getPlan({ group = '1', days = 7 } = {}) {
    const gid = resolveShowGroupId(group);
    const rows = await fetchJsonp(`${PLAN_API}&gid=${gid}`, '拉取公演日程');

    const now = Date.now();
    const cutoff = now + Number(days) * 86400000;

    return rows
        .filter((item) => {
            const addTime = Number(item.add_time);
            if (!Number.isFinite(addTime) || addTime <= 0) return true;
            const millis = addTime * 1000;
            return millis >= now && millis <= cutoff;
        })
        .map((item) => ({
            date: String(item.time || ''),
            year: String(item.year || ''),
            title: String(item.title || ''),
            clock1: String(item.clock1 || ''),
            clock2: String(item.clock2 || ''),
            team: String(item.team || ''),
            detail: stripHtml(item.content)
        }));
}

module.exports = {
    getShows,
    getPlan
};
