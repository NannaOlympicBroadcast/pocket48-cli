// 帮助文本。按功能域分组，与 README 的功能分类保持一致。

const { displayWidth } = require('./output');

const HELP_TOPICS = {
    账号: [
        ['login [手机号]', '交互式短信登录：问手机号 → 发码 → 输验证码 → 存 Token'],
        ['login qr', '扫码登录 live.48.cn（公演直播源；不产生口袋 Token）'],
        ['login sms <手机号>', '仅发送验证码（--area 86 --answer <图形验证答案>）'],
        ['login code <手机号> <验证码>', '用验证码登录并保存 Token'],
        ['login token <token>', '直接注入 Token 并校验'],
        ['login status', '同时查看口袋 48 与 live.48.cn 的登录状态'],
        ['whoami', '查看当前登录账号'],
        ['logout', '清除本地 Token（--all 一并清除 live.48.cn）'],
        ['checkin', '口袋签到'],
        ['checkin status', '查看今日签到状态'],
        ['account switch <用户ID>', '大小号切换'],
        ['account money', '查询星币/鸡腿余额'],
        ['account unread', '未读消息数'],
        ['account orders', '消费订单（--month YYYY-MM）']
    ],
    成员: [
        ['roster', '成员名册（--search --group --team --generation --limit --all --refresh）'],
        ['member search <关键词>', '按姓名/拼音/昵称检索成员'],
        ['member info <成员>', '成员档案（名册 + 口袋档案）'],
        ['member history <成员>', '成员历史动态'],
        ['member photos <成员>', '公式照（--page --size）'],
        ['member lives <成员>', '成员直播记录'],
        ['member follow <成员>', '关注成员'],
        ['member unfollow <成员>', '取消关注'],
        ['member following', '我关注的成员列表'],
        ['trip [成员]', '公演行程（不带成员则按团体，--group-id）']
    ],
    消息: [
        ['room list', '有口袋房间的成员一览（--all 含毕业成员）'],
        ['room messages <成员>', '抓取房间消息（--limit --all --since）'],
        ['room search <成员> <关键词>', '房间历史消息检索（--scan --type --limit）'],
        ['room stats <成员>', '消息条数统计（--scan）'],
        ['room album <成员>', '房间相册图片/视频'],
        ['room radio <成员>', '房间上麦（电台）地址'],
        ['room detail <成员>', '频道详情'],
        ['dm list', '私信会话列表'],
        ['dm read <成员>', '读取与某人的私信'],
        ['dm send <成员> <内容>', '发送私信']
    ],
    直播: [
        ['live list', '正在直播列表（--group-id --member --record --next）'],
        ['live replay <成员>', '成员直播回放（--limit --next）'],
        ['live info <liveId>', '直播详情与播放地址'],
        ['live rank <liveId>', '直播贡献榜'],
        ['live gifts <liveId>', '可用礼物列表'],
        ['live send-gift <liveId> <giftId> [数量]', '送出礼物（--accept <成员用户ID>）'],
        ['openlive list', '公演直播列表'],
        ['openlive info <liveId>', '公演直播详情']
    ],
    互动: [
        ['dynamic <成员>', '口袋动态'],
        ['weibo <成员>', '成员微博'],
        ['flip list', '我的翻牌记录（--limit --offset）'],
        ['flip prices <成员>', '翻牌价格'],
        ['flip ask <成员> <问题>', '发起翻牌提问（--price --type）'],
        ['flip delete <questionId>', '撤回/删除提问（--type）'],
        ['area newest', '48 区最新帖'],
        ['area recommend', '48 区推荐帖'],
        ['area post <postId>', '帖子详情'],
        ['area comments <resourceId>', '帖子评论']
    ],
    数据: [
        ['shows', '近期公演与票务（--group SNH48|BEJ48|GNZ48|CKG48|CGT48 --days 7）'],
        ['plan', '近期公演日程摘要（--group --days）'],
        ['rank week', '鸡腿周榜（--rank-id --next）'],
        ['rank list', '鸡腿榜单'],
        ['rank year', '鸡腿年榜'],
        ['rank member <成员>', '成员鸡腿贡献榜'],
        ['albums', '官方专辑列表']
    ],
    其他: [
        ['maskword [文本]', '屏蔽词检测；不带文本则列出词库'],
        ['api <路径> [JSON]', '直连口袋接口（逃生舱）'],
        ['help [主题]', '查看帮助']
    ]
};

const GLOBAL_FLAGS = [
    ['--json', '强制 JSON 输出（管道场景默认即 JSON）'],
    ['--text', '强制人类可读输出'],
    ['--raw', 'JSON 不缩进，便于 jq 流式处理'],
    ['--token <token>', '本次调用使用指定 Token'],
    ['--verbose', '把调试日志打到 stderr'],
    ['--refresh', '强制刷新成员名册缓存']
];

const ENV_VARS = [
    ['SNH48_TOKEN', '口袋 48 Token，优先级低于 --token、高于本地设置'],
    ['SNH48_CACHE_DIR', '缓存目录，默认与桌面端共用'],
    ['SNH48_ROSTER_TTL', '名册缓存秒数，默认 86400']
];

function pad(value, width) {
    return value + ' '.repeat(Math.max(0, width - displayWidth(value)));
}

function renderGroup(title, entries) {
    const width = Math.max(...entries.map(([usage]) => displayWidth(usage)));
    const lines = entries.map(([usage, description]) => `  ${pad(usage, width)}  ${description}`);
    return `${title}\n${lines.join('\n')}`;
}

function renderHelp(topic = '') {
    const key = String(topic || '').trim();

    if (key) {
        const matchedGroup = Object.keys(HELP_TOPICS).find((name) => name === key);
        if (matchedGroup) {
            return renderGroup(matchedGroup, HELP_TOPICS[matchedGroup]);
        }

        // 按命令前缀过滤，`snh48 help room` 只列房间相关命令。
        const hits = Object.entries(HELP_TOPICS).flatMap(([, entries]) => entries)
            .filter(([usage]) => usage.startsWith(key));
        if (hits.length > 0) {
            return renderGroup(`与「${key}」相关的命令`, hits);
        }
    }

    const sections = Object.entries(HELP_TOPICS)
        .map(([title, entries]) => renderGroup(title, entries))
        .join('\n\n');

    return [
        'snh48 — SNH48 GROUP / 口袋 48 命令行工具',
        '',
        '用法：snh48 <命令> [参数] [选项]',
        '',
        sections,
        '',
        renderGroup('全局选项', GLOBAL_FLAGS),
        '',
        renderGroup('环境变量', ENV_VARS)
    ].join('\n');
}

module.exports = { HELP_TOPICS, renderHelp };
