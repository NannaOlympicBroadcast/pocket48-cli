---
name: snh48-cli
description: 驱动 `snh48` 命令行工具，查询 SNH48 GROUP（SNH48/BEJ48/GNZ48/CKG48/CGT48）与口袋 48 的数据——成员名册与档案、房间消息抓取与检索、直播与回放地址、公演场次与票务、翻牌记录、鸡腿榜、48 区、私信阅读。当用户问到 48 系成员资料/生日/队伍/期数、某成员在口袋房间说了什么、谁在直播、这周有什么公演、票还有没有、翻牌记录、鸡腿榜排名，或直接提到 snh48 / 口袋48 / pocket48 / 星梦剧院 / 牙牙消息 时使用本 skill；即使用户没点名工具也应主动使用。
metadata:
  version: "2.0.0"
  tags:
    - snh48
    - pocket48
    - cli
    - dsh-plugin
---

# snh48 CLI

`snh48` 把桌面端「牙牙消息」的口袋 48 能力拆成了可脚本化的子命令。本 skill 教你如何驱动它。

## 调用约定

- 直接跑 `snh48 <命令>`。本 skill 随插件分发，插件的 `bin/` 会被加进 PATH，不必关心装在哪。
  没进 PATH 时退回 `"${CLAUDE_PLUGIN_ROOT}"/bin/snh48 <命令>`；在仓库里开发则是 `node bin/snh48.js <命令>`。
- 报 `缺少运行时依赖` 时，在插件目录执行一次 `npm install --omit=dev` 即可。
- **始终加 `--json`**。非 TTY 下虽然默认就是 JSON，但显式传更稳妥，输出格式也才有保证。
- 输出恒为一个信封，先看 `ok` 再取 `data`：

```json
{ "ok": true,  "command": "member search", "data": { … } }
{ "ok": false, "command": "member info",   "error": "名册中找不到成员「…」", "hint": "…" }
```

- 退出码：`0` 成功，`1` 命令出错（`ok:false`），`127` 未知命令。
- 报错时 `hint` 往往直接给出了下一步该怎么做，**先读 hint 再重试**，不要盲目换命令。

## 成员寻址

几乎所有涉及成员的命令都接受**中文名、昵称、拼音、缩写或数字 ID**，CLI 会查名册自动解析：

```bash
snh48 member info 杨冰怡 --json
snh48 member info 二水   --json   # 昵称
snh48 member info 6744   --json   # 口袋 memberId
```

- 名册里**存在重名**（例如分属 SNH48 与 GNZ48 的两位「李沁洁」）。全名精确命中多条时：只有一位在籍就取在籍那位，否则**报错并在 hint 里列出候选**，不会静默选错人。模糊匹配同分时同样报错。遇到这种错误就改用 `memberId` 重试。
- 名册合并了 `data.gnz.hk`（含 memberId / channelId / serverId，覆盖毕业成员）与官网在籍名册（期数、队伍、口号、年度排名），缓存 24 小时，`--refresh` 强制刷新。
- 「在籍」以官网名册 status=99 为准并剔除荣誉毕业生，当前约 311 人；`--all` 可把毕业成员一并列出。
- 房间类命令还需要 `channelId`，同样由名字自动解析；成员没开口袋房间时会明确报错。

## 免登录可用的命令

这些不需要 Token，优先用它们回答问题：

| 命令 | 用途 |
| --- | --- |
| `roster --search <关键词>` | 名册检索，支持 `--group SNH48 --team X --generation 四期 --limit --all` |
| `member search <关键词>` | 同上，输出更聚焦 |
| `member info <成员>` | 成员档案（未登录时给名册资料，已登录会附口袋档案） |
| `shows --group SNH48 --days 7` | 近期公演场次 + 票务状态（VIP票有售/普通票有售/售罄）+ 购票链接 |
| `plan --group SNH48 --days 7` | 公演日程摘要（按天合并，含参演成员与地址） |
| `maskword <文本>` | 口袋屏蔽词检测 |

`--group` 接受 `SNH48 / BEJ48 / GNZ48 / CKG48 / CGT48`，也接受数字 gid。

## 登录：两套互不相通的凭据

| 凭据 | 怎么拿 | 管什么 |
| --- | --- | --- |
| **口袋 48 Token** | 短信登录 / 直接注入 | 房间消息、私信、直播、翻牌、鸡腿榜——**绝大多数命令** |
| **live.48.cn Cookie** | 扫码登录 | 仅公演直播源 |

**扫码不会产生口袋 Token。** 用户扫完码后 `room messages` 依然会报未登录——这不是 bug，要跟用户解释清楚，让其再走一次短信登录。

先查状态（一次看两套）：

```bash
snh48 login status --json
```

返回 `{ pocket: { loggedIn, nickname, error }, live48: { loggedIn, accountInfo } }`。

### 你能直接跑的

```bash
snh48 login token <token>   # 用户已有 Token 时注入，会先校验再落盘
snh48 login qr              # 扫码（非 TTY 下会把二维码存成 PNG 并回传路径）
```

`login qr` 在 TTY 里直接把二维码画在终端上；非 TTY（也就是你调用时）会保存 PNG 到缓存目录，
提示语走 stderr，stdout 仍是 JSON。默认等 300 秒，`--timeout <秒>` 可调。
超时返回 `ok:false / 扫码超时`。

### 你不能替用户跑的

**短信登录必须由用户自己完成**——验证码只发到他们手机上。缺 Token 时把下面的命令给用户，让他们自己在终端执行：

```bash
snh48 login                 # 交互式：问手机号 → 发码 → 输验证码 → 存 Token
snh48 login 13800138000     # 同上，手机号先给好
```

`snh48 login` 是交互式的，**在非 TTY 下会直接报错**（`当前不是交互式终端`），所以你调用它没有意义。
如果用户希望你分步驱动，可以用这两条脚本化命令，但验证码仍得用户口述给你：

```bash
snh48 login sms  <手机号>            # 发码；遇图形验证会在 hint 里给出题目与候选，用 --answer 重试
snh48 login code <手机号> <验证码>   # 用验证码换 Token 并保存
```

Token 与桌面端共用一份本地设置；也可用环境变量 `SNH48_TOKEN` 或 `--token` 临时注入。
`logout` 清口袋 Token，`logout --all` 连 live.48.cn 一起清。

登录后可用：

| 分组 | 代表命令 |
| --- | --- |
| 消息 | `room messages <成员> --limit 50`、`room search <成员> <关键词> --scan 500`、`room stats <成员>`、`room album <成员>`、`room radio <成员>`、`room list` |
| 直播 | `live list`、`live replay <成员>`、`live info <liveId>`（含播放地址）、`live rank <liveId>`、`openlive list` |
| 互动 | `dynamic <成员>`、`weibo <成员>`、`flip list`、`flip prices <成员>`、`member lives <成员>` |
| 数据 | `rank week`、`rank list`、`rank year`、`rank member <成员>`、`albums`、`trip [成员]` |
| 48区 | `area newest`、`area recommend`、`area post <postId>` |
| 账号 | `whoami`、`login status`、`checkin`、`account money`、`account unread`、`member following` |
| 私信 | `dm list`、`dm read <成员>` |

完整清单：`snh48 help --json` 或 `snh48 help 消息`。

## 本 skill 只做只读查询

上面这些命令都不改变任何东西，正常跑就行，无需确认。

**写操作不在本 skill 的范围内**——发私信、翻牌提问与撤回、直播送礼、关注/取关、
签到、大小号切换，这些会真实送达对方或消耗用户的鸡腿/星币，归 `pocket48-write` 插件的
`snh48-write` skill 管，那边带了「先复述、等用户确认、再执行」的完整流程。

用户要求做写操作而 `pocket48-write` 没装时，别自己拼命令硬发，告诉他们：

```
/plugin install pocket48-write@pocket48
```

装完默认是停用的，还要 `/plugin enable pocket48-write@pocket48` 才生效。

另外，口袋 48 **没有**「往成员房间发消息」这条路——`room *` 全是只读的。
想对成员说话只有 `dm send`（私信）和 `flip ask`（翻牌）两条路，都在写插件里。

## 消息数据的形状

`room messages` / `dynamic` / `weibo` / `dm read` 返回的 `messages[]` 已经规范化，不必再解析口袋的 `extInfo`：

```json
{
  "msgId": "…", "time": 1754700000000, "type": "TEXT", "typeLabel": "文本",
  "senderId": "6744", "senderName": "杨冰怡",
  "text": "正文（翻牌会拼成「问：… / 答：…」）",
  "media": "https://source3.48.cn/…（图片/视频/语音才有）",
  "extra": {}
}
```

`time` 是毫秒时间戳。`type` 常见取值：`TEXT` `IMAGE` `VIDEO` `AUDIO` `EXPRESSIMAGE` `FLIPCARD` `LIVEPUSH` `GIFT_TEXT`。

## 分页与抓取量

- `room messages --limit N`：CLI 内部自动翻页直到攒够 N 条（上限 40 页）。默认只抓成员本人发言，`--all` 连房间里其他人的消息一起抓。
- `room search --scan N`：先抓 N 条再本地过滤关键词，默认 500。想搜更久远的历史就把 `--scan` 调大，代价是请求变多。
- `--since <毫秒时间戳>`：从某个时间点往前翻。

## 常见任务配方

```bash
# 「杨冰怡最近说了什么」
snh48 room messages 杨冰怡 --limit 30 --json

# 「她提过毕业吗」
snh48 room search 杨冰怡 毕业 --scan 800 --json

# 「这周 SNH48 有什么公演，票还有吗」
snh48 shows --group SNH48 --days 7 --json

# 「现在谁在直播」
snh48 live list --json

# 「找出 Team X 的在籍成员」
snh48 roster --team X --json

# 直连任意口袋接口（前面都不满足时的逃生舱）
snh48 api /user/api/v1/user/star/archives '{"memberId":6744}' --json
```

## 排错

- `尚未登录，缺少口袋 48 Token` → 让用户按上文登录，别自己硬试。
- `token解密失败` / `status 401005` → Token 过期，请用户重新登录。
- `当前不是交互式终端` → 你调了交互式的 `snh48 login`；改用 `login token` / `login qr`，或把 `login sms` + `login code` 交给用户。
- 用户说「我扫码了但还是提示没登录」→ 扫码只给 live.48.cn，口袋功能仍需短信登录，见上文凭据表。
- `需要先通过图形验证` → hint 里带了题目和候选，让用户选一个后用 `login sms <手机号> --answer <答案>` 重试。
- `「X」匹配到多位成员` → 按 hint 里的候选改用全名或 ID。
- `名册加载失败` → `data.gnz.hk` 或 `h5.48.cn` 不可达，检查网络；纯数字 ID 仍可直接用。
- 需要看调试日志时加 `--verbose`（日志走 stderr，不会污染 stdout 的 JSON）。

## 环境变量

- `SNH48_TOKEN` — 口袋 Token，优先级低于 `--token`、高于本地设置。
- `SNH48_CACHE_DIR` — 缓存目录，默认与桌面端共用。
- `SNH48_ROSTER_TTL` — 名册缓存秒数，默认 86400。
