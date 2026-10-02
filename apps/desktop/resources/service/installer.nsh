!macro customInstall
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\service\maintenance.ps1" -Action Install'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "The required catalogue service could not be registered or updated. Setup could not complete. Approve administrator access and run this installer again to repair the installation."
    SetErrorLevel 1
    Abort
  ${EndIf}
!macroend

!macro customUnInit
  ; Updates replace the desktop files, then upgrade the independent service above.
  ${IfNot} ${isUpdated}
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\service\maintenance.ps1" -Action RemoveAll'
    Pop $0
    Pop $1
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "The catalogue service could not be removed. Uninstall has stopped to preserve your catalogue. Approve administrator access and try again."
      Abort
    ${EndIf}
  ${EndIf}
!macroend
