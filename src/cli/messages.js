// 口袋房间消息的规范化。原始条目里正文散落在 bodys / msgContent / extInfo 三处，
// 且 extInfo 是一段可能含超长整数的 JSON 字符串，需要先修补再解析。

const TYPE_LABELS = {
    TEXT: '文本',
    IMAGE: '图片',
    VIDEO: '视频',
    AUDIO: '语音',
    EXPRESSIMAGE: '表情',
    REPLY: '回复',
    FLIPCARD: '翻牌',
    FLIPCARD_AUDIO: '语音翻牌',
    FLIPCARD_VIDEO: '视频翻牌',
    LIVEPUSH: '直播推送',
    OPEN_LIVE: '公演直播',
    TRIP: '行程',
    DELETE: '撤回',
    GIFT_TEXT: '礼物',
    GIFTREPLY: '礼物回复',
    PRESENT_TEXT: '礼物',
    AGENDA: '日程',
    VOTE: '投票'
};

function parseLooseJson(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;

    try {
        // 雪花 ID 超出 JS 安全整数范围，先转成字符串再解析。
        return JSON.parse(String(value).replace(/:\s*([0-9]{16,})/g, ':"$1"'));
    } catch (error) {
        return null;
    }
}

function normalizeMediaUrl(value) {
    const mediaPath = String(value || '').trim();
    if (!mediaPath) return '';
    if (/^https?:\/\//i.test(mediaPath)) return mediaPath;
    if (mediaPath.includes('48.cn')) return `https://${mediaPath.replace(/^\/+/, '')}`;
    return mediaPath.startsWith('/')
        ? `https://source3.48.cn${mediaPath}`
        : `https://source3.48.cn/${mediaPath}`;
}

function extractText(body) {
    if (body === null || body === undefined) return '';
    if (typeof body === 'string') {
        const parsed = parseLooseJson(body);
        if (parsed && typeof parsed === 'object') return extractText(parsed);
        return body;
    }
    if (typeof body !== 'object') return String(body);

    return String(
        body.text
        || body.content
        || body.answer
        || body.question
        || body.title
        || body.blessMessage
        || ''
    );
}

function normalizeMessage(raw = {}) {
    const ext = parseLooseJson(raw.extInfo) || {};
    const body = parseLooseJson(raw.bodys) || raw.bodys;
    const type = String(raw.msgType || raw.messageType || ext.messageObject || 'TEXT').toUpperCase();
    const user = ext.user || {};

    const message = {
        msgId: String(raw.msgIdClient || raw.msgId || ext.messageId || ''),
        time: Number(raw.msgTime || raw.messageTime || 0) || 0,
        type,
        typeLabel: TYPE_LABELS[type] || type,
        senderId: String(raw.senderId || user.userId || ext.senderId || ''),
        senderName: String(user.nickName || user.nickname || raw.senderName || raw.nickName || '').trim(),
        text: '',
        media: '',
        extra: {}
    };

    switch (type) {
        case 'IMAGE':
        case 'EXPRESSIMAGE':
            message.media = normalizeMediaUrl((body && body.url) || ext.url || raw.msgContent);
            message.text = extractText(body) || `[${message.typeLabel}]`;
            break;
        case 'VIDEO':
        case 'AUDIO':
            message.media = normalizeMediaUrl((body && body.url) || ext.url || raw.msgContent);
            message.extra.duration = Number((body && body.duration) || ext.duration || 0) || 0;
            message.text = `[${message.typeLabel}]`;
            break;
        case 'REPLY': {
            // bodys.replyInfo = { replyName 被回复者, replyText 被回复内容, text 本条回复 }
            const info = (body && body.replyInfo) || ext.replyInfo || {};
            message.extra.replyTo = String(info.replyName || '');
            message.extra.replyText = String(info.replyText || '');
            const reply = String(info.text || '');
            message.text = message.extra.replyTo
                ? `回复 ${message.extra.replyTo}「${message.extra.replyText}」：${reply}`
                : reply || `[${message.typeLabel}]`;
            break;
        }
        case 'FLIPCARD':
        case 'FLIPCARD_AUDIO':
        case 'FLIPCARD_VIDEO': {
            const info = ext.filpCardInfo || ext.flipCardInfo || (body && body.filpCardInfo) || {};
            message.extra.question = String(info.question || '');
            message.extra.answer = String(info.answer || '');
            message.media = normalizeMediaUrl(info.answer && /\.(mp4|aac|m4a|mp3)$/i.test(info.answer) ? info.answer : '');
            message.text = message.extra.question
                ? `问：${message.extra.question}${message.extra.answer ? ` / 答：${message.extra.answer}` : ''}`
                : extractText(body);
            break;
        }
        case 'LIVEPUSH':
        case 'OPEN_LIVE': {
            const info = ext.livePushInfo || ext.openLiveInfo || (body && body.livePushInfo) || {};
            message.extra.liveId = String(info.liveId || ext.liveId || '');
            message.extra.title = String(info.liveTitle || info.title || '');
            message.media = normalizeMediaUrl(info.liveCover || '');
            message.text = `[${message.typeLabel}] ${message.extra.title}`.trim();
            break;
        }
        case 'GIFT_TEXT':
        case 'PRESENT_TEXT': {
            const info = ext.giftInfo || (body && body.giftInfo) || {};
            message.extra.giftName = String(info.giftName || info.name || '');
            message.extra.giftNum = Number(info.giftNum || info.num || 1) || 1;
            message.text = `[礼物] ${message.extra.giftName} x${message.extra.giftNum}`;
            break;
        }
        default:
            message.text = extractText(body) || extractText(raw.msgContent) || `[${message.typeLabel}]`;
            break;
    }

    message.text = message.text.replace(/\s+$/g, '');
    return message;
}

function extractMessageList(content = {}) {
    const list = content.messageList || content.message || content.list || [];
    return Array.isArray(list) ? list : [];
}

module.exports = {
    TYPE_LABELS,
    parseLooseJson,
    normalizeMediaUrl,
    normalizeMessage,
    extractMessageList
};
