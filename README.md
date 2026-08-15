# 牙牙消息
> 一个口袋48电脑端工具
<img width="689" height="495" alt="ScreenShot_2026-07-28_135511_018" src="https://github.com/user-attachments/assets/afbdb153-8382-40bd-aef8-1278525500c3" />


## 主要功能
### 消息类
- 消息抓取：抓取成员房间消息并一键导入至软件内。
- 消息检索：根据关键词查找成员房间中的历史消息，可根据日期及消息类型进行筛选。
- 消息统计：统计成员房间每日消息条数、互动次数、翻牌相关数据。

### 直播类
- 口袋直播：观看成员直播，支持送出直播间礼物。
- 直播回放：观看、下载成员直播回放。点击弹幕/字幕时间轴可跳转对应时间点。
- 房间上麦：收听、录制成员房间上麦。
- 公演直播：查看公演直播（B站源）。
- 切片：直播实时切片、录播回放切片、公演切片。

### 口袋功能类
- 口袋房间：查看关注成员的口袋房间消息。
- 口袋私信：查看口袋私信列表，可发送私信。
- 房间相册：查看成员房间图片、视频，支持批量下载。
- 口袋动态：查看成员的动态列表。
- 成员微博：查看成员发送的微博。
- 成员档案：查询成员详细资料和公式照（口袋源）。
- 成员行程：查看成员公演行程（BEJ48）。
- 公演记录：查询成员公演记录，观看历史公演。
- 个人相册：查看成员上传的个人相册。
- 开具发票：开具口袋消费发票。
- 翻牌：向成员进行翻牌提问，查看账号历史翻牌。支持撤回提问、删除翻牌。历史翻牌数据统计。
- 48区：查看48区内容。
- 屏蔽词检测：检测文本是否属于口袋48屏蔽词。

### 账号类
- 切换账号：支持大、小号切换。
- 修改资料：修改账号头像、昵称。
- 自动签到：打开软件自动进行口袋签到。
- B站登录：登录B站账号后可查看B站原画直播。

### 数据类
- 鸡腿榜：成员鸡腿榜单。
- 数据库：成员相关数据。

### 资源类
- 视频：官方视频资源（口袋源）。
- 音乐：官方音乐资源（官网源）及自有音乐源。支持收藏、歌词显示。
- 电台：官方电台资源（口袋源）。


## 命令行工具 `snh48`

桌面端的口袋 48 能力同时提供了一个命令行版本，方便脚本化调用与 AI agent 集成。

```bash
npm install
node bin/snh48.js help          # 全部命令
npm link && snh48 help          # 可选：装成全局命令
```

成员参数支持中文名、昵称、拼音、缩写或数字 ID，工具会查名册自动解析：

```bash
snh48 roster --team X                    # Team X 在籍成员
snh48 member info 二水                   # 昵称也能查
snh48 shows --group SNH48 --days 7       # 近期公演与票务（免登录）
snh48 room messages 杨冰怡 --limit 30    # 抓房间消息（需登录）
snh48 room search 杨冰怡 生日 --scan 800 # 房间历史消息检索
snh48 live list                          # 谁在直播
```

登录后才能使用消息、直播、翻牌等功能，Token 与桌面端共用：

```bash
snh48 login                              # 交互式：问手机号 → 发码 → 输验证码 → 存 Token
snh48 login qr                           # 扫码登录 live.48.cn，终端直接画出二维码
snh48 login status                       # 同时查看两套凭据的状态
snh48 login token <已有的token>          # 或用环境变量 SNH48_TOKEN
```

注意这是**两套互不相通的凭据**：短信登录拿到的口袋 Token 管房间消息、私信、直播、翻牌等绝大多数功能；
扫码拿到的是 live.48.cn 的登录态，只用于公演直播源，**不能替代口袋 Token**。

`snh48 login` 需要交互式终端；写脚本时用 `login sms` + `login code` 这对可分步调用的命令。

输出在终端里是表格，重定向到管道时自动切成 JSON（也可显式 `--json`）：

```json
{ "ok": true, "command": "member search", "data": { "…": "…" } }
{ "ok": false, "command": "member info", "error": "…", "hint": "…" }
```

退出码：`0` 成功、`1` 命令出错、`127` 未知命令。名册缓存 24 小时，`--refresh` 强制刷新。

## 插件

同一套 CLI 能力对外有两个插件形态，共用 `src/cli/` 这一份实现，没有第二套逻辑。

### Claude Code 插件市场

本仓库同时是一个 **Claude Code plugin marketplace**（`pocket48`），里面有两个插件：

```
/plugin marketplace add NannaOlympicBroadcast/pocket48-cli
/plugin install pocket48-cli@pocket48
```

装完 `bin/` 会进 PATH，直接 `snh48 <命令>` 即可。

#### `pocket48-cli` — 只读查询

| 组件 | 内容 |
| --- | --- |
| skill | `snh48-cli`：命令表、JSON 契约、成员寻址规则、登录流程与排错手册。问到 48 系的人和事时自动触发，不必点名 |
| 斜杠命令 | `/live` 谁在直播、`/shows` 公演与余票、`/room` 房间消息、`/member` 成员档案、`/login` 登录与凭据 |
| subagent | `pocket48-researcher`：需要串联名册、消息、直播、行程、榜单的多步调查交给它 |

#### `pocket48-write` — 写操作（可选，默认停用）

```
/plugin install pocket48-write@pocket48
/plugin enable  pocket48-write@pocket48
```

| 组件 | 内容 |
| --- | --- |
| skill | `snh48-write`：写操作的命令表与「先复述、等用户确认、再执行」四步流程 |
| 斜杠命令 | `/dm` 发私信、`/flip` 翻牌提问与撤回 |

单独成包是因为这些命令会**真实送达对方或消耗鸡腿/星币**：不想让 Claude 碰这些的人
只装 `pocket48-cli` 就行。它声明了对 `pocket48-cli` 的依赖，装它会把只读那包一并带上；
安装后默认停用，得显式 `enable` 才生效。

这跟 DSH 那边 `allowWrites` 默认关闭是同一个取舍，只是换了一种表达方式。

### DeepSeek Harness 插件

仓库整体就是一个 DSH bundle（根 `package.json` 的 `dsh.bundle` → `cordis.patch.yml`）：

```sh
dsh plugin --profile <名字> add github:NannaOlympicBroadcast/pocket48-cli
dsh --profile <名字>
```

注册九个模型可调用的工具：`snh48_roster`、`snh48_member`、`snh48_room`、`snh48_live`、
`snh48_shows`、`snh48_rank`、`snh48_feed`、`snh48_login`，以及受限的逃生舱 `snh48_run`。
纯 ESM、无构建步骤，从 git 直接装不需要 pnpm 的 `allowBuilds` 授权。

默认只读——送礼、发私信、翻牌这些要在 profile 里显式配 `allowWrites: true` 才放行。
细节见 [`dsh/README.md`](dsh/README.md)。


## 说点别的
为什么要叫牙牙消息呢？因为原本只是太无聊了想看看牙以前发了什么消息，奈何直接下载出来的html文件看的实在是不太方便，于是想着写一个能检索消息的工具，方便我查找牙在什么时候发了什么消息。之后为了方便在电脑上看直播，于是加入了直播和回放，然后功能就越做越多了。Anyway，感谢使用。


## 免责声明
本软件不上传任何数据到软件云端服务器，仅在本地进行数据缓存，用于维持功能可用性和改善使用体验。

软件功能可能依赖口袋48、哔哩哔哩等第三方平台接口。使用这些功能时，相关第三方可能按照其自身隐私政策和服务条款处理数据。

本项目为开源非营利项目，仅作相互学习交流之用，严禁用于商业用途，禁止使用本项目进行任何盈利活动。


## 灵感来源
Gemini ChatGPT [48tools](https://github.com/duan602728596/48tools) [msg48](https://msg48.org) [WebPocket48Assistant](https://github.com/Lawaxi/WebPocket48Assistant) [Partner48](https://github.com/Akimaylilll/Partner48)


## 特别感谢
泊然 · 恩帅没有心 · linlin · Thri_Twee · 西伯利亚土拨鼠 · 仙欲喵 · 小可w · 小日月 · 小吸吸 · yimo



