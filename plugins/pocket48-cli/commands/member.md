---
description: 查成员档案（队伍、期数、生日、公式照）
argument-hint: "<成员名或关键词>"
allowed-tools: Bash(node:*)
---

> CLI 入口是 `node "$CLAUDE_PLUGIN_ROOT/cli.js"`（仓库内开发时是 `node bin/snh48.js`）。
> 下文简写的 `snh48 …` 都要替换成它——`snh48` 并不在 PATH 里。

用 `snh48` 查询成员资料。名册查询**不需要登录**。

参数：`$ARGUMENTS`。

1. `snh48 member info "$ARGUMENTS" --json` — 拿档案。
2. 报「匹配到多位成员」时，`hint` 里会列出候选（名册里确实存在重名，比如分属两团的「李沁洁」），
   把候选转述给用户让其确认，或改用 `memberId` 重查，**不要**自己随便挑一个。
3. 找不到人时退回 `snh48 member search "$ARGUMENTS" --json` 做模糊检索。

整理输出：姓名、团体、队伍、期数、生日、身高、口号。已登录时档案里还会带口袋资料。
