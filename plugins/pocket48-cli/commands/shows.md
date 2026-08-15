---
description: 查最近的公演场次与余票
argument-hint: "[团体，默认 SNH48] [天数，默认 7]"
allowed-tools: Bash(node:*)
---

> CLI 入口是 `node "$CLAUDE_PLUGIN_ROOT/cli.js"`（仓库内开发时是 `node bin/snh48.js`）。
> 下文简写的 `snh48 …` 都要替换成它——`snh48` 并不在 PATH 里。

用 `snh48` 查询近期公演与票务。这条链路**不需要登录**。

参数：`$ARGUMENTS`（第一个词是团体，第二个是天数；缺省为 SNH48 与 7 天）。
团体可取 `SNH48` / `BEJ48` / `GNZ48` / `CKG48` / `CGT48`。

跑 `snh48 shows --group <团体> --days <天数> --json`，然后按日期整理成表格：
日期、开演时间、队伍、剧目、场馆、票务状态。

票务状态原样转述（VIP票有售 / 普通票有售 / 售罄），**不要**自己推断有没有票。
需要更细的日程（参演成员、地址）时再补一次 `snh48 plan --group <团体> --days <天数> --json`。
