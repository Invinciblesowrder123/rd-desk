# -*- coding: utf-8 -*-
"""生成演示数据 data/seed.demo.json。

仓库里不能带真实项目数据，所以演示数据全部虚构：客户是「星河/云海/远山/青禾」，
人是「张明/李静/王磊/赵敏」，项目是咖啡机/料理机/空气炸锅/电热水壶。

日期相对「今天」生成，所以任何时候跑一遍都像在用的系统：

    python tools/make_demo_seed.py            # 以今天为基准
    python tools/make_demo_seed.py 2026-10-29 # 指定基准日（截图复现用）
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "seed.demo.json"

PALETTE = ["#6366f1", "#14b8a6", "#8b5cf6", "#f59e0b"]

P1, P2, P3, P4 = ("demo-p1", "demo-p2", "demo-p3", "demo-p4")


def iso(d: date) -> str:
    return d.strftime("%Y-%m-%d") + "T00:00:00Z"


def build(base: date) -> dict:
    d = lambda n: base + timedelta(days=n)   # noqa: E731

    projects = [
        {
            "_id": P1, "项目编码": "PRJ-2026-101", "项目名": "星河 智能咖啡机",
            "客户": "星河", "负责人": "张明", "阶段": "手板",
            "立项日期": iso(d(-40)), "截止日": iso(d(12)),
            "单位": "项", "总量": 120, "配色": PALETTE[0],
            "阻塞项": "手板运行噪声比客户要求高 3dB，需在 PVT 前改风扇支架",
            "预案": "若支架改模来不及，先加吸音棉过渡送样，量产前再切回改模件",
            "项目备注": "手板阶段第 2 轮：加热模块与萃取压力均已通过，噪声待整改；客户要求 11 月初看样机。",
        },
        {
            "_id": P2, "项目编码": "PRJ-2026-102", "项目名": "云海 破壁料理机",
            "客户": "云海", "负责人": "李静", "阶段": "试产",
            "立项日期": iso(d(-70)), "截止日": iso(d(26)),
            "单位": "项", "总量": 200, "配色": PALETTE[1],
            "阻塞项": "", "预案": "",
            "项目备注": "试产线已排产，重点关注刀组同心度与噪声。",
        },
        {
            "_id": P3, "项目编码": "PRJ-2026-103", "项目名": "远山 空气炸锅",
            "客户": "远山", "负责人": "王磊", "阶段": "设计",
            "立项日期": iso(d(-12)), "截止日": iso(d(45)),
            "单位": "项", "总量": 80, "配色": PALETTE[2],
            "阻塞项": "", "预案": "",
            "项目备注": "ID 方案二选一，等客户下周评审定稿。",
        },
        {
            "_id": P4, "项目编码": "PRJ-2026-104", "项目名": "青禾 电热水壶",
            "客户": "青禾", "负责人": "赵敏", "阶段": "概念",
            "立项日期": iso(d(-3)), "截止日": iso(d(60)),
            "单位": "项", "总量": 60, "配色": PALETTE[3],
            "阻塞项": "", "预案": "",
            "项目备注": "立项中，待补成本模型。",
        },
    ]

    # (项目, 节点名, 计划完成日, 是否完成, 完成日, 负责人, 备注)
    raw_nodes = [
        (P1, "立项评审", d(-30), True, d(-29), "张明", "一次通过"),
        (P1, "ID 草图冻结", d(-20), True, d(-16), "张明", "客户加了两处散热孔"),
        (P1, "EV 手板组装", d(-4), True, d(-1), "张明", "泵体回样后赶工一天"),
        (P1, "萃取压力复测", base, True, base, "张明", "今天复测通过"),
        (P1, "可靠性寿命测试", d(6), False, None, "李静", "台架已排期"),
        (P1, "客户看样机", d(11), False, None, "张明", ""),

        (P2, "PVT 试产排产", d(-9), True, d(-9), "李静", "产线已锁定"),
        (P2, "刀组同心度验证", d(-1), False, None, "李静", "超差 0.05mm，待模具修整"),
        (P2, "噪声测试", d(5), False, None, "王磊", ""),
        (P2, "3C 认证送样", d(14), False, None, "李静", "认证机构已预约"),
        (P2, "量产评审", d(24), False, None, "李静", ""),

        (P3, "ID 方案评审", d(4), False, None, "王磊", "客户下周定稿"),
        (P3, "结构可行性评估", d(12), False, None, "王磊", ""),
        (P3, "成本模型初稿", d(20), False, None, "赵敏", ""),

        (P4, "立项资料准备", d(9), False, None, "赵敏", ""),
        (P4, "成本模型评审", d(21), False, None, "赵敏", ""),
    ]

    status_of = lambda done: "已完成" if done else "待开始"   # noqa: E731
    nodes = []
    for i, (pid, name, plan, done, actual, owner, note) in enumerate(raw_nodes, 1):
        st = status_of(done)
        if not done and plan < base:
            st = "进行中"
        elif not done and plan == base:
            st = "进行中"
        nodes.append({
            "_id": "demo-n%02d" % i, "项目ID": pid, "节点名": name, "序号": i,
            "计划完成日": iso(plan), "已完成": done,
            "完成日": iso(actual) if actual else "", "备注": note,
            "负责人": owner, "节点状态": st,
        })

    # 报工：P1 近 5 天连续，P2 只有昨天一条，P3/P4 没有（演示缺报）
    logs = []
    p1_qty = [12, 10, 14, 9, 11]
    p1_note = ["泵体试装 2 台", "加热模块复测", "样机装配", "参数摸底", "萃取压力复测，一次通过"]
    for i, q in enumerate(p1_qty):
        logs.append({
            "_id": "demo-l%02d" % (i + 1), "项目ID": P1, "项目名称": "星河 智能咖啡机",
            "日期": iso(d(-4 + i)), "完成量": q, "工时分钟": 240 if i % 2 else 480,
            "补记": False, "备注": p1_note[i],
        })
    logs.append({
        "_id": "demo-l06", "项目ID": P2, "项目名称": "云海 破壁料理机",
        "日期": iso(d(-1)), "完成量": 20, "工时分钟": 480, "补记": False,
        "备注": "试产首批 20 台，同心度超差已记录",
    })

    # 周标识用的是「本周周一的日期」（页面 currentWeekKey 的口径），不是"第 N 周"
    week_start = base - timedelta(days=base.weekday())
    reviews = [{
        "_id": "demo-r01", "周标识": week_start.isoformat(),
        "保持": "每天下班前同步节点状态，客户问题当天回",
        "问题": "手动噪声超标 3dB，风扇支架要改模，可能占掉一周窗口",
        "尝试": "把寿命测试拆两批，先跑能插队的项",
        "下周预案": "改模来不及就先加吸音棉过渡送样，量产前切回改模件",
    }]

    return {"projects": projects, "nodes": nodes, "logs": logs, "reviews": reviews}


def main() -> None:
    if len(sys.argv) > 1:
        base = datetime.strptime(sys.argv[1], "%Y-%m-%d").date()
    else:
        base = date.today()
    seed = build(base)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(seed, ensure_ascii=False, indent=1), encoding="utf-8")
    print("基准日 %s → %s" % (base, OUT.relative_to(ROOT)))
    print("  项目 %d / 节点 %d / 报工 %d / 复盘 %d" % (
        len(seed["projects"]), len(seed["nodes"]), len(seed["logs"]), len(seed["reviews"])))


if __name__ == "__main__":
    main()
