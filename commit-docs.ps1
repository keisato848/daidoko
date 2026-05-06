# commit-docs.ps1 — 変更ファイルをgit developブランチにコミットします
# 右クリック → "PowerShellで実行" で起動してください

Set-Location $PSScriptRoot

git config user.name  "Kei"
git config user.email "habnk1227@gmail.com"

$branch = git rev-parse --abbrev-ref HEAD 2>$null
if ($branch -ne "develop") {
    git checkout develop 2>$null
    if ($LASTEXITCODE -ne 0) { git checkout -b develop }
}

git add docs/ mockup/ CLAUDE.md package.json pnpm-workspace.yaml tsconfig.json eslint.config.js .prettierrc .gitignore docker-compose.dev.yml apps/ packages/
git status
git commit -m "chore: Claude Code 実装環境を準備（モノレポ骨格・CLAUDE.md・初回プロンプト）"

Write-Host ""
Write-Host "=== コミット完了 ===" -ForegroundColor Green
git log --oneline -5
Write-Host ""
Write-Host "Enterキーで閉じます"
Read-Host
