---
description: 抓取某位成员口袋房间的最新消息
argument-hint: "<成员名> [关键词]"
allowed-tools: Bash(node:*)
---

> CLI 入口是 `node "$CLAUDE_PLUGIN_ROOT/cli.js"`（仓库内开发时是 `node bin/snh48.js`）。
> 下文简写的 `snh48 …` 都要替换成它——`snh48` 并不在 PATH 里。

用 `snh48` 读取成员的口袋房间消息。**需要口袋 48 Token**。

参数：`$ARGUMENTS` — 第一个词是成员（中文名/昵称/拼音/ID 都行），其余是可选关键词。

- 只给了成员：`snh48 room messages <成员> --limit 30 --json`，按时间倒序总结她最近说了什么。
- 还给了关键词：`snh48 room search <成员> <关键词> --scan 800 --json`，列出命中的消息与时间。

消息 `time` 是毫秒时间戳，转成可读时间再展示。`type` 为 `IMAGE`/`VIDEO`/`AUDIO` 时说明是图片/视频/语音，
`media` 字段是资源地址。

报 `尚未登录` 时不要自己试别的命令——先跑 `snh48 login status --json`，
再把登录步骤告诉用户（短信验证码只会发到他们手机上，必须他们自己执行 `snh48 login`）。
