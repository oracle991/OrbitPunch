# OrbitPunch

OrbitPunch（軌道衛星パンチ）は、Phaser 3 + TypeScript + Vite で制作されたブラウザ向けアクションゲームです。プレイヤーは惑星を周回する衛星を操作し、外向きパンチで脅威を弾き返してチェーンをつなぎ、スコアを伸ばしながら惑星を防衛します。

## Play (デプロイ済み成果物)

以下のページでデプロイ済みの成果物をプレイできます。

- https://oracle991.github.io/OrbitPunch/

## 現在のゲーム概要（実装ベース）

- 惑星HPを守りながら脅威を迎撃するウェーブ制ゲーム。
- パンチで弾いた敵を別の敵へ衝突させるとチェーンが発生。
- チェーン数に応じてスコア加算と惑星HP回復が発生。
- 敗北条件は「惑星HPが0になること」。

## 操作方法

- `Space`：パンチ
- マウス左クリック / タップ：パンチ
- `Esc`：ポーズ

## 主な実装要素

- Phaser 3 / TypeScript / Vite によるゲーム実行環境
- タイトル / ポーズ / ゲームオーバー / リトライ
- DOMベースHUD（PLANET / SCORE / WAVE / READY）
- プレイヤー自動周回 + ワンボタンパンチ
- 5種の脅威（meteor / orbitalSatellite / explosiveCore / tractorDrone / miniBoss）
- JSONベースのウェーブ・スポーン設定
- ヒットストップ、画面揺れ、スパーク、チェーン表示

## 主要ファイル

- エントリポイント: `src/main.ts`
- メインシーン描画: `src/game/GameScene.ts`
- シミュレーション: `src/game/simulation.ts`
- ウェーブ設定: `src/game/data/threat-waves.json`
- 仕様ドキュメント: `PLAN.md`

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
