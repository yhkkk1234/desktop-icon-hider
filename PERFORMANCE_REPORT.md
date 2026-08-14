# 性能测试报告 — Desktop Icon Hider v1.8.4

> 测试时间：2026-08（实测）
> 测试对象：打包版 `dist/win-unpacked/Desktop Icon Hider.exe`（Electron 43.3.0）+ 源码核心路径

## 1. 测试环境

| 项目 | 值 |
|---|---|
| CPU | Intel Xeon E3-1240 v5 @ 3.50GHz（4C / 8T，2015 年中端台式平台） |
| 内存 | 16 GB（测试时剩余 ~5.4 GB） |
| 系统 | Windows 10 教育版 10.0.19045（22H2） |
| Node | v24.14.1（原生模块为 N-API，跨 ABI 兼容） |
| 桌面文件数 | 81 项（用户桌面 72 + 公共桌面 + 系统图标） |
| opencode.db | 3.09 GB，part 表 125,082 行 / session 389 行 |

## 2. 测试方法

- **单元测试**：`jest --ci`（72 用例全过）
- **核心路径基准**：`scripts/perf-benchmark.js`（node 直测原生模块与 desktop-api）
- **agent 轮询基准**：`scripts/perf-lastpart.js`（node:sqlite 只读复现 agent-monitor.js 同款 SQL）
- **应用级测试**：`scripts/app-perf.ps1` + `scripts/app-cdp-measure.js`
  - 以临时 userData（`--user-data-dir`）启动打包版，不污染真实配置
  - 启动时间 = 进程拉起 → 主窗口出现（`MainWindowHandle != 0`）
  - 稳态内存/CPU = 窗口出现 5s 后采样 8s 窗口
  - 渲染层指标 = Chrome DevTools Protocol（`--remote-debugging-port`）在 renderer 内实测
  - 测试结束通过 `quitApp()` 优雅退出，并校验桌面图标已恢复（`check-desktop-icons.ps1`）

## 3. 测试结果

### 3.1 应用级（打包版实测，两次独立运行）

| 指标 | 实测 | 参考标准 | 判定 |
|---|---|---|---|
| 启动 → 主窗口出现 | 2.30s / 2.30s | < 3s（Electron 应用常见目标） | ✅ |
| 主进程稳态工作集 | 135.7 MB | 主进程 < 200 MB | ✅ |
| 主进程稳态私有内存 | 106.7 MB | — | ✅ |
| 峰值工作集 | 136.5 MB | — | ✅ |
| 子进程合计（renderer 97 + GPU 41 + utility 95 + 硬件采样 PS 89） | 322.5 MB | 全进程组 < 600 MB | ✅ |
| 空闲 CPU（8 核归一） | 0.02% ~ 0.12% | < 1% | ✅ |
| 渲染进程 JS 堆 | 9.5 MB | — | ✅ |
| 退出后桌面图标恢复 | 是（两次均验证） | 必须恢复 | ✅ |

### 3.2 渲染层 IPC（CDP 实测，81 个桌面文件）

| 指标 | 实测 | 参考标准 | 判定 |
|---|---|---|---|
| getFiles 冷调用（首启，无缓存） | 232 ms | README 已知问题描述"首次需几秒"，实测远优于该描述 | ✅ |
| getFiles 热调用（缓存命中） | 10 ~ 21 ms | < 100 ms | ✅ |
| getFileIcons 30 个 | 9 ~ 22 ms | < 100 ms | ✅ |
| getAgentSessions（轮询路径） | 3.8 ~ 5.6 ms | < 100 ms | ✅ |
| 完整渲染快照（枚举+30 图标） | 8.6 ~ 18 ms | < 100 ms | ✅ |

### 3.3 核心路径基准（node 直测）

| 指标 | 实测 | 参考标准 | 判定 |
|---|---|---|---|
| 原生模块加载 | 2 ~ 3 ms | — | ✅ |
| 单图标提取（冷） | 2.76 ms（min 2.2 / max 3.7） | < 10 ms | ✅ |
| 批量提取 8 个 | 24.8 ms（~3.1 ms/个） | — | ✅ |
| 批量提取 20 个 | 71.4 ms | — | ✅ |
| 批量提取 60 个（桌面满载） | 165.6 ms | < 500 ms | ✅ |
| 全屏检测 | 0.01 ms | — | ✅ |
| icon-cache 序列化（200 图标 / 3.9 MB） | 6.9 ms | — | ✅ |
| icon-cache 解析 | 3.5 ms | — | ✅ |
| icon-cache 写盘 | 4.3 ms | — | ✅ |
| desktop-api 批量 30 个（缓存命中） | 0 ms | — | ✅ |

### 3.4 agent 监控轮询（3.09 GB opencode.db，真实查询复现）

| 指标 | 实测 | 对照 CHANGELOG | 判定 |
|---|---|---|---|
| 首轮轮询（session + 批量 last-part 全表扫，仅启动一次） | 194 ms | 注释预期 ~90ms（库更大 3.09GB，冷页缓存） | ✅ 可接受 |
| 稳态轮询（缓存命中，2.5s 周期） | 0.70 ms | 优化后 ~1ms/cycle | ✅ |
| 增量 last-part（冷文件缓存） | avg 79 / p50 57 / p95 247 / max 365 ms | 声称"毫秒级" | ⚠️ 见下 |
| 增量 last-part（热文件缓存，OS 缓存就绪） | avg 5 / p50 3.3 / p95 16 / max 36 ms | 声称"毫秒级" | ✅ |
| 快照签名序列化 | < 1 ms | — | ✅ |

## 4. 结论

**总体判定：达标。** 全部核心指标通过，功能基线 72/72 单测通过，退出后桌面图标正确恢复，无泄漏迹象（两次启动稳态内存一致）。

单项表现：
- 启动 2.3s、空闲 CPU ~0.1%、总内存 ~458 MB —— 在 2015 年老平台上仍符合 Electron 应用的健康区间；
- 图标提取管线（原生 N-API + 分批让出事件循环 + 防抖缓存）性能优秀：单图标 2.8ms、满载 60 图标 166ms；
- agent 轮询稳态 0.7ms 与 CHANGELOG 的 ~1ms 基准一致；opencode 轮询 SQL 的缓存设计有效（从历史 700ms/次 → 0.7ms/次）。

## 5. 注意项（非阻塞）

1. **增量 last-part 查询在磁盘冷缓存时偏高**：3.09GB 数据库上 p50 57ms、p95 247ms、最差 365ms（热缓存后 p50 3.3ms）。触发条件是活跃会话持续刷新 `time_updated` 导致每次轮询重查其最后 part（该会话 part 行可达 2,500+，无 `(session_id, time_created)` 索引，需排序全量行）。偶发 250ms+ 的主进程同步停顿在活跃会话场景可能出现。若后续优化，可给 part 表建 `(session_id, time_created)` 索引或将 last-part 结果按 `time_updated` 再做二级缓存（当前缓存已覆盖静止会话，活跃会话仍每轮查库）。
2. **首轮批量 part 查询 194ms**（仅启动时一次，2.5s 轮询开始前）在 3GB+ 库上属于磁盘扫描成本，可接受；库更大时建议考虑预建索引。
3. 硬件采样子进程（powershell，~89MB）为常驻进程，若用户在意内存可评估降低采样频率（未在本次范围）。

## 6. 复测方法

```powershell
# 1) 单元测试
node node_modules/jest/bin/jest.js --ci

# 2) 核心路径基准
node scripts/perf-benchmark.js

# 3) agent 轮询基准（需要本机 opencode.db）
node scripts/perf-lastpart.js

# 4) 应用级 + 渲染层（打包版；会短暂隐藏桌面图标，结束后自动恢复）
powershell -ExecutionPolicy Bypass -File scripts/app-perf.ps1
```
