// DeepSeek Harness 插件入口：把 snh48 CLI 的口袋 48 能力注册成模型可调用的工具。
//
// 用法见 ../cordis.patch.yml —— 该 patch 由 package.json 的 dsh.bundle 声明，
// `dsh plugin add` 装上本包后这一层就会自动生效。

import { createTools } from './tools.mjs'

export const name = 'snh48-pocket48'

// 等 tools 注册表就绪。没有这行，apply 可能跑在 ctx.tools 存在之前。
export const inject = ['tools']

/**
 * @param {object} ctx     cordis Context
 * @param {object} [config] 见 README 的「配置」一节
 */
export function apply(ctx, config) {
    const resolved = normalizeConfig(config)

    for (const tool of createTools(resolved)) {
        // ctx.tools.register 返回的 disposer 由 cordis 挂在插件上，
        // 插件卸载时工具会自动注销，这里不需要自己收尾。
        ctx.tools.register(tool)
    }
}

// 刻意不引 cordis 的 Schema：配置项只有三个且都有安全默认值，
// 手写归一化能少一个跨版本的耦合点。非法值一律退回默认，不让插件因为配置写错而加载失败。
function normalizeConfig(config = {}) {
    const timeoutMs = Number(config?.timeoutMs)

    return {
        // 留空则沿用 CLI 自己的解析顺序：SNH48_TOKEN 环境变量 → 与桌面端共用的本地设置。
        token: String(config?.token || '').trim(),
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120_000,
        // 默认只读。打开后 snh48_run 才允许送礼、发私信、翻牌、关注、签到与直连 api。
        allowWrites: config?.allowWrites === true,
    }
}
