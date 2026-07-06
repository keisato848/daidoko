---
name: commit-split
description: 混在した作業ツリーを機能単位の小さなコミットに分割する定型手順。ファイル単位の振り分け、1ファイル内に複数機能が混在する場合のハンク分割（scripts/agent/stage-hunks.py）、各コミットの pre-commit グリーン確認まで。
---

# 機能単位コミット分割

ユーザーの恒常的な希望: **こまめに・機能スコープの小さいコミット**。複数の作業が作業ツリーに混在したら、
まとめて 1 コミットにせず機能単位へ分割する。

## 手順

1. `git status --porcelain` と `git diff --stat` で全変更を棚卸し → 機能グループに分類
2. **ファイル単位で分けられる分**: グループごとに `git add <files>` → commit（pre-commit がスライス検証を回す）
3. **1 ファイル内に複数機能のハンクが混在**する場合はハンク分割:

   ```bash
   # 内容マーカー（そのハンクにだけ現れる文字列）を指定して該当ハンクだけ index へ
   python scripts/agent/stage-hunks.py <path> <marker1> [<marker2> ...]
   git commit -m "..."   # 残りは作業ツリーに残る → 次のグループで繰り返す
   ```

   - stage-hunks.py は 1 ハンクずつ LF の一時 patch を作り `git apply --cached` で適用、
     **毎適用後に diff を再生成**するので行番号ズレに強い
   - `git add -p` は対話型なのでこの環境では使えない（stage-hunks が代替）

4. 各コミッで pre-commit（秘密スキャン→prettier→スライス検証）がグリーンであることを確認
5. コミットメッセージは Conventional Commits（feat/fix/docs/chore…）で機能を1行要約

## 落とし穴

- **CRLF**: patch を PowerShell のヒアストリング等で作ると CRLF 混入で apply 失敗 — 必ずファイル経由・UTF-8/LF
  （stage-hunks.py が面倒を見る）
- コミット後に `git log --oneline -1` で**実際にコミットされたか確認**（pre-commit 出力が長く、失敗を見落としやすい。
  hook が出力しても exit 1 だと no-op）
- prettier がテーブル等を勝手に整形して pre-commit が別ファイルを触ることがある — `git status` で意図しないステージを確認
