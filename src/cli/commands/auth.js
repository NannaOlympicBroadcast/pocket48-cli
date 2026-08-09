// 账号类：登录、Token 管理、签到、大小号切换、余额。

const { CliError, emit, table, formatTimestamp } = require('../output');
const { unwrap } = require('../runtime');
const { flagString } = require('../args');

async function loginSms(context, [mobile]) {
    if (!mobile) throw new CliError('用法：snh48 login sms <手机号> [--area 86] [--answer 验证答案]');

    const result = await context.pocket.loginSendSms({
        mobile: String(mobile),
        area: flagString(context.flags, 'area', '86'),
        answer: flagString(context.flags, 'answer', '')
    });

    if (result.needVerification) {
        throw new CliError('需要先通过图形验证', {
            hint: `问题：${result.question}；候选：${(result.options || []).join(' / ')}。带上 --answer <答案> 重试。`,
            data: { question: result.question, options: result.options }
        });
    }

    if (!result.success) throw new CliError(result.msg || '验证码发送失败');

    return emit(context, { mobile: String(mobile), sent: true },
        () => `验证码已发送至 ${mobile}，接着运行：snh48 login code ${mobile} <验证码>`);
}

async function loginCode(context, [mobile, code]) {
    if (!mobile || !code) throw new CliError('用法：snh48 login code <手机号> <验证码>');

    const response = await context.pocket.loginByCode({ mobile: String(mobile), code: String(code) });
    if (!response || response.status !== 200) {
        throw new CliError(response?.message || '登录失败');
    }

    const content = response.content || {};
    const token = String(content.token || '');
    if (!token) throw new CliError('登录返回中没有 token');

    context.settings.setToken(token);
    context.token = token;

    const userInfo = content.userInfo || content;
    return emit(context, {
        token,
        userId: String(userInfo.userId || ''),
        nickname: String(userInfo.nickname || userInfo.nickName || '')
    }, (data) => `登录成功：${data.nickname || data.userId}\nToken 已写入本地设置（与桌面端共用）。`);
}

async function loginToken(context, [token]) {
    const value = String(token || '').trim();
    if (!value) throw new CliError('用法：snh48 login token <token>');

    context.settings.setToken(value);
    context.token = value;

    const auth = await context.auth();
    const result = await context.pocket.loginCheckToken(auth);
    if (!result.success) {
        context.settings.clearToken();
        throw new CliError(result.msg || 'Token 校验失败，已回滚');
    }

    return emit(context, { saved: true, userInfo: result.userInfo },
        (data) => `Token 有效，已保存。当前账号：${data.userInfo?.nickname || data.userInfo?.userId || '未知'}`);
}

async function whoami(context) {
    const auth = await context.auth();
    const result = await context.pocket.loginCheckToken(auth);
    if (!result.success) throw new CliError(result.msg || 'Token 无效或已过期');

    const info = result.userInfo || {};
    return emit(context, info, (data) => [
        `昵称    ${data.nickname || data.nickName || ''}`,
        `用户 ID ${data.userId || ''}`,
        `星币    ${data.money ?? ''}`,
        `等级    ${data.level ?? ''}`
    ].join('\n'));
}

async function logout(context) {
    context.settings.clearToken();
    return emit(context, { cleared: true }, () => '已清除本地 Token。');
}

async function checkin(context) {
    const auth = await context.auth();
    const result = await context.pocket.checkIn(auth);
    if (!result.success) throw new CliError(result.msg || '签到失败');

    return emit(context, { message: result.msg, content: result.content },
        (data) => data.message || '签到成功');
}

async function checkinToday(context) {
    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchCheckinToday(auth), '获取签到状态失败');
    return emit(context, content);
}

async function accountSwitch(context, [targetUserId]) {
    if (!targetUserId) throw new CliError('用法：snh48 account switch <目标用户ID>');

    const auth = await context.auth();
    const content = unwrap(
        await context.pocket.switchBigSmall({ ...auth, targetUserId: String(targetUserId) }),
        '切换账号失败'
    );

    const token = String(content?.token || '');
    if (token) {
        context.settings.setToken(token);
        context.token = token;
    }

    return emit(context, { switched: true, tokenUpdated: Boolean(token), content },
        () => `已切换到账号 ${targetUserId}${token ? '，Token 已更新' : ''}`);
}

async function accountMoney(context) {
    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchUserMoney(auth), '获取余额失败');
    return emit(context, content);
}

async function accountUnread(context) {
    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchUnreadMessageCount(auth), '获取未读数失败');
    return emit(context, content);
}

async function invoiceOrders(context) {
    const auth = await context.auth();
    const content = unwrap(await context.pocket.fetchInvoiceOrderList({
        ...auth,
        yearMonth: flagString(context.flags, 'month', '')
    }), '获取消费订单失败');

    const rows = Array.isArray(content?.orderList) ? content.orderList : [];
    return emit(context, content, () => table(rows, [
        { key: 'orderNo', label: '订单号', max: 24 },
        { key: 'money', label: '金额' },
        { label: '时间', value: (row) => formatTimestamp(row.createTime) }
    ]));
}

const commands = {
    'login sms': loginSms,
    'login code': loginCode,
    'login token': loginToken,
    'login status': whoami,
    whoami,
    logout,
    checkin,
    'checkin status': checkinToday,
    'account switch': accountSwitch,
    'account money': accountMoney,
    'account unread': accountUnread,
    'account orders': invoiceOrders
};

module.exports = { commands };
