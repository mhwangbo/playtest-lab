[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | **简体中文** | [Español](README.es.md)

# playtest-lab

*本文为译文。如与英文版 README 存在出入，以英文版为准。*

[![ci](https://github.com/mhwangbo/playtest-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/mhwangbo/playtest-lab/actions/workflows/ci.yml)

**为你的游戏组建一支试玩测试小组：机器人玩家、AI 人设试玩员，外加一份按优先级排序的报告。**
目前支持 Web 游戏、Unity 和 Godot。它既是一个 [Claude Code](https://claude.com/claude-code) 技能（skill），也是一个零依赖的 Node CLI。

它以很低的成本回答两类不同的问题：

| 问题 | 由谁回答 | 成本 |
|---|---|---|
| **游戏有没有坏 / 平衡吗？** 崩溃、规则破坏、记录的错误、软锁、回归、难度曲线、技巧梯度 | **机器人**：无头运行、结果确定、可跑数千局 | 免费（仅耗 CPU） |
| **游戏好懂 / 好玩吗？** 新手引导、困惑点、手感、"我还会再玩吗" | **人设**：AI 试玩员游玩真实构建，按评分标准打分，并且必须提出批评 | 每次约 $0.40–1.30 |

两者的结果都写入同一份带版本号的报告：`playtest-report.json` 加 `report.md`。报告包含按优先级排列的问题、每个问题对应的建议工单，以及按关卡划分的表格。

---

## 包含哪些内容

- **机器人运行器**（`lab/bots.js`）
  - 通过一个轻量的**适配器**在大量种子上游玩你的游戏，支持空闲、随机以及你自定义的技巧策略。
  - 以均值和 p10/p50/p90 汇总各项指标。
  - 将崩溃和永不结束的对局报告为 P0/P1 问题，并支持你自定义的平衡性告警。
- **缺陷包**（免费且结果确定）
  - **不变量（Invariants）：** 声明必须始终成立的规则（在适配器中，或 Godot 的 `check_invariants()`，或 Unity 的 `IPlaytestInvariants`）。规则被打破时会终止运行，并记为一个缺陷。
  - **记录的错误：** 统计 Unity 异常、Godot 的 `ERROR:` 行和 `console.error`，即使游戏仍能继续运行也会计入。如果引擎在运行中途崩溃，则记为一个 P0 崩溃，并附带原因和游戏自身的堆栈帧。
  - **轨迹：** 每一次失败的运行都会被保存。`lab.js replay <trace>` 可以精确复现，`--expect fixed` 用于验证修复是否生效。
  - **回归关卡：** 先运行一次 `lab.js baseline set`，之后每次改动后运行 `lab.js check`。当机器人失败率上升，或某个指标超出容差时，退出码为 1。
- **趣味报告**（`lab.js fun`，免费，基于同一批机器人运行结果）
  - **技巧梯度：** 玩得更好，分数就更高吗？当真正的策略输给 idle 或 random、梯度过于平缓，或 random 几乎追上最佳策略时发出提示。
  - **运气与技巧：** 把分数的方差拆分为策略（技巧）、种子（运气）和其余部分。在 NIGHTBEAM 上，它显示第一个里程碑中两个合格机器人之间的差异有 73% 来自运气，平衡调整后降到 18%。
  - **压倒性策略：** 在技巧相当但玩法不同的策略中，是否有一个几乎在每个种子上都获胜？
  - **紧张度曲线：** 导出 `tension(obs)`，即可得到每个策略的 10 段曲线，并提示曲线过平、峰值过早，或结尾比开头更平静。
- **引擎桥接**（`playtest-bridge/1`）
  - 基于 localhost 的换行分隔 JSON。
  - 游戏**只在** lab 请求帧时才以固定时间步推进，因此每个种子的运行结果都是**确定的**。
  - 以 **Unity** 包和 **Godot** 插件的形式提供。
- **人设**，游玩真实构建：
  - **Web（live-lite）：** 页面会被注入一个测试框架。游戏运行在一个模拟时钟上（回合之间冻结，回合之中快进），人设用玩家动作进行操作，感知的内容包括屏幕文字，以及一段"贴近人类感知"的场景描述——其中的数量刻意模糊，也不包含因果措辞。前 60 秒还会提供截图。
  - **引擎构建：** `lab.js host` 会在窗口中启动构建。人设用简单命令进行操作（`play tap Play`、`play drag B --to 2,1`、`play shot`）。Unity uGUI 游戏**无需写任何代码**即可使用（`-playtestUgui`）。
  - **评分标准：** 每个人设都必须对 10 秒和 60 秒时的清晰度、掌控感、紧张感、奖励感和重玩意愿打分，并指出自己最不确定的 3 个时刻。问题必须有记录为证，不能只是口头声称。
- **报告生成器**
  - 人设发现的问题在被复现之前一律标记为**未验证**，且不计入结论。
  - 机器人的发现可以按种子复现，因此立即生效。
- **可选的 [ai-game-studio](https://github.com/mhwangbo/ai-game-studio) 集成**
  - 将摘要同步到工作室的 `#qa` 聊天频道。
  - 工作室的试玩测试关卡会把 `suggestedTicket` 转成工单。
  - 可通过 `integrations.gameStudio: "off"` 关闭。

## 引擎支持

| 引擎 | 机器人 | 人设 | 实现方式 |
|---|---|---|---|
| **Web**（JS/TS、Canvas、Phaser 等） | ✅ | ✅ live-lite | 适配器导入你不依赖 DOM 的模拟逻辑 · `lab.js serve` 注入测试框架 |
| **Unity** | ✅ | ✅（uGUI 零代码，或使用你自己的目标） | `engines/unity/com.playtestlab.bridge`（UPM） |
| **Godot 4** | ✅ | ✅（需实现 observe/act；截图需要窗口） | `engines/godot/addons/playtest_bridge` |
| 回合制 / 解谜核心 | ✅（引擎内运行器 + `bots --import`） | ✅ | 见下文"引擎内机器人" |
| Unreal、Android、任何未经修改的 .exe | — | — | [路线图](#roadmap) |

## 安装

```bash
git clone https://github.com/mhwangbo/playtest-lab.git
cd playtest-lab && npm test          # no dependencies; Node 20+
```

若作为 Claude Code 技能使用，请让该文件夹可通过 `~/.claude/skills/playtest-lab` 访问（符号链接或目录联接均可）。然后让 Claude "playtest my game" 即可。

## 快速上手

### 1. Web 游戏

```bash
node lab/lab.js init --game path/to/game --build http://localhost:5173/
# write path/to/game/.playtest/adapter.mjs  (template copied for you; example: examples/mothlight.adapter.mjs)
node lab/lab.js --game path/to/game run new --label "M1"
node lab/lab.js --game path/to/game bots --runs 30
node lab/lab.js --game path/to/game report
```

适配器需导出 `create(seed)`、`observe`、`step`、`done`、`metrics`、`idleAction`、`randomAction`、`policies`，以及可选的 `findings`。完整约定见 [CONTRACT.md](CONTRACT.md)。

在 Web 构建上运行人设：

```bash
node lab/lab.js --game path/to/game serve --root dist --port 8120
```

然后使用 [SKILL.md §3b](SKILL.md) 中的提示词启动一个人设。编写一个 `.playtest/perception.js` 来描述屏幕上的内容；示例见 [examples/mothlight.perception.js](examples/mothlight.perception.js)。

### 2. Unity

1. 添加包：
   ```json
   "com.playtestlab.bridge": "https://github.com/mhwangbo/playtest-lab.git?path=/engines/unity/com.playtestlab.bridge"
   ```
2. **机器人：** 实现一个 `IPlaytestTarget`（用种子重置、执行动作、观察、判断结束、输出指标），打一个 Windows 包，并让适配器指向它：
   ```js
   export const bridge = { command: 'Builds/Win/MyGame.exe', args: ['-batchmode', '-nographics', '-playtestPort', '{PORT}', '-logFile', '-'] };
   ```
   完整示例见 [examples/unity-coinline](examples/unity-coinline)：80 次无头运行约 6 秒完成，结果确定。
3. **人设：** 添加
   ```js
   export const personaBridge = { command: 'Builds/Win/MyGame.exe', hideWindow: false, args: ['-screen-fullscreen', '0', '-screen-width', '405', '-screen-height', '720', '-playtestPort', '{PORT}', '-playtestUgui'] };
   ```
   然后运行 `lab.js host`。使用 `-playtestUgui` 时，任何 uGUI 游戏都无需写代码即可运行。如需暴露棋盘或游戏状态，请继承 `PlaytestUguiTarget`。

### 3. Godot 4

1. 将 `engines/godot/addons/playtest_bridge` 复制到你的项目中并启用该插件。它会注册 `PlaytestBridge` 自动加载（autoload）。
2. 在 `playtest_target` 组中放置一个节点，并实现 `reset_game(seed)`、`apply_action(dict)`、`observe()`、`is_done()` 和 `metrics()`。
3. 让适配器指向 Godot：
   ```js
   export const bridge = { command: process.env.GODOT_BIN || 'godot', cwd: '.', args: ['--headless', '--fixed-fps', '60', '--path', '.', '--', '--playtestPort={PORT}'] };
   ```
   完整示例见 [examples/godot-coinline](examples/godot-coinline)。它与 Unity 示例的结果完全一致，且结果确定。

### 捕获回归（适用于任何引擎）

```bash
node lab/lab.js --game path/to/game baseline set      # 在一次良好的机器人运行之后执行；提交 .playtest/baseline.json
node lab/lab.js --game path/to/game check             # 每次改动之后执行：退出码 0 = 与基线一致，1 = 出现回归
node lab/lab.js --game path/to/game replay .playtest/runs/R3/traces/careful-s4-crash.json --expect fixed
```

`check` 会重新运行基线的种子，因此任何差异都意味着游戏本身发生了真实的变化。可以在 `.playtest/config.json` → `check`
中设置容差，或指定某个指标应该朝哪个方向变化（见 [CONTRACT.md](CONTRACT.md) §4）。

### 引擎内机器人（解谜、回合制、大型游戏）

如果你的游戏有一个纯逻辑核心，可以直接在引擎内运行机器人（例如 Unity 的 `-batchmode -executeMethod`）。将按关卡的结果写成 `{levels:[{id, …, policies:[{policy, runs, solvedPct, movesP50, …}]}]}` 格式并导入：

```bash
node lab/lab.js --game . bots --import .playtest/my_bots.json
```

之后，你可以在适配器中用 `findingsFromLevels(levels)` 将结果与设计意图进行对比，例如预期的解题时间区间与机器人实际投入的对比、难度档位中的异常值，或者无关紧要的规则。

## 成本（实测）

以下为 API 标价，数据来自在一款小型 Web 游戏和一款 Unity 解谜游戏上的真实测试：

| 模式 | 模型 | 每次成本 | 备注 |
|---|---|---|---|
| 机器人 | — | $0 | Web：80 个夜晚约 8 秒。Unity：80 次运行约 6 秒。解谜核心：30 关 × 3 种策略 × 30 个种子约 4 分钟 |
| Web 人设，每回合截图 | Sonnet | $1.51 | 我们最初的基线 |
| Web 人设，live-lite（贴近人类感知，前 60 秒以视觉为主） | Haiku | **$0.39–0.49** | 发现了与基线相同的、已验证的新手引导问题 |
| 引擎人设（Unity 构建，`play` 命令） | Haiku | $0.86–1.30 | 人设卡在某一关时成本会上升 |

## 坦诚的局限

- **LLM 人设不擅长空间类谜题。** 它们的吃力程度会高估人类玩家实际感受到的难度。请把它们用于评估清晰度、新手引导、剧情和手感，难度评估则交给机器人加真实玩家遥测数据。
- **感知信息可能过于"友好"。** 精确的状态转储会让游戏看起来比实际像素画面更易懂（曾有一个人设打了 5/5，却漏掉了一个真实的新手引导问题）。这正是引入"贴近人类感知"模式和前一分钟截图的原因。
- **感知信息也可能掩盖引导。** 曾有一个人设无法使用提示功能，因为提示在屏幕上的高亮效果没有被描述出来。每一个可见的提示线索都要如实反映。
- **廉价模型有时会声称做了实际上没做的操作。** 只有 lab 记录下来的操作才算数。
- **人设听不到音频。**

以上结论均来自真实运行，并记录在 [LESSONS.md](LESSONS.md) 中。

<a id="roadmap"></a>
## 路线图

- **免集成模式：** 人设通过截图和真实的鼠标键盘（computer-use）操作任何未经修改的桌面游戏。速度较慢，但完全无需集成。
- **Unreal** 桥接（C++ 子系统或 Python），以及 **Android**（通过 adb 连接模拟器或真机）。
- **缺陷包，第二部分**（第一部分已在 0.2 中发布：不变量、记录的错误、轨迹与回放、`lab check`）：
  - 失败轨迹的自动最小化
  - 混沌机器人与新奇探索机器人
  - 覆盖率报告
- **趣味报告，第二部分：** 学习曲线（人设和玩家在多次尝试中进步有多快），以及来自人设评分表的紧张度。
- **回放评审人设：** 成本更低；它们评审录制好的关键帧，而不是实时游玩。
- **人类遥测数据导入：** 用真实玩家数据校准机器人和人设。
- **基于模型的反馈分类**插件（例如 [laya](https://github.com/NandhaKishorM/laya) 这类本地分类器）。
- **外部决策 API 机器人**插件（例如 Jev 这类快速动作选择模型），使用适配器的 `actionMenu`。
- uGUI 辅助工具支持 TextMeshPro；为人设增加按关卡的动作次数上限。

## 文档

- [SKILL.md](SKILL.md)：智能体如何运行 lab，包括人设提示词。
- [CONTRACT.md](CONTRACT.md)：适配器 API 与报告结构。
- [SECURITY.md](SECURITY.md)：会在你的机器上运行哪些东西，以及人设的安全护栏。
- [LESSONS.md](LESSONS.md)：出过哪些问题，以及是如何修复的。

## 许可证

[MIT](LICENSE)
