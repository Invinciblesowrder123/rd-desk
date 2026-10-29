# pmbot 集成件

这个目录只放**接入用的一个文件**，不包含 pmbot 本体（那是另一个独立项目）。

`zhongtai.py` 做一件事：每轮对话前，把本仓库的 `bridge/desk.db` 只读镜像进 pmbot 自己的库，
让它的查询 / 日报 / 按人汇报 / 预警重算继续按原样工作。

用法与注意事项见 [../../docs/pmbot-接入.md](../../docs/pmbot-接入.md)。

放进 pmbot 项目根目录（与 `agent.py` 同级）即可，它只用标准库。
