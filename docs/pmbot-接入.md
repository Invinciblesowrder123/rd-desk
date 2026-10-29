# 接飞书机器人（可选）

`pmbot` 是一个独立的飞书机器人项目，能在群里回答问题、定时推日报。

接上之后：

```
你在飞书问「今天有什么要盯的」
        ▼
pmbot 查自己的库（每轮对话前已从本仓库镜像过）
        ▼
回答里是这里的节点、日期、负责人
```

**数据只有一个方向**：中台 → pmbot。飞书里改不了数据，写操作全部被拦。

---

## 1. 为什么是"镜像"而不是"直接查"

pmbot 的读工具、日报渲染、按人汇报、预警重算，全部建立在它自己的
`projects / milestones / alerts` 表上。要让这些能力直接查本仓库的库，
等于重写半个 bot。

所以采用**镜像**：每轮对话前，把 `bridge/desk.db` 的状态覆盖进 pmbot 的库，
跑完调它自己的 `scan_alerts()` 重算预警。读路径一行不用改。

代价是 pmbot 的库变成"最近一次的只读副本"，但这正好符合它的定位——辅助展示层。

---

## 2. 字段映射

| 中台（本仓库） | pmbot |
|---|---|
| `项目编码` | `projects.code`（唯一键，对齐用） |
| `项目名` | `projects.name` |
| `客户` / `负责人` | `customer` / `owner` |
| `阶段`：概念/设计/手板/试产/量产 | `stage`：kickoff / ID / EV / PVT / MP |
| `截止日` | `target_mp` |
| `项目备注` | `note` |
| `节点名` | `milestones.name`（配合项目编码对齐） |
| `节点状态`：待开始/进行中/已完成/阻塞 | `status`：pending / doing / done / blocked |
| `计划完成日` / `完成日` | `plan_date` / `actual_date` |

注意事项：

- 中台没有 phase 概念，节点的 `phase` 统一填 `custom`（pmbot 的 EV/DV 分组会退化）。
- 中台消失的项目**标记为 `closed` 而不是删除**（pmbot 里可能有订单挂在上面）。
- 中台消失的节点会直接删除，并清掉它的预警——否则日报会报幽灵节点。
- 幂等靠中台的 `rev`：`rev` 没变就跳过，缓存值写在 `$PMBOT_HOME/zhongtai_rev.txt`。

---

## 3. 接入步骤

1. 把 `integrations/pmbot/zhongtai.py` 复制到 pmbot 项目根目录（与 `agent.py` 同级）。
2. 在 pmbot 的 `.env` / `.env.prod` 里加：

   ```
   ZHONGTAI_DB=<本仓库绝对路径>/bridge/desk.db
   ZHONGTAI_READONLY=1
   ```

3. 给 `pmbot/config.py` 的 `Config` 加两个字段（`zhongtai_db`、`zhongtai_readonly`），
   **并记得在 `load_config()` 里显式传**——它用显式 kwargs 构造，只加 dataclass 默认值不生效。
4. 在 `agent.py` 里挂三处：
   - 导入 `from .zhongtai import sync as sync_zhongtai`
   - `Agent.handle()` 开头调一次 `sync_zhongtai(self.db, self.cfg)`，异常不能阻断对话
   - `ToolRegistry.call()` 里加只读拦截（见下）
5. 重启 bot。

仓库里的 `integrations/pmbot/zhongtai.py` 是完整可用的版本，三处挂载的写法它的注释里有说明。

---

## 4. 只读拦截

在 `ToolRegistry.call()` 里、**权限校验之前**加：

```python
ZHONGTAI_BLOCKED = {
    "create_project", "update_project", "set_milestone_plan", "add_project_node",
    "report_progress", "complete_project", "delete_project_node", "delete_record",
}

if getattr(self.cfg, "zhongtai_readonly", False) and name in ZHONGTAI_BLOCKED:
    return {"ok": False, "readonly": True,
            "message": "项目数据以「研发推进中台」为准，飞书里不能直接改。"}
```

还要改两处文案，否则模型会承诺做不到的事：

- **系统提示词**加一条规则：工具返回 `readonly=true` 时如实说"去中台改"，
  不允许出现"已更新""已记录"这类话。
- **帮助文本**里把"报进度""新建项目"的示例改成"请到中台操作"。

---

## 5. 验证清单

接完跑一遍：

```
① 中台改一个节点 → 飞书问"XX 项目到哪一步" → 答案是新的
② 飞书说"XX 节点完成了" → 回复应该是"去中台改"，数据库不该变
③ 中台删一个节点 → 飞书日报里不再出现该节点
④ 连续问两次 → 第二次不应该重复同步（看 $PMBOT_HOME/zhongtai_rev.txt）
```

第 ② 条最关键：如果 bot 说"已更新"，说明拦截没生效，两套数据开始分叉。

---

## 6. 几个坑

- **pmbot 可能有多个库文件**（根目录 / `runtime/prod` / `runtime/test`）。
  先确认它实际用哪个：`PMBOT_HOME=runtime\prod` 就意味着 `runtime/prod/pmbot.db`。
- **拷 pmbot 的库做测试要连 `-wal` 一起拷**，否则拿到的是旧数据（WAL 里的改动还没合并）。
- pmbot 运行时依赖自带运行时（`python-embed`）；用系统 Python 可能因为缺 `tzdata`
  在 `import` 阶段就崩。
