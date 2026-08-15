---
description: 看看现在谁在口袋 48 直播
argument-hint: "[成员名，可选]"
allowed-tools: Bash(snh48:*)
---

用 `snh48` 查询当前的口袋 48 直播情况。

1. 先跑 `snh48 live list --json`。
2. 如果用户给了成员名（`$ARGUMENTS`），从结果里挑出这位成员；没在直播就再跑
   `snh48 live replay "$ARGUMENTS" --limit 5 --json` 给出最近的回放。
3. 没给成员名就把正在直播的人整理成一个简短列表：成员、开播时间、标题。

结果用中文回答。`ok:false` 时先读 `hint`，按提示处理（多半是没登录）。
