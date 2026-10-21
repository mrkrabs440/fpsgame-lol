@echo off
title 작업 스케줄러 점검 (schtasks.exe 미사용)
echo ==================================================
echo   schtasks.exe 대신 PowerShell API(Get-ScheduledTask)를
echo   사용합니다. 새 프로세스를 띄우지 않습니다.
echo   (관리자 권한 불필요)
echo ==================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; $all=@(Get-ScheduledTask); Write-Host ('전체 작업 항목: ' + $all.Count) -ForegroundColor Cyan; $susp=@(); foreach($t in $all){ $path=$t.TaskPath; $name=$t.TaskName; $exec=(($t.Actions | ForEach-Object { $_.Execute }) -join '; '); $line=$exec+' '+((($t.Actions | ForEach-Object { $_.Arguments }) -join '; ')); $userArea=($path -notlike '\Microsoft\*'); $inWindows=($exec -like 'C:\Windows\*'); $badPath=($exec -match '(?i)AppData|\\Temp\\|\\Users\\Public|\\ProgramData\\|\\Desktop\\|\\Downloads\\'); $badName=($name -match '(?i)repair|fix|clean|guard|updat'); if($userArea -and (($badPath -and -not $inWindows) -or $badName)){ $susp += ($path+$name+'  ==>  '+$line) } }; if($susp.Count -eq 0){ Write-Host ''; Write-Host '[OK] 의심스러운 작업 스케줄러 항목 없음' -ForegroundColor Green } else { Write-Host ''; Write-Host '[주의] 삭제 검토 대상:' -ForegroundColor Yellow; $susp | ForEach-Object { Write-Host ('  - '+$_) } }; Write-Host ''; Write-Host '참고: 이 게임(gun game)은 작업 스케줄러를 쓰지 않습니다.' -ForegroundColor DarkGray"

echo.
set /p DEL=삭제할 항목 이름을 입력하세요 (Enter = 취소) :
if "%DEL%"=="" goto END
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Unregister-ScheduledTask -TaskName $env:DEL -Confirm:$false -ErrorAction Stop; Write-Host '[완료] 삭제: ' $env:DEL -ForegroundColor Green } catch { Write-Host '[실패] 해당 이름이 없거나 권한 부족: ' $env:DEL -ForegroundColor Red }"
:END
echo.
pause