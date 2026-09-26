[English](README.md) | [한국어](README.ko.md) | **日本語** | [简体中文](README.zh-CN.md) | [Español](README.es.md)

# playtest-lab

*この文書は翻訳です。英語版 README と内容が異なる場合は、英語版が優先されます。*

[![ci](https://github.com/mhwangbo/playtest-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/mhwangbo/playtest-lab/actions/workflows/ci.yml)

**あなたのゲームのためのプレイテストグループ：ボットプレイヤー、AI ペルソナのプレイテスター、そして優先度付きのレポート。**
現在は Web ゲーム、Unity、Godot に対応しています。[Claude Code](https://claude.com/claude-code) のスキルであると同時に、依存関係ゼロの Node CLI でもあります。

性質の異なる 2 つの問いに、低コストで答えます。

| 問い | 誰が答えるか | コスト |
|---|---|---|
| **壊れていないか / バランスは取れているか？** クラッシュ、壊れたルール、記録されたエラー、ソフトロック、リグレッション、難易度カーブ、スキル勾配 | **ボット**：ヘッドレス、決定論的、数千回の実行 | 無料（CPU） |
| **分かりやすいか / 面白いか？** オンボーディング、混乱、手触り、「もう一度遊びたいか」 | **ペルソナ**：実際のビルドをプレイする AI プレイテスター。評価基準（ルーブリック）と批判の記述が必須 | 1 セッションあたり約 $0.40–1.30 |

どちらの結果も、バージョン管理された 1 つのレポート（`playtest-report.json` と `report.md`）に書き込まれます。レポートには優先度付きの問題、問題ごとの推奨チケット、レベル別の表が含まれます。

---

## 同梱されているもの

- **ボットランナー**（`lab/bots.js`）
  - 小さな **アダプター** を介して、多数のシードでゲームをプレイします。放置（idle）、ランダム、そして独自のスキルポリシーを使用できます。
  - メトリクスを平均値と p10/p50/p90 で集計します。
  - クラッシュや終わらない実行を P0/P1 の問題として報告し、独自のバランスアラームにも対応します。
- **バグパック**（無料、決定論的）
  - **不変条件（Invariants）：** 常に成り立つべきルールを宣言します（アダプター内、Godot の `check_invariants()`、または Unity の `IPlaytestInvariants`）。ルールが破られると実行は停止し、バグとして記録されます。
  - **記録されたエラー：** Unity の例外、Godot の `ERROR:` 行、`console.error` をカウントします。ゲームがそれで落ちない場合も対象です。エンジンが実行中に落ちた場合は、原因とゲーム自身のスタックフレームを伴う P0 クラッシュになります。
  - **トレース：** 失敗したすべての実行が保存されます。`lab.js replay <trace>` で正確に再現でき、`--expect fixed` で修正を確認できます。
  - **リグレッションゲート：** 最初に `lab.js baseline set` を一度実行し、変更ごとに `lab.js check` を実行します。ボットの失敗率が上がるか、メトリクスが許容範囲を超えて変化すると終了コード 1 を返します。
- **エンジンブリッジ**（`playtest-bridge/1`）
  - localhost 上の改行区切り JSON です。
  - ゲームはラボがフレームを要求したときに **のみ**、固定タイムステップで進行するため、実行は **シードごとに決定論的** です。
  - **Unity** パッケージと **Godot** アドオンとして提供されます。
- **ペルソナ**（実際のビルドをプレイします）
  - **Web（live-lite）：** ページにハーネスが注入されます。ゲームは疑似クロック上で動作し（ターン間は停止、ターン中は早送り）、ペルソナはプレイヤーの操作（動詞）で行動します。ペルソナが知覚するのは画面上のテキストと、「ヒューマンフィデリティ（人間並みの忠実度）」のシーン記述です。この記述では数量を意図的に曖昧にし、因果関係を示す表現を含めません。最初の 60 秒間はスクリーンショットも与えられます。
  - **エンジンビルド：** `lab.js host` がビルドをウィンドウで起動します。ペルソナはシンプルなコマンド（`play tap Play`、`play drag B --to 2,1`、`play shot`）で操作します。Unity の uGUI ゲームなら **コード不要** でこれが使えます（`-playtestUgui`）。
  - **ルーブリック：** すべてのペルソナは、10 秒時点と 60 秒時点の分かりやすさ、主体性（エージェンシー）、緊張感、報酬、リプレイ性を評価し、最も自信が持てなかった瞬間を 3 つ挙げなければなりません。問題は主張するだけでなく、記録されている必要があります。
- **レポートビルダー**
  - ペルソナが報告した問題は、誰かが再現するまで **未検証** として扱われ、判定には含まれません。
  - ボットの検出結果はシードで再現できるため、即座にカウントされます。
- **オプションの [ai-game-studio](https://github.com/mhwangbo/ai-game-studio) 連携**
  - サマリーをスタジオの `#qa` チャットにミラーリングします。
  - スタジオのプレイテストゲートが `suggestedTicket` をチケットに変換します。
  - `integrations.gameStudio: "off"` で無効にできます。

## エンジン対応状況

| エンジン | ボット | ペルソナ | 方法 |
|---|---|---|---|
| **Web**（JS/TS、Canvas、Phaser など） | ✅ | ✅ live-lite | アダプターが DOM に依存しないシミュレーションを import · `lab.js serve` がハーネスを注入 |
| **Unity** | ✅ | ✅（uGUI はコード不要、または独自のターゲット） | `engines/unity/com.playtestlab.bridge`（UPM） |
| **Godot 4** | ✅ | ✅（observe/act を実装。スクリーンショットにはウィンドウが必要） | `engines/godot/addons/playtest_bridge` |
| ターン制 / パズルのコア | ✅（エンジン側ランナー + `bots --import`） | ✅ | 下記「エンジン側ボット」を参照 |
| Unreal、Android、改変していない任意の .exe | — | — | [ロードマップ](#roadmap) |

## インストール

```bash
git clone https://github.com/mhwangbo/playtest-lab.git
cd playtest-lab && npm test          # no dependencies; Node 20+
```

Claude Code のスキルとして使う場合は、このフォルダを `~/.claude/skills/playtest-lab` として参照できるようにします（シンボリックリンクまたはジャンクション）。その後、Claude に「playtest my game」のように依頼してください。

## クイックスタート

### 1. Web ゲーム

```bash
node lab/lab.js init --game path/to/game --build http://localhost:5173/
# write path/to/game/.playtest/adapter.mjs  (template copied for you; example: examples/mothlight.adapter.mjs)
node lab/lab.js --game path/to/game run new --label "M1"
node lab/lab.js --game path/to/game bots --runs 30
node lab/lab.js --game path/to/game report
```

アダプターは `create(seed)`、`observe`、`step`、`done`、`metrics`、`idleAction`、`randomAction`、`policies`、およびオプションの `findings` をエクスポートします。完全な仕様は [CONTRACT.md](CONTRACT.md) にあります。

Web ビルドでペルソナを使う場合：

```bash
node lab/lab.js --game path/to/game serve --root dist --port 8120
```

その後、[SKILL.md §3b](SKILL.md) のプロンプトでペルソナを起動します。画面上の内容を記述する `.playtest/perception.js` を用意してください。例は [examples/mothlight.perception.js](examples/mothlight.perception.js) です。

### 2. Unity

1. パッケージを追加します。
   ```json
   "com.playtestlab.bridge": "https://github.com/mhwangbo/playtest-lab.git?path=/engines/unity/com.playtestlab.bridge"
   ```
2. **ボット：** `IPlaytestTarget` を 1 つ実装し（シードでのリセット、アクションの適用、observe、done、metrics）、Windows ビルドを作成して、アダプターからそれを指定します。
   ```js
   export const bridge = { command: 'Builds/Win/MyGame.exe', args: ['-batchmode', '-nographics', '-playtestPort', '{PORT}', '-logFile', '-'] };
   ```
   実例は [examples/unity-coinline](examples/unity-coinline) です。ヘッドレスで 80 回の実行が約 6 秒で完了し、結果は決定論的です。
3. **ペルソナ：** 次を追加します。
   ```js
   export const personaBridge = { command: 'Builds/Win/MyGame.exe', hideWindow: false, args: ['-screen-fullscreen', '0', '-screen-width', '405', '-screen-height', '720', '-playtestPort', '{PORT}', '-playtestUgui'] };
   ```
   その後 `lab.js host` を実行します。`-playtestUgui` を付ければ、どの uGUI ゲームでもコードなしで動作します。盤面やゲーム状態を扱う場合は `PlaytestUguiTarget` をサブクラス化してください。

### 3. Godot 4

1. `engines/godot/addons/playtest_bridge` をプロジェクトにコピーし、プラグインを有効にします。これにより `PlaytestBridge` オートロードが登録されます。
2. `reset_game(seed)`、`apply_action(dict)`、`observe()`、`is_done()`、`metrics()` を持つノードを 1 つ、グループ `playtest_target` に配置します。
3. アダプターから Godot を指定します。
   ```js
   export const bridge = { command: process.env.GODOT_BIN || 'godot', cwd: '.', args: ['--headless', '--fixed-fps', '60', '--path', '.', '--', '--playtestPort={PORT}'] };
   ```
   実例は [examples/godot-coinline](examples/godot-coinline) です。Unity のサンプルと同じ結果が得られ、決定論的です。

### リグレッションの検出（どのエンジンでも）

```bash
node lab/lab.js --game path/to/game baseline set      # 良好なボット実行の後に; .playtest/baseline.json をコミットする
node lab/lab.js --game path/to/game check             # 変更ごとに: 終了コード 0 = ベースラインと同じ、1 = リグレッション
node lab/lab.js --game path/to/game replay .playtest/runs/R3/traces/careful-s4-crash.json --expect fixed
```

`check` はベースラインのシードを再実行するため、差異があればそれはゲームの実際の変化です。許容誤差の設定や、
メトリクスがどちら方向に動くべきかの指定は `.playtest/config.json` → `check` で行います（[CONTRACT.md](CONTRACT.md) §4）。

### エンジン側ボット（パズル、ターン制、大規模ゲーム）

ゲームに純粋なロジックのコアがある場合は、ボットをエンジン内で実行します（例：Unity の `-batchmode -executeMethod`）。レベルごとの結果を `{levels:[{id, …, policies:[{policy, runs, solvedPct, movesP50, …}]}]}` の形式で書き出し、インポートします。

```bash
node lab/lab.js --game . bots --import .playtest/my_bots.json
```

その後、アダプターの `findingsFromLevels(levels)` で結果を設計意図と比較できます。たとえば、想定したクリア時間の範囲とボットの労力の比較、ティア内の外れ値、影響のないルールの検出などです。

## コスト（実測値）

以下は API の定価に基づく金額で、小規模な Web ゲームと Unity のパズルゲームでの実際のセッションから得たものです。

| モード | モデル | コスト / セッション | 備考 |
|---|---|---|---|
| ボット | — | $0 | Web：80 夜分を約 8 秒。Unity：80 回の実行を約 6 秒。パズルコア：30 レベル × 3 ポリシー × 30 シードを約 4 分 |
| Web ペルソナ、毎ターンスクリーンショット | Sonnet | $1.51 | 出発点としたベースライン |
| Web ペルソナ、live-lite（ヒューマンフィデリティ、最初の 60 秒は画像優先） | Haiku | **$0.39–0.49** | ベースラインと同じ、検証済みのオンボーディング問題を発見 |
| エンジンペルソナ（Unity ビルド、`play` コマンド） | Haiku | $0.86–1.30 | ペルソナが 1 つのレベルで行き詰まるとコストが増加 |

## 正直な限界

- **LLM ペルソナは空間パズルが苦手です。** ペルソナの苦戦ぶりは、人間にとっての難しさを過大に見せます。ペルソナは分かりやすさ、オンボーディング、ストーリー、手触りの評価に使い、難易度はボットと実プレイヤーのテレメトリに任せてください。
- **知覚が親切すぎることがあります。** 正確な状態ダンプを与えると、ピクセルで見るよりもゲームが分かりやすく見えてしまいました（あるペルソナは 5/5 と評価し、実際のオンボーディングの問題を見逃しました）。そのため、ヒューマンフィデリティモードと最初の 1 分間のスクリーンショットを用意しています。
- **知覚がガイダンスを隠してしまうこともあります。** ヒントの画面上のハイライトが記述されていなかったため、ペルソナがヒントを使えなかった例があります。目に見える手がかりはすべて反映してください。
- **安価なモデルは、実行していないアクションを実行したと主張することがあります。** カウントされるのは、ラボが記録したものだけです。
- **ペルソナは音声を聞くことができません。**

これらは実際の実行から得られた知見で、[LESSONS.md](LESSONS.md) に記録されています。

<a id="roadmap"></a>
## ロードマップ

- **連携不要モード：** ペルソナがスクリーンショットと実際のマウス・キーボード操作（computer-use）で、改変していない任意のデスクトップゲームを操作します。低速ですが、連携作業はゼロです。
- **Unreal** ブリッジ（C++ サブシステムまたは Python）、および **Android**（adb 経由でエミュレーターまたは実機）。
- **バグパック 第2部**（第1部は 0.2 で提供済み：不変条件、記録されたエラー、トレースとリプレイ、`lab check`）：
  - 失敗したトレースの自動最小化
  - カオスボットとノベルティボット
  - カバレッジレポート
- **面白さメトリクスレポート：** スキル勾配、運と実力の比率、支配的戦略、緊張感カーブ、学習曲線。
- **リプレイレビュー型ペルソナ：** ライブでプレイする代わりに記録されたキーフレームを批評するため、さらに低コストです。
- **人間のテレメトリのインポート：** ボットとペルソナを実プレイヤーに合わせて調整します。
- **モデルベースのフィードバック分類**（プラグインとして。例：[laya](https://github.com/NandhaKishorM/laya) のようなローカル分類器）。
- **外部の意思決定 API ボット**（プラグインとして。例：Jev のような高速な行動選択モデル）。アダプターの `actionMenu` を使用します。
- uGUI ヘルパーでの TextMeshPro 対応、ペルソナ向けのレベルごとのアクション上限。

## ドキュメント

- [SKILL.md](SKILL.md)：エージェントがラボを実行する方法（ペルソナのプロンプトを含む）。
- [CONTRACT.md](CONTRACT.md)：アダプター API とレポートのスキーマ。
- [SECURITY.md](SECURITY.md)：あなたのマシン上で何が実行されるか、およびペルソナのガードレール。
- [LESSONS.md](LESSONS.md)：何が壊れ、どう修正したか。

## ライセンス

[MIT](LICENSE)
