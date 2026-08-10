// 口袋功能类：动态、微博、翻牌、48 区。

const { CliError, emit, table, formatTimestamp } = require('../output');
const { unwrap } = require('../runtime');
const { flagNumber, flagString } = require('../args');
const { resolveMember } = require('../roster');
const { normalizeMessage, extractMessageList, parseLooseJson } = require('../messages');

const FEED_COLUMNS = [
    { label: '时间', value: (row) => formatTimestamp(row.time) },
    { key: 'typeLabel', label: '类型' },
    { key: 'text', label: '内容', max: 72 }
];

async function dynamic(context, positionals) {
    const query = positionals.join(' ').trim();
    if (!query) throw new CliError('用法：snh48 dynamic <成员名|memberId> [--since <时间戳>]');

    const { memberId, member } = await resolveMember(context, query);
    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchMemberDynamicMessages({
        ...auth,
        ownerId: memberId,
        nextTime: flagNumber(context.flags, 'since', 0)
    }), '获取动态失败');

    const items = extractMessageList(content).map(normalizeMessage);
    return emit(context, { member, memberId, total: items.length, items },
        (data) => table(data.items, FEED_COLUMNS));
}

async function weibo(context, positionals) {
    const query = positionals.join(' ').trim();
    if (!query) throw new CliError('用法：snh48 weibo <成员名|memberId> [--since <时间戳>]');

    const { memberId, member } = await resolveMember(context, query);
    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchMemberWeiboMessages({
        ...auth,
        ownerId: memberId,
        nextTime: flagNumber(context.flags, 'since', 0)
    }), '获取微博失败');

    const items = extractMessageList(content).map(normalizeMessage);
    return emit(context, { member, memberId, total: items.length, items },
        (data) => table(data.items, FEED_COLUMNS));
}

async function openLiveHistory(context, positionals) {
    const query = positionals.join(' ').trim();
    if (!query) throw new CliError('用法：snh48 member lives <成员名|memberId>');

    const { memberId, member } = await resolveMember(context, query);
    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchOpenLive({
        ...auth,
        memberId,
        nextTime: flagNumber(context.flags, 'since', 0)
    }), '获取直播记录失败');

    const items = extractMessageList(content).map(normalizeMessage);
    return emit(context, { member, memberId, total: items.length, items },
        (data) => table(data.items, FEED_COLUMNS));
}

async function flipList(context) {
    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchFlipList({
        ...auth,
        beginLimit: flagNumber(context.flags, 'offset', 0),
        limit: flagNumber(context.flags, 'limit', 20)
    }), '获取翻牌列表失败');

    const rows = (Array.isArray(content?.questionList) ? content.questionList
        : (Array.isArray(content?.list) ? content.list : [])).map((item) => ({
        questionId: String(item.questionId || item.id || ''),
        memberName: String(item.starName || item.memberName || ''),
        question: String(item.question || ''),
        answer: String(item.answer || ''),
        answered: Boolean(item.answer),
        time: Number(item.answerTime || item.questionTime || item.createTime || 0) || 0
    }));

    return emit(context, { total: rows.length, flips: rows }, (data) => table(data.flips, [
        { label: '时间', value: (row) => formatTimestamp(row.time) },
        { key: 'memberName', label: '成员', max: 12 },
        { key: 'question', label: '提问', max: 34 },
        { key: 'answer', label: '回答', max: 34 }
    ]));
}

async function flipPrices(context, positionals) {
    const query = positionals.join(' ').trim();
    if (!query) throw new CliError('用法：snh48 flip prices <成员名|memberId>');

    const { memberId, member } = await resolveMember(context, query);
    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchFlipPrices({ ...auth, memberId }), '获取翻牌价格失败');
    return emit(context, { member, memberId, prices: content });
}

async function flipAsk(context, positionals) {
    const [target, ...rest] = positionals;
    const question = rest.join(' ').trim();
    if (!target || !question) {
        throw new CliError('用法：snh48 flip ask <成员名|memberId> <问题> [--price <价格ID>]');
    }

    const { memberId, member } = await resolveMember(context, target);
    const auth = await context.auth();

    const payload = {
        memberId: String(memberId),
        question,
        questionType: flagNumber(context.flags, 'type', 1)
    };
    const priceId = flagString(context.flags, 'price', '');
    if (priceId) payload.priceId = priceId;

    const result = await context.pocket.sendFlipQuestion({ ...auth, payload });
    if (!result.success) throw new CliError(result.msg || '提问失败');

    return emit(context, { memberId, member, question, sent: true },
        () => `已向 ${member ? member.name : memberId} 提问：${question}`);
}

async function flipOperate(context, [questionId]) {
    if (!questionId) throw new CliError('用法：snh48 flip delete <questionId> [--type 1]');

    const auth = await context.auth();
    const result = await context.pocket.operateFlipQuestion({
        ...auth,
        questionId: String(questionId),
        operateType: flagNumber(context.flags, 'type', 1)
    });

    if (!result.success) throw new CliError(result.msg || '操作失败');
    return emit(context, { questionId: String(questionId), done: true }, () => '操作成功');
}

function normalizeAreaPosts(content) {
    const list = content?.postList || content?.list || content?.data || [];
    if (!Array.isArray(list)) return [];

    return list.map((item) => ({
        postId: String(item.postId || item.id || ''),
        title: String(item.title || ''),
        author: String(item.userName || item.nickName || item.user?.nickName || ''),
        content: String(item.content || '').replace(/\s+/g, ' ').trim(),
        time: Number(item.createTime || item.ctime || 0) || 0
    }));
}

async function areaNewest(context) {
    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchArea48Newest({
        ...auth,
        nextId: flagNumber(context.flags, 'next', 0)
    }), '获取 48 区最新帖失败');

    const rows = normalizeAreaPosts(content);
    return emit(context, { total: rows.length, posts: rows }, (data) => table(data.posts, [
        { label: '时间', value: (row) => formatTimestamp(row.time) },
        { key: 'author', label: '作者', max: 12 },
        { key: 'title', label: '标题', max: 30 },
        { key: 'content', label: '内容', max: 40 }
    ]));
}

async function areaRecommend(context) {
    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchArea48Recommend({
        ...auth,
        nextId: flagNumber(context.flags, 'next', 0)
    }), '获取 48 区推荐失败');

    const rows = normalizeAreaPosts(content);
    return emit(context, { total: rows.length, posts: rows }, (data) => table(data.posts, [
        { label: '时间', value: (row) => formatTimestamp(row.time) },
        { key: 'author', label: '作者', max: 12 },
        { key: 'title', label: '标题', max: 30 },
        { key: 'content', label: '内容', max: 40 }
    ]));
}

async function areaPost(context, [postId]) {
    if (!postId) throw new CliError('用法：snh48 area post <postId>');

    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchArea48PostDetails({ ...auth, postId: String(postId) }), '获取帖子详情失败');
    return emit(context, content);
}

async function areaComments(context, [resourceId]) {
    if (!resourceId) throw new CliError('用法：snh48 area comments <resourceId>');

    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchArea48Comments({
        ...auth,
        resourceId: String(resourceId),
        next: flagNumber(context.flags, 'next', 0)
    }), '获取评论失败');

    return emit(context, content);
}

async function maskWords(context, positionals) {
    const text = positionals.join(' ');
    const auth = context.token ? await context.auth() : {};
    const content = unwrap(await context.pocket.fetchPocketMaskWords({ ...auth, clientTime: 0 }), '获取屏蔽词失败');
    const words = Array.isArray(content?.words) ? content.words : [];

    if (words.length === 0) {
        throw new CliError('屏蔽词库为空，未能取到词表', {
            hint: '词表托管在 source.48.cn，检查该域名是否可达；已登录时会改用口袋接口下发的地址。'
        });
    }

    if (!text) {
        return emit(context, { total: words.length, words: words.slice(0, flagNumber(context.flags, 'limit', 100)) },
            (data) => `共 ${data.total} 个屏蔽词（前 ${data.words.length} 个）\n${data.words.join('  ')}`);
    }

    const hits = words.filter((word) => word && text.includes(word));
    return emit(context, { text, blocked: hits.length > 0, hits },
        (data) => (data.blocked ? `命中屏蔽词：${data.hits.join('、')}` : '未命中屏蔽词'));
}

async function rawApi(context, [apiPath, postData]) {
    if (!apiPath) throw new CliError('用法：snh48 api <接口路径> [JSON 请求体]');

    const parsed = postData ? parseLooseJson(postData) : {};
    if (postData && !parsed) throw new CliError('请求体不是合法 JSON');

    const response = await context.pocket.fetchPocketApiPath({ path: apiPath, postData: parsed || {} });
    if (response && response.status && response.status !== 200) {
        throw new CliError(response.message || `接口返回状态 ${response.status}`, { data: response });
    }

    return emit(context, response, () => JSON.stringify(response, null, 2));
}

const commands = {
    dynamic,
    weibo,
    'member lives': openLiveHistory,
    'flip list': flipList,
    'flip prices': flipPrices,
    'flip ask': flipAsk,
    'flip delete': flipOperate,
    'area newest': areaNewest,
    'area recommend': areaRecommend,
    'area post': areaPost,
    'area comments': areaComments,
    maskword: maskWords,
    api: rawApi
};

module.exports = { commands };
