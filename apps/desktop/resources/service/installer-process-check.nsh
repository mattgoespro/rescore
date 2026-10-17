!ifndef RESCORE_EXACT_PROCESS_CHECK
!define RESCORE_EXACT_PROCESS_CHECK
!include getProcessInfo.nsh
Var pid

; Override only process selection; keep electron-builder's surrounding close UI.
!macroundef FIND_PROCESS
!macro FIND_PROCESS _FILE _RETURN
  ${if} $IsPowerShellAvailable == 0
    nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "if (@(Get-CimInstance Win32_Process | ? {$$_.ExecutablePath -and $$_.ExecutablePath.Equals($$env:RESCORE_INSTALL_EXE, [StringComparison]::OrdinalIgnoreCase)}).Count -gt 0) { exit 0 } else { exit 1 }"`
    Pop ${_RETURN}
  ${else}
    !ifdef INSTALL_MODE_PER_ALL_USERS
      nsExec::Exec `"$CmdPath" /C tasklist /FI "IMAGENAME eq ${_FILE}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${_FILE}\""`
    !else
      nsExec::Exec `"$CmdPath" /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${_FILE}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${_FILE}\""`
    !endif
    Pop ${_RETURN}
  ${endIf}
!macroend

!macroundef KILL_PROCESS
!macro KILL_PROCESS _FILE _FORCE
  Push $0
  ${if} ${_FORCE} == 1
    ${if} $IsPowerShellAvailable == 0
      StrCpy $0 "-Force"
    ${else}
      StrCpy $0 "/F"
    ${endIf}
  ${else}
    StrCpy $0 ""
  ${endIf}
  ${if} $IsPowerShellAvailable == 0
    nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | ? {$$_.ExecutablePath -and $$_.ExecutablePath.Equals($$env:RESCORE_INSTALL_EXE, [StringComparison]::OrdinalIgnoreCase)} | % {Stop-Process -Id $$_.ProcessId $0}"`
  ${else}
    !ifdef INSTALL_MODE_PER_ALL_USERS
      nsExec::Exec `taskkill $0 /IM "${_FILE}" /FI "PID ne $pid"`
    !else
      nsExec::Exec `"$CmdPath" /C taskkill $0 /IM "${_FILE}" /FI "PID ne $pid" /FI "USERNAME eq %USERNAME%"`
    !endif
  ${endIf}
  Pop $0
!macroend
!endif
