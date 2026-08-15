---
description: 登录口袋 48 / live.48.cn，或检查登录状态
argument-hint: "[status｜qr｜token <token>｜sms <手机号>｜code <手机号> <验证码>｜logout]"
allowed-tools: Bash(node:*)
---

> CLI 入口是 `node "$CLAUDE_PLUGIN_ROOT/cli.js"`（仓库内开发时是 `node bin/snh48.js`）。
> 下文简写的 `snh48 …` 都要替换成它——`snh48` 并不在 PATH 里。

用 `snh48` 处理登录。参数：`$ARGUMENTS`（留空按 `status` 处理）。

## 先认清：这是两套互不相通的凭据

| 凭据 | 怎么拿 | 管什么 |
| --- | --- | --- |
| **口袋 48 Token** | 短信登录 / 直接注入 | 房间消息、私信、直播、翻牌、鸡腿榜——**绝大多数功能** |
| **live.48.cn Cookie** | 扫码登录 | **只**管公演直播源 |

用户说「我扫码了但还是提示没登录」时，这不是 bug：扫码不产生口袋 Token，
要让他们再走一次短信登录。

## status（默认）

`snh48 login status --json` → `{ pocket: { loggedIn, nickname, error }, live48: { loggedIn, accountInfo } }`。
两套状态分别转述，别混为一谈。已登录时可再跑 `snh48 whoami --json` 确认账号。

## 你可以直接跑的

- `snh48 login token <token> --json` — 用户已有 Token 时注入，CLI 会先校验再落盘。
- `snh48 login qr --json` — 扫码。非交互环境下二维码会存成 PNG，把返回里的路径交给用户去扫。
  默认等 300 秒，`--timeout <秒>` 可调；超时返回 `ok:false / 扫码超时`。

## 短信登录：必须用户参与

验证码只发到用户手机上，**你读不到**。两种做法：

- 让用户自己在终端跑 `snh48 login`（交互式：问手机号 → 发码 → 输验证码 → 存 Token）。
  你不要调它——非 TTY 下会直接报 `当前不是交互式终端`。
- 或者你分步驱动，验证码由用户口述给你：

  ```bash
  snh48 login sms  <手机号> --json          # 发码
  snh48 login code <手机号> <验证码> --json  # 换 Token 并保存
  ```

  `login sms` 报 `需要先通过图形验证` 时，`hint` 里带了题目和候选，
  让用户选一个后用 `--answer <答案>` 重试。

## logout

`snh48 logout --json` 清口袋 Token；`--all` 连 live.48.cn 一起清。
这会让用户重新登录，**执行前先确认**。

## 提醒

Token 与桌面端「牙牙消息」共用一份本地设置，登录一次两边都生效。
也可以用环境变量 `SNH48_TOKEN` 或 `--token` 临时注入，不落盘。
不要把 Token 原文回显到对话里。
