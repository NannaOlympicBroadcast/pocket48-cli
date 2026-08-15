# snh48 — DeepSeek Harness 插件

把口袋 48 / SNH48 GROUP 的数据能力注册成 harness 里模型可调用的工具。

## 安装

本仓库整体就是一个 DSH **bundle**：根 `package.json` 声明了 `dsh.bundle`，指向根目录的
`cordis.patch.yml`。

```sh
dsh plugin --profile <名字> add github:NannaOlympicBroadcast/pocket48-cli
dsh --profile <名字>
```

装完确认这一层生效了：

```sh
dsh --profile <名字> --dump-config    # 应能看到 "# == yaya_msg" 一层
```

包名是 `yaya_msg`（桌面端「牙牙消息」的既有身份），和仓库名 `pocket48-cli` 不同——
移除时用包名：`dsh plugin --profile <名字> remove yaya_msg`。

### 不需要允许构建脚本

插件是**纯 ESM JavaScript，没有构建步骤**，所以本包不带 `prepare`，从 git 直接装就能用——
不必给它 pnpm 的 `allowBuilds` 授权（那等于允许包在你机器上执行安装期代码）。

安装时 pnpm 可能会提示跳过了 `ffmpeg-static` 的 postinstall。**可以放心忽略**：
ffmpeg 是桌面端录制/切片用的，工具链路一行都不碰它。

想更稳妥就钉一个 commit：

```sh
dsh plugin --profile <名字> add github:NannaOlympicBroadcast/pocket48-cli#<sha>
```

也可以先 clone 下来、跑一次 `npm install --omit=dev`，再 `add ./pocket48-cli`。

## 配置

在 profile 的 `cordis.patch.yml` 里覆盖 `snh48-pocket48` 这一行的 `config`。
注意 patch 是**整行替换 config**，不是深合并，所以要把三个键都写全：

```yaml
- insert:
    - id: snh48-pocket48
      name: yaya_msg/dsh
      config:
        token: ''
        timeoutMs: 120000
        allowWrites: false
```

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `token` | `''` | 口袋 48 Token。留空则沿用 CLI 自己的解析顺序：`SNH48_TOKEN` 环境变量 → 与桌面端共用的本地设置 |
| `timeoutMs` | `120000` | 单条命令超时。`room search` 的 `scan` 调大时相应放宽 |
| `allowWrites` | `false` | 是否允许 `snh48_run` 执行写操作（送礼、发私信、翻牌、关注、签到、直连 api） |

## 工具

| 工具 | 用途 | 需要 Token |
| --- | --- | --- |
| `snh48_roster` | 成员名册检索：按姓名/拼音/昵称搜，或按团体/队伍/期数筛 | 否 |
| `snh48_member` | 单个成员的档案 / 公式照 / 历史动态 / 直播记录 | 仅 `info` 免登录 |
| `snh48_room` | 房间消息抓取、关键词检索、条数统计、相册、上麦地址 | 是 |
| `snh48_live` | 正在直播列表、成员回放、单场详情与播放地址 | 是 |
| `snh48_shows` | 近期公演场次、票务状态与日程摘要 | 否 |
| `snh48_rank` | 鸡腿周榜 / 总榜 / 年榜 / 成员贡献榜 | 是 |
| `snh48_feed` | 成员的口袋动态与微博 | 是 |
| `snh48_login` | 登录状态、注入 Token、短信验证码、扫码、登出 | — |
| `snh48_run` | 逃生舱：跑上面没覆盖到的只读子命令 | 视命令而定 |

成员参数一律接受中文名、昵称、拼音或 memberId，CLI 会查名册自动解析。
名册里存在重名时工具会报错并在消息里列出候选，**不会**静默选错人。

## 写操作与登录

`snh48_run` 默认拒绝会花钱或对外产生真实动作的命令：`flip ask`、`flip delete`、`dm send`、
`live send-gift`、`member follow` / `unfollow`、`checkin`、`account switch`，以及能打到任意
写接口的 `api`。放行要显式配 `allowWrites: true`。

登录不走 `allowWrites`，而是由专门的 `snh48_login` 处理，因为它有几个细节：

- **两套互不相通的凭据**。口袋 Token 管房间消息、私信、直播、翻牌等绝大多数功能；
  扫码拿到的是 live.48.cn 登录态，**只**管公演直播源，不能替代口袋 Token。
- **短信验证码读不到**。`mode=sms` 只负责发码，验证码到用户手机上，必须由用户口述回来
  再走 `mode=code`。交互式的 `snh48 login` 在子进程里跑不了，工具不会去调它。
- **扫码要等**。`mode=qr` 默认等 300 秒，子进程超时会自动放宽到等待时长 + 30 秒。

## 实现说明

工具不在 harness 进程内 `require` CLI，而是把 `bin/snh48.js` 当子进程跑（`runner.mjs`）。
原因是 CLI 会重定向全局 `console`、加载 wasm、写 `process.exitCode`——harness 是长驻进程，
这些副作用不该渗进去。子进程另外还带来了超时和 `AbortSignal` 取消。

代价是每次调用有一次 Node 启动开销。抓取量大的场景（`room search --scan 2000`）请相应调大
`timeoutMs`，而不是把 scan 拆成很多次小调用。

口袋接口的原始 JSON 很胖，`format.mjs` 对消息、名册、公演三种已知形状做了紧凑渲染，
其余退回到裁剪过的 JSON（超长字符串截断、超长数组只留前 80 条），避免一次工具调用吃掉半个上下文。
