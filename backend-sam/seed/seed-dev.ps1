# OSS dev シードスクリプト
# 用途: sam deploy（B案でスタック再作成）後に、organizations と race の
#       最低限のデータを投入する。
# 実行: PowerShell で  .\seed-dev.ps1   （backend-sam\seed どこからでも可）
#
# 投入内容:
#   - organizations: circuit 1〜7
#   - race: テスト用1件（id=2026test_race / today_id=TESTRACE2026061500）
#
# 大会IDで照会するときは conform 画面に「TESTRACE2026061500」を入力する。

$ErrorActionPreference = "Stop"
$region = "ap-northeast-1"
# AWS CLI が file:// の JSON を UTF-8 として読むよう指定（既定の cp932 だと日本語で失敗する）
$env:AWS_CLI_FILE_ENCODING = "utf-8"
Set-Location $PSScriptRoot

Write-Host "== organizations を投入 =="
aws dynamodb batch-write-item --request-items file://organizations.json --region $region | Out-Null

Write-Host "== race を投入 =="
aws dynamodb batch-write-item --request-items file://race.json --region $region | Out-Null

Write-Host ""
Write-Host "== 件数確認 =="
$orgCount  = aws dynamodb scan --table-name "OfficialSupportSystem-dev-Organizations" --region $region --select COUNT --query "Count" --output text
$raceCount = aws dynamodb scan --table-name "OfficialSupportSystem-dev-Race" --region $region --select COUNT --query "Count" --output text
Write-Host "  organizations: $orgCount 件 (期待値 7)"
Write-Host "  race         : $raceCount 件 (期待値 1)"
Write-Host ""
Write-Host "conform 画面に入力する大会ID(today_id): TESTRACE2026061500"
