!include nsDialogs.nsh
!include FileFunc.nsh
!define RESCORE_PROCESS_CHECK_INCLUDE "${__FILEDIR__}\installer-process-check.nsh"

!macro customCheckAppRunning
  ; Keep electron-builder's prompts/retry handling, but identify the desktop
  ; executable exactly. A folder prefix also matches Rescore Catalogue.
  System::Call 'kernel32::SetEnvironmentVariable(t "RESCORE_INSTALL_EXE", t "$INSTDIR\${APP_EXECUTABLE_FILENAME}")'
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  System::Call 'kernel32::SetEnvironmentVariable(t "RESCORE_INSTALL_EXE", p 0)'
!macroend

!macro customHeader
!ifmacrodef FIND_PROCESS
  !include "${RESCORE_PROCESS_CHECK_INCLUDE}"
!endif
!ifdef BUILD_UNINSTALLER
  ; Same as electron-builder's un.atomicRMDir, except the Catalogue directory stays.
  ; App updates move the rest of $INSTDIR aside; the service program lives inside it.
  Function un.atomicRMDirKeepCatalogue
    Exch $R0
    Push $R1
    Push $R2
    Push $R3

    StrCpy $R3 "$INSTDIR$R0\*.*"
    FindFirst $R1 $R2 $R3

    loop:
      StrCmp $R2 "" break

      StrCmp $R2 "." continue
      StrCmp $R2 ".." continue
      StrCmp $R0 "" 0 scanEntry
      StrCmp $R2 "Catalogue" continue
      scanEntry:

      IfFileExists "$INSTDIR$R0\$R2\*.*" isDir isNotDir

      isDir:
        CreateDirectory "$PLUGINSDIR\old-install$R0\$R2"

        Push "$R0\$R2"
        Call un.atomicRMDirKeepCatalogue
        Pop $R3

        StrCmp $R3 "0" continue
        Goto done

      isNotDir:
        ClearErrors
        Rename "$INSTDIR$R0\$R2" "$PLUGINSDIR\old-install$R0\$R2"

        StrCmp "$R0\$R2" "${UNINSTALL_FILENAME}" 0 +2
        ClearErrors

        IfErrors 0 +3
        StrCpy $R3 "$INSTDIR$R0\$R2"
        Goto done

      continue:
        FindNext $R1 $R2
        Goto loop

    break:
      StrCpy $R3 0

    done:
      FindClose $R1

      StrCpy $R0 $R3

      Pop $R3
      Pop $R2
      Pop $R1
      Exch $R0
  FunctionEnd

  Function un.removeInstallExceptCatalogue
    Push $R1
    Push $R2
    FindFirst $R1 $R2 "$INSTDIR\*.*"
      search:
        StrCmp $R2 "" none
        StrCmp $R2 "." next
        StrCmp $R2 ".." next
        StrCmp $R2 "Catalogue" next
        ClearErrors
        IfFileExists "$INSTDIR\$R2\*.*" 0 isFile
          RMDir /r "$INSTDIR\$R2"
          Goto checkResult
        isFile:
          Delete "$INSTDIR\$R2"
        checkResult:
          IfErrors 0 next
          FindClose $R1
          SetErrorLevel 1
          Abort "A Rescore file could not be removed. Close applications using Rescore and try again."
      next:
        FindNext $R1 $R2
        Goto search

    none:
      FindClose $R1
      Pop $R2
      Pop $R1
  FunctionEnd
!endif
!macroend

!macro customRemoveFiles
  ${if} ${isUpdated}
    CreateDirectory "$PLUGINSDIR\old-install"

    Push ""
    Call un.atomicRMDirKeepCatalogue
    Pop $R0

    ${if} $R0 != 0
      DetailPrint "File is busy, aborting: $R0"

      Push ""
      Call un.restoreFiles
      Pop $R0

      SetErrorLevel 1
      Abort `Can't rename "$INSTDIR" to "$PLUGINSDIR\old-install".`
    ${endif}

    SetOutPath $TEMP
    Call un.removeInstallExceptCatalogue
  ${else}
    SetOutPath $TEMP
    ClearErrors
    RMDir /r $INSTDIR
    ${If} ${Errors}
      SetErrorLevel 1
      Abort "Rescore files could not be removed. Close applications using Rescore and try again."
    ${EndIf}
  ${endif}
!macroend

!macro customWelcomePage
  !insertmacro skipPageIfUpdated
  !define MUI_WELCOMEPAGE_TITLE "Welcome to the Rescore Setup Wizard"
  !define MUI_WELCOMEPAGE_TEXT "This wizard installs Rescore for everyone who uses this computer.$\r$\n$\r$\nSetup registers the Rescore catalogue service and leaves it stopped. The service starts when you first open Rescore.$\r$\n$\r$\nSetup does not open Rescore unless you choose that on the last page."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  ; StartApp declares a global variable, so it cannot be inserted inside this function.
  Function StartRescore
    ${If} ${isUpdated}
      StrCpy $1 "--updated"
    ${Else}
      StrCpy $1 ""
    ${EndIf}
    ; Launch the installed executable directly; an old shortcut is not authoritative.
    ${StdUtils.ExecShellAsUser} $0 "$INSTDIR\Rescore.exe" "open" "$1"
  FunctionEnd

  !define MUI_FINISHPAGE_TITLE "Rescore Setup is complete"
  !define MUI_FINISHPAGE_TEXT "Rescore is installed for everyone who uses this computer. A new catalogue service stays stopped until you open Rescore. An already active catalogue continues running after an update."
  !define MUI_FINISHPAGE_TEXT_LARGE
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_NOTCHECKED
  !define MUI_FINISHPAGE_RUN_TEXT "Launch Rescore"
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartRescore"
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customInstall
  ClearErrors
  ExecWait '"$INSTDIR\resources\service\Rescore Maintenance.exe" --action Install' $0
  ${If} ${Errors}
    StrCpy $0 1
  ${EndIf}
  ${If} $0 != 0
    DetailPrint "Catalogue setup failed (exit $0)."
    MessageBox MB_OK|MB_ICONSTOP "The required catalogue service could not be registered or updated (exit $0). Setup stopped. Approve any administrator prompt and try again. Details, when available: %ProgramData%\Rescore\last-error.txt."
    SetErrorLevel 1
    Abort
  ${EndIf}
  ${GetParent} "$newStartMenuLink" $2
  CreateShortCut "$2\Rescore Logs.lnk" "$INSTDIR\Rescore Logs.exe"
!macroend

!macro customUnInit
  StrCpy $rescoreDeleteCatalogue ${BST_UNCHECKED}
  ; Silent removal preserves data unless deletion is explicitly requested.
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "--delete-catalogue" $1
  ${IfNot} ${Errors}
    ${IfNot} ${isUpdated}
      StrCpy $rescoreDeleteCatalogue ${BST_CHECKED}
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnWelcomePage
  Var /GLOBAL rescoreDeleteCatalogue
  Var /GLOBAL rescoreCatalogueCheckbox
  !insertmacro MUI_UNPAGE_WELCOME
  UninstPage custom un.RescoreCataloguePage un.RescoreCataloguePageLeave

  Function un.RescoreCataloguePage
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "Catalogue data" "Choose whether to keep your catalogue for a reinstall."
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 45u "The catalogue is shared by all Windows accounts on this computer. Keeping it preserves your ratings, library, downloaded IMDb data, and media cache."
    Pop $0
    ${NSD_CreateCheckbox} 0 55u 100% 20u "Delete catalogue data for all users"
    Pop $rescoreCatalogueCheckbox
    ${NSD_SetState} $rescoreCatalogueCheckbox $rescoreDeleteCatalogue
    ${NSD_CreateLabel} 0 85u 100% 40u "Deletion also removes retained catalogue recovery copies. App settings and logs are kept. Leave this unchecked to reinstall without losing your catalogue."
    Pop $0
    nsDialogs::Show
  FunctionEnd

  Function un.RescoreCataloguePageLeave
    ${NSD_GetState} $rescoreCatalogueCheckbox $rescoreDeleteCatalogue
  FunctionEnd
!macroend

!macro customUnInstall
  ; Removal happens on the progress page, after the user commits to uninstall.
  ${IfNot} ${isUpdated}
    StrCpy $2 ""
    ${If} $rescoreDeleteCatalogue == ${BST_CHECKED}
      StrCpy $2 " --delete-catalogue"
    ${EndIf}
    ClearErrors
    ExecWait '"$INSTDIR\resources\service\Rescore Maintenance.exe" --action RemoveAll$2' $0
    ${If} ${Errors}
      StrCpy $0 1
    ${EndIf}
    ${If} $0 != 0
      DetailPrint "Catalogue removal failed (exit $0)."
      MessageBox MB_OK|MB_ICONSTOP "The catalogue service could not be removed (exit $0). Uninstall stopped to preserve your catalogue. Approve any administrator prompt and try again. Details, when available: %ProgramData%\Rescore\last-error.txt."
      SetErrorLevel 1
      Abort
    ${EndIf}
  ${EndIf}
  ${IfNot} ${isUpdated}
    ${GetParent} "$oldStartMenuLink" $2
    Delete "$2\Rescore Logs.lnk"
  ${EndIf}
!macroend
