// 账号类：登录（短信 / 扫码 / Token）、签到、大小号切换、余额。

const { CliError, emit, table, formatTimestamp } = require('../output');
const { unwrap } = require('../runtime');
const { flagNumber, flagString } = require('../args');
const { requireInteractive, askRequired, askChoice, status } = require('../prompt');
const { renderQrFromDataUri, saveQrImage } = require('../qr');

const MOBILE_PATTERN = /^\d{5,15}$/;

function saveToken(context, token) {
    context.settings.setToken(token);
    context.token = token;
    return token;
}

// 短信发送可能被图形验证拦下，交互模式里直接把题目摆出来让用户选。
async function sendSmsCode(context, { mobile, area, answer = '', interactive = false }) {
    const result = await context.pocket.loginSendSms({ mobile, area, answer });
    if (result.success) return result;

    if (!result.needVerification) {
        throw new CliError(result.msg || '验证码发送失败');
    }

    const options = Array.isArray(result.options) ? result.options : [];
    if (!interactive || options.length === 0) {
        throw new CliError('需要先通过图形验证', {
            hint: `问题：${result.question}；候选：${options.join(' / ')}。带上 --answer <答案> 重试，或改用交互式 \`snh48 login\`。`,
            data: { question: result.question, options }
        });
    }

    const choice = await askChoice(`需要先回答验证问题：${result.question}`, options);
    return sendSmsCode(context, { mobile, area, answer: choice.value, interactive: false });
}

async function completeSmsLogin(context, { mobile, code }) {
    const response = await context.pocket.loginByCode({ mobile, code });
    if (!response || response.status !== 200) {
        throw new CliError(response?.message || '登录失败');
    }

    const content = response.content || {};
    const token = String(content.token || '');
    if (!token) throw new CliError('登录返回中没有 token');

    saveToken(context, token);
    const userInfo = content.userInfo || content;

    return {
        token,
        userId: String(userInfo.userId || ''),
        nickname: String(userInfo.nickname || userInfo.nickName || '')
    };
}

// `snh48 login`：一条命令走完「输手机号 → 收验证码 → 输验证码 → 存 Token」。
async function loginInteractive(context, positionals) {
    requireInteractive('snh48 login sms <手机号> 然后 snh48 login code <手机号> <验证码>；或 snh48 login qr');

    const area = flagString(context.flags, 'area', '86');
    const mobile = positionals[0] || await askRequired('手机号：', {
        validate: (value) => (MOBILE_PATTERN.test(value) ? '' : '手机号格式不对，只填数字')
    });

    status(`正在向 ${mobile} 发送验证码…`);
    await sendSmsCode(context, { mobile, area, answer: flagString(context.flags, 'answer', ''), interactive: true });
    status('验证码已发送。');

    const code = await askRequired('验证码：', {
        validate: (value) => (/^\d{4,8}$/.test(value) ? '' : '验证码应为 4-8 位数字')
    });

    const result = await completeSmsLogin(context, { mobile, code });
    return emit(context, { method: 'sms', ...result },
        (data) => `登录成功：${data.nickname || data.userId}\nToken 已写入本地设置（与桌面端共用）。`);
}

// 扫码走的是 live.48.cn，拿到的是站点 Cookie 而不是口袋 Token——两套凭据要分清。
async function loginQr(context) {
    const created = await context.pocket.loginCreateQr();
    if (!created.success) throw new CliError(created.msg || '创建二维码失败');

    const interactive = process.stderr.isTTY;
    const art = interactive ? renderQrFromDataUri(created.qrImage) : null;
    const savedPath = art ? '' : saveQrImage(created.qrImage, context.cacheDir);

    if (art) {
        process.stderr.write(`${art}\n`);
        status('用「口袋48」App 扫描上方二维码并确认登录。');
    } else if (savedPath) {
        status(`二维码已保存到：${savedPath}\n用「口袋48」App 扫描该图片并确认登录。`);
    } else {
        throw new CliError('二维码渲染失败，且无法保存为图片');
    }

    const timeoutSeconds = flagNumber(context.flags, 'timeout', created.expiresInSeconds || 300);
    const deadline = Date.now() + timeoutSeconds * 1000;
    let cancelled = false;

    const onInterrupt = () => { cancelled = true; };
    process.once('SIGINT', onInterrupt);

    try {
        while (Date.now() < deadline && !cancelled) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const polled = await context.pocket.loginPollQr({ code: created.code });

            if (polled.loggedIn) {
                return emit(context, {
                    method: 'qr',
                    scope: 'live.48.cn',
                    accountInfo: polled.accountInfo || null,
                    pocketTokenSaved: false
                }, (data) => [
                    `扫码成功：${data.accountInfo?.nickname || data.accountInfo?.username || 'live.48.cn 账号'}`,
                    'live.48.cn 登录态已保存（用于公演直播源）。',
                    '注意：这不是口袋 Token，房间消息/口袋直播等功能仍需 `snh48 login` 走短信登录。'
                ].join('\n'));
            }

            if (polled.expired) throw new CliError(polled.msg || '二维码已过期，请重新运行');
            if (polled.success === false) throw new CliError(polled.msg || '轮询登录状态失败');
        }
    } finally {
        process.removeListener('SIGINT', onInterrupt);
        await context.pocket.loginCancelQr({ code: created.code }).catch(() => {});
    }

    throw new CliError(cancelled ? '已取消扫码登录' : '扫码超时，二维码已失效', { code: cancelled ? 130 : 1 });
}

async function loginSms(context, [mobile]) {
    if (!mobile) throw new CliError('用法：snh48 login sms <手机号> [--area 86] [--answer 验证答案]');

    await sendSmsCode(context, {
        mobile: String(mobile),
        area: flagString(context.flags, 'area', '86'),
        answer: flagString(context.flags, 'answer', ''),
        interactive: false
    });

    return emit(context, { mobile: String(mobile), sent: true },
        () => `验证码已发送至 ${mobile}，接着运行：snh48 login code ${mobile} <验证码>`);
}

async function loginCode(context, [mobile, code]) {
    if (!mobile || !code) throw new CliError('用法：snh48 login code <手机号> <验证码>');

    const result = await completeSmsLogin(context, { mobile: String(mobile), code: String(code) });
    return emit(context, { method: 'sms', ...result },
        (data) => `登录成功：${data.nickname || data.userId}\nToken 已写入本地设置（与桌面端共用）。`);
}

async function loginToken(context, [token]) {
    const value = String(token || '').trim();
    if (!value) throw new CliError('用法：snh48 login token <token>');

    saveToken(context, value);

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

// 两套凭据各查各的：口袋 Token 管消息/直播，live.48.cn Cookie 管公演直播源。
async function loginStatus(context) {
    const pocket = { loggedIn: false, nickname: '', userId: '', error: '' };

    if (context.token) {
        const auth = await context.auth();
        const result = await context.pocket.loginCheckToken(auth);
        if (result.success) {
            const info = result.userInfo || {};
            pocket.loggedIn = true;
            pocket.nickname = String(info.nickname || info.nickName || '');
            pocket.userId = String(info.userId || '');
        } else {
            pocket.error = result.msg || 'Token 无效';
        }
    } else {
        pocket.error = '未设置 Token';
    }

    const qr = await context.pocket.loginQrStatus().catch(() => ({ loggedIn: false }));

    return emit(context, {
        pocket,
        live48: {
            loggedIn: Boolean(qr.loggedIn),
            accountInfo: qr.accountInfo || null,
            loginAt: qr.loginAt || ''
        }
    }, (data) => [
        `口袋 48      ${data.pocket.loggedIn
            ? `已登录：${data.pocket.nickname || data.pocket.userId}`
            : `未登录（${data.pocket.error}）`}`,
        `live.48.cn   ${data.live48.loggedIn
            ? `已登录：${data.live48.accountInfo?.nickname || data.live48.accountInfo?.username || ''}`
            : '未登录'}`
    ].join('\n'));
}

async function logout(context) {
    context.settings.clearToken();
    const alsoQr = context.flags.all === true;
    if (alsoQr) {
        context.settings.removeSettingValue('live48LoginCookie');
        context.settings.removeSettingValue('live48UserInfo');
        context.settings.removeSettingValue('live48LoginAt');
    }

    return emit(context, { cleared: true, live48Cleared: alsoQr },
        (data) => (data.live48Cleared ? '已清除口袋 Token 与 live.48.cn 登录态。' : '已清除本地 Token（--all 可一并清除 live.48.cn）。'));
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
    login: loginInteractive,
    'login qr': loginQr,
    'login sms': loginSms,
    'login code': loginCode,
    'login token': loginToken,
    'login status': loginStatus,
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
