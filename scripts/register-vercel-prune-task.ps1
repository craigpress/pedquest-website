# Registers the weekly "PedQuEST-Vercel-Prune" scheduled task on CraigsRig.
# The task runs scripts/prune-vercel-deployments.mjs, which keeps the newest
# few Vercel deployments and deletes the rest (Hobby Deployment-Storage cap).
#
# No token or one-time setup is needed: the script shells out to the `vercel`
# CLI, which is already logged in on this machine (the same login your terminal
# `vercel ...` commands use). The task runs as the interactive user, so it
# inherits that same CLI login.
#
# Run this script once (normal PowerShell, no elevation needed):
#   pwsh -File scripts/register-vercel-prune-task.ps1

$ErrorActionPreference = 'Stop'

$taskName = 'PedQuEST-Vercel-Prune'
$node     = (Get-Command node).Source
$script   = Join-Path $PSScriptRoot 'prune-vercel-deployments.mjs'
$workdir  = Split-Path $PSScriptRoot -Parent          # the pedquest-site root
$logDir   = Join-Path $env:USERPROFILE '.claude\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log      = Join-Path $logDir 'vercel-prune.log'

# Wrapper .cmd so stdout/stderr land in a log and no console window flashes.
$wrapper  = Join-Path $PSScriptRoot 'run-vercel-prune.cmd'
@"
@echo off
cd /d "$workdir"
"$node" "$script" >> "$log" 2>&1
"@ | Set-Content -Path $wrapper -Encoding ASCII

$action    = New-ScheduledTaskAction -Execute $wrapper
$trigger   = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 6:15AM
# Interactive: runs while Craig is logged on to the workstation (no stored
# password, no elevation needed to register); hidden so nothing flashes.
$principal = New-ScheduledTaskPrincipal -UserId (whoami) -LogonType Interactive -RunLevel Limited
$settings  = New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable `
             -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
             -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "Registered '$taskName' (Mondays 6:15 AM). Log: $log"
Write-Host "No token needed - it uses your logged-in vercel CLI."
Write-Host "Test now with a dry run of: $script"
