# SplitFlasher メモ

自分用の手短メモ。実装の実態に合わせて記録。

## ざっくり概要

- Electron + React (Vite) で動く Split キーボード用 UF2 フラッシャー。
- zip を解析して右/左用 UF2 を自動判別し、右→左の順に書き込み。
- `diskutil info` で取得したデバイス ID を使い、書き込み直後に同じ側が自動マウントされても 10 秒間は無視して誤コピーを防止。

## ディレクトリ構成メモ

- `src/main.ts` : Electron メインプロセス。
  - ボリューム監視 (`chokidar`)、zip 展開、UF2 コピー、再マウント抑止ロジックなど。
- `src/preload.ts` : Renderer との IPC ブリッジ。
- `src/renderer/App.tsx` : UI 本体。`GLOBAL_STYLES` に CSS を内包。
- `firmware/` : 手元テスト用のファームウェア置き場（任意）。

## セットアップ

```sh
npm install
```

## 開発モード

Electron + Vite の開発環境を起動:

```sh
npm run dev
```

- 起動後 `npm run dev` ターミナルに dev server URL が表示される。
- UI は `preload` の API が初期化されるまで自動でリトライ。

## ビルド

メイン/プリロード/レンダラーをまとめてビルド:

```sh
npm run build
```

出来上がりは `dist/` 下に配置（`tsconfig.node.json` と Vite の出力）。

## 動作確認メモ

1. `npm run dev` を起動してウィンドウを表示。
2. UF2 を含む zip をドラッグ＆ドロップ。
3. ステータスが `右側デバイスを接続してください` → `コピー中` → `完了` の順で進む。
4. 右側書き込み完了後は同じデバイスが再マウントしても 10 秒間無視される。
5. 左側デバイスを接続するとコピーが再開、両側完了で一時ディレクトリがクリーンアップされる。

## 備考

- 失敗時はコピー途中で state をリセットしてエラーメッセージを出す。
- Finder 等で手動コピーが必要な場合はステータス欄にヒントを表示。
- 追加テスト: `npm run lint` で TypeScript チェックのみ（現状テストスイート無し）。

