[English](README.md) | **한국어** | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [Español](README.es.md)

# playtest-lab

*이 문서는 번역본입니다. 영어 README와 내용이 다를 경우 영어 버전이 우선합니다.*

[![ci](https://github.com/mhwangbo/playtest-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/mhwangbo/playtest-lab/actions/workflows/ci.yml)

**여러분의 게임을 위한 플레이테스트 그룹: 봇 플레이어, AI 페르소나 플레이테스터, 그리고 우선순위가 매겨진 리포트.**
현재 웹 게임, Unity, Godot을 지원합니다. [Claude Code](https://claude.com/claude-code) 스킬이면서, 의존성이 전혀 없는 Node CLI이기도 합니다.

서로 다른 두 가지 질문에 저렴하게 답해 줍니다.

| 질문 | 누가 답하는가 | 비용 |
|---|---|---|
| **망가지지 않았나 / 밸런스는 맞나?** 크래시, 깨진 규칙, 기록된 에러, 소프트락, 회귀, 난이도 곡선, 실력 격차(skill gradient) | **봇**: 헤드리스, 결정론적, 수천 회 실행 | 무료 (CPU) |
| **이해하기 쉬운가 / 재미있는가?** 온보딩, 혼란스러운 지점, 손맛, "다시 플레이할 것인가" | **페르소나**: 실제 빌드를 플레이하는 AI 플레이테스터. 평가 기준표(rubric)와 필수 비판 항목이 있음 | 세션당 약 $0.40–1.30 |

두 결과 모두 하나의 버전 관리되는 리포트, 즉 `playtest-report.json`과 `report.md`에 기록됩니다. 리포트에는 우선순위가 매겨진 이슈, 이슈별 추천 티켓, 레벨별 표가 담깁니다.

---

## 구성 요소

- **봇 러너** (`lab/bots.js`)
  - 작은 **어댑터**를 통해 여러 시드로 게임을 플레이하며, idle·random 정책과 직접 작성한 스킬 정책을 사용합니다.
  - 지표를 평균과 p10/p50/p90으로 집계합니다.
  - 크래시와 끝나지 않는 실행을 P0/P1 이슈로 보고하며, 직접 정의한 밸런스 경보도 지원합니다.
- **버그 팩** (무료, 결정론적)
  - **불변식(Invariants):** 항상 성립해야 하는 규칙을 선언합니다(어댑터에서, Godot의 `check_invariants()`, 또는 Unity의 `IPlaytestInvariants`). 규칙이 깨지면 실행이 중단되고 버그로 기록됩니다.
  - **기록된 에러:** Unity 예외, Godot의 `ERROR:` 라인, `console.error`를 게임이 죽지 않고 살아있어도 집계합니다. 엔진이 실행 중 죽으면 원인과 게임 자체의 스택 프레임이 담긴 P0 크래시가 됩니다.
  - **트레이스:** 실패한 모든 실행이 저장됩니다. `lab.js replay <trace>`로 정확히 재현할 수 있고, `--expect fixed`로 수정 여부를 확인합니다.
  - **회귀 게이트:** `lab.js baseline set`을 한 번 실행한 뒤, 변경할 때마다 `lab.js check`를 실행합니다. 봇이 더 자주 실패하거나 지표가 허용 범위를 벗어나면 종료 코드 1을 반환합니다.
- **엔진 브리지** (`playtest-bridge/1`)
  - localhost 상에서 줄 단위 JSON으로 통신합니다.
  - 게임은 랩이 프레임을 요청할 때**만** 고정 타임스텝으로 진행되므로, 실행 결과가 **시드별로 결정론적**입니다.
  - **Unity** 패키지와 **Godot** 애드온으로 제공됩니다.
- **페르소나** — 실제 빌드를 플레이합니다.
  - **웹 (live-lite):** 페이지에 하네스가 주입됩니다. 게임은 가짜 시계 위에서 돌아가고(턴 사이에는 멈추고, 턴 동안에는 빨리 감기), 페르소나는 플레이어 동사로 행동하며, 화면 텍스트와 "인간 수준 충실도(human-fidelity)" 장면 묘사를 통해 상황을 인지합니다. 이 묘사는 수량을 일부러 모호하게 표현하고 인과관계를 드러내는 표현을 쓰지 않습니다. 처음 60초 동안은 스크린샷도 받습니다.
  - **엔진 빌드:** `lab.js host`가 빌드를 창 모드로 실행합니다. 페르소나는 단순한 명령(`play tap Play`, `play drag B --to 2,1`, `play shot`)으로 행동합니다. Unity uGUI 게임은 **코드 없이**(`-playtestUgui`) 이 기능을 쓸 수 있습니다.
  - **평가 기준표:** 모든 페르소나는 10초 시점과 60초 시점의 명확성, 주체성(agency), 긴장감, 보상, 재플레이 의향을 평가해야 하며, 가장 확신이 없었던 순간 3개를 반드시 제시해야 합니다. 이슈는 주장만으로는 안 되고 기록으로 남아 있어야 합니다.
- **리포트 빌더**
  - 페르소나가 제기한 이슈는 누군가 재현하기 전까지 **미검증** 상태로 남으며 판정에서 제외됩니다.
  - 봇의 발견 사항은 시드로 재현되므로 즉시 반영됩니다.
- **선택 사항: [ai-game-studio](https://github.com/mhwangbo/ai-game-studio) 연동**
  - 요약을 스튜디오의 `#qa` 채팅에 미러링합니다.
  - 스튜디오의 플레이테스트 게이트가 `suggestedTicket`을 티켓으로 변환합니다.
  - `integrations.gameStudio: "off"`로 끌 수 있습니다.

## 엔진 지원

| 엔진 | 봇 | 페르소나 | 방법 |
|---|---|---|---|
| **Web** (JS/TS, Canvas, Phaser, …) | ✅ | ✅ live-lite | 어댑터가 DOM에 의존하지 않는 시뮬레이션을 import · `lab.js serve`가 하네스를 주입 |
| **Unity** | ✅ | ✅ (uGUI는 코드 없이, 또는 직접 만든 타깃) | `engines/unity/com.playtestlab.bridge` (UPM) |
| **Godot 4** | ✅ | ✅ (observe/act 구현 필요, 스크린샷은 창 필요) | `engines/godot/addons/playtest_bridge` |
| 턴제 / 퍼즐 코어 | ✅ (엔진 측 러너 + `bots --import`) | ✅ | 아래 "엔진 측 봇" 참고 |
| Unreal, Android, 수정되지 않은 모든 .exe | — | — | [로드맵](#roadmap) |

## 설치

```bash
git clone https://github.com/mhwangbo/playtest-lab.git
cd playtest-lab && npm test          # no dependencies; Node 20+
```

Claude Code 스킬로 쓰려면 이 폴더를 `~/.claude/skills/playtest-lab` 위치에서 접근할 수 있게 하세요(심볼릭 링크 또는 정션). 그런 다음 Claude에게 "playtest my game"이라고 요청하면 됩니다.

## 빠른 시작

### 1. 웹 게임

```bash
node lab/lab.js init --game path/to/game --build http://localhost:5173/
# write path/to/game/.playtest/adapter.mjs  (template copied for you; example: examples/mothlight.adapter.mjs)
node lab/lab.js --game path/to/game run new --label "M1"
node lab/lab.js --game path/to/game bots --runs 30
node lab/lab.js --game path/to/game report
```

어댑터는 `create(seed)`, `observe`, `step`, `done`, `metrics`, `idleAction`, `randomAction`, `policies`, 그리고 선택적으로 `findings`를 export합니다. 전체 계약은 [CONTRACT.md](CONTRACT.md)에 있습니다.

웹 빌드에서 페르소나 실행:

```bash
node lab/lab.js --game path/to/game serve --root dist --port 8120
```

그런 다음 [SKILL.md §3b](SKILL.md)의 프롬프트로 페르소나를 생성합니다. 화면에 보이는 내용을 묘사하는 `.playtest/perception.js`를 작성하세요. 예시는 [examples/mothlight.perception.js](examples/mothlight.perception.js)입니다.

### 2. Unity

1. 패키지를 추가합니다.
   ```json
   "com.playtestlab.bridge": "https://github.com/mhwangbo/playtest-lab.git?path=/engines/unity/com.playtestlab.bridge"
   ```
2. **봇:** `IPlaytestTarget` 하나를 구현하고(시드로 리셋, 액션 적용, observe, done, metrics), Windows 빌드를 만든 뒤 어댑터가 그 빌드를 가리키게 합니다.
   ```js
   export const bridge = { command: 'Builds/Win/MyGame.exe', args: ['-batchmode', '-nographics', '-playtestPort', '{PORT}', '-logFile', '-'] };
   ```
   실제 동작 예시는 [examples/unity-coinline](examples/unity-coinline)입니다. 헤드리스 80회 실행에 약 6초가 걸리며 결정론적입니다.
3. **페르소나:** 다음을 추가합니다.
   ```js
   export const personaBridge = { command: 'Builds/Win/MyGame.exe', hideWindow: false, args: ['-screen-fullscreen', '0', '-screen-width', '405', '-screen-height', '720', '-playtestPort', '{PORT}', '-playtestUgui'] };
   ```
   그런 다음 `lab.js host`를 실행합니다. `-playtestUgui`를 쓰면 어떤 uGUI 게임이든 코드 없이 동작합니다. 보드나 게임 상태가 필요하다면 `PlaytestUguiTarget`을 상속하세요.

### 3. Godot 4

1. `engines/godot/addons/playtest_bridge`를 프로젝트에 복사하고 플러그인을 활성화합니다. `PlaytestBridge` 오토로드가 등록됩니다.
2. `playtest_target` 그룹에 노드 하나를 두고 `reset_game(seed)`, `apply_action(dict)`, `observe()`, `is_done()`, `metrics()`를 구현합니다.
3. 어댑터가 Godot을 가리키게 합니다.
   ```js
   export const bridge = { command: process.env.GODOT_BIN || 'godot', cwd: '.', args: ['--headless', '--fixed-fps', '60', '--path', '.', '--', '--playtestPort={PORT}'] };
   ```
   실제 동작 예시는 [examples/godot-coinline](examples/godot-coinline)입니다. Unity 샘플과 동일한 결과를 내며 결정론적입니다.

### 회귀 감지 (모든 엔진)

```bash
node lab/lab.js --game path/to/game baseline set      # 정상적인 봇 실행 후; .playtest/baseline.json을 커밋하세요
node lab/lab.js --game path/to/game check             # 변경할 때마다: 종료 코드 0 = 기준선과 동일, 1 = 회귀
node lab/lab.js --game path/to/game replay .playtest/runs/R3/traces/careful-s4-crash.json --expect fixed
```

`check`는 기준선의 시드를 다시 실행하므로, 차이가 있다면 그건 게임에서 실제로 바뀐 부분입니다. 허용 오차를 설정하거나
어느 방향으로 지표가 움직여야 하는지는 `.playtest/config.json` → `check`에서 지정하세요 ([CONTRACT.md](CONTRACT.md) §4).

### 엔진 측 봇 (퍼즐, 턴제, 대형 게임)

게임에 순수 로직 코어가 있다면 봇을 엔진 내부에서 실행하세요(예: Unity `-batchmode -executeMethod`). 레벨별 결과를 `{levels:[{id, …, policies:[{policy, runs, solvedPct, movesP50, …}]}]}` 형식으로 기록한 뒤 import합니다.

```bash
node lab/lab.js --game . bots --import .playtest/my_bots.json
```

그러면 어댑터의 `findingsFromLevels(levels)`로 결과를 설계 의도와 비교할 수 있습니다. 예를 들어 의도한 풀이 시간대와 봇의 노력 비교, 티어별 이상치, 영향이 없는 규칙 등을 찾을 수 있습니다.

## 비용 (실측)

아래는 소규모 웹 게임과 Unity 퍼즐 게임의 실제 세션에서 측정한 API 정가 기준 비용입니다.

| 모드 | 모델 | 세션당 비용 | 비고 |
|---|---|---|---|
| 봇 | — | $0 | 웹: 80밤을 약 8초. Unity: 80회 실행을 약 6초. 퍼즐 코어: 30레벨 × 3정책 × 30시드를 약 4분 |
| 웹 페르소나, 매 턴 스크린샷 | Sonnet | $1.51 | 출발점이 된 기준선 |
| 웹 페르소나, live-lite (인간 수준 충실도, 처음 60초는 시각 우선) | Haiku | **$0.39–0.49** | 기준선과 동일한 검증된 온보딩 이슈를 발견 |
| 엔진 페르소나 (Unity 빌드, `play` 명령) | Haiku | $0.86–1.30 | 페르소나가 한 레벨에서 막히면 비용이 올라감 |

## 솔직한 한계

- **LLM 페르소나는 공간 퍼즐에 약합니다.** 이들이 겪는 어려움은 실제 사람이 느끼는 난이도보다 과장됩니다. 페르소나는 명확성, 온보딩, 스토리, 손맛 평가에 쓰고, 난이도는 봇과 실제 플레이어 텔레메트리에 맡기세요.
- **인지 정보가 너무 친절할 수 있습니다.** 정확한 상태 덤프를 주면 게임이 실제 화면보다 더 명확해 보였습니다(한 페르소나는 5/5점을 주고 실제 온보딩 이슈를 놓쳤습니다). 그래서 인간 수준 충실도 모드와 첫 1분간의 스크린샷을 도입했습니다.
- **인지 정보가 안내를 가릴 수도 있습니다.** 힌트의 화면 하이라이트가 묘사되지 않아 페르소나가 힌트를 활용하지 못한 적이 있습니다. 눈에 보이는 모든 신호를 빠짐없이 반영하세요.
- **저렴한 모델은 가끔 하지 않은 행동을 했다고 주장합니다.** 랩이 기록한 것만 인정됩니다.
- **페르소나는 오디오를 들을 수 없습니다.**

이 내용은 실제 실행에서 얻은 것이며 [LESSONS.md](LESSONS.md)에 기록되어 있습니다.

<a id="roadmap"></a>
## 로드맵

- **무연동 모드:** 페르소나가 스크린샷과 실제 마우스·키보드(computer-use)로 수정되지 않은 어떤 데스크톱 게임이든 조작합니다. 느리지만 연동 작업이 전혀 필요 없습니다.
- **Unreal** 브리지(C++ 서브시스템 또는 Python), 그리고 **Android**(adb를 통한 에뮬레이터 또는 실기기).
- **버그 팩, 2부** (1부는 0.2에서 출시: 불변식, 기록된 에러, 트레이스와 리플레이, `lab check`):
  - 실패한 트레이스의 자동 최소화
  - 카오스 봇과 새로움 탐색(novelty) 봇
  - 커버리지 리포트
- **재미 지표 리포트:** 실력 격차, 운 대 실력 비중, 지배적 전략, 긴장감 곡선, 학습 곡선.
- **리플레이 리뷰 페르소나:** 라이브로 플레이하는 대신 녹화된 키프레임을 비평하므로 더욱 저렴합니다.
- **사람 텔레메트리 import:** 봇과 페르소나를 실제 플레이어 데이터에 맞춰 보정합니다.
- **모델 기반 피드백 분류**를 플러그인으로 제공(예: [laya](https://github.com/NandhaKishorM/laya) 같은 로컬 분류기).
- **외부 의사결정 API 봇**을 플러그인으로 제공(예: Jev 같은 빠른 행동 선택 모델). 어댑터의 `actionMenu`를 사용합니다.
- uGUI 헬퍼의 TextMeshPro 지원, 페르소나용 레벨별 행동 횟수 상한.

## 문서

- [SKILL.md](SKILL.md): 에이전트가 랩을 실행하는 방법(페르소나 프롬프트 포함).
- [CONTRACT.md](CONTRACT.md): 어댑터 API와 리포트 스키마.
- [SECURITY.md](SECURITY.md): 여러분의 머신에서 무엇이 실행되는지, 그리고 페르소나 가드레일.
- [LESSONS.md](LESSONS.md): 무엇이 망가졌고 어떻게 고쳤는지.

## 라이선스

[MIT](LICENSE)
