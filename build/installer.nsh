; Updates from inside Alva run this installer with --updated and without /S, so the person sees the
; installation progress. Only that page shows: the other ones would wait for clicks.

; Same mode (current user / all users) as the installation being updated, without asking.
!macro customInstallMode
  ${if} ${isUpdated}
    ${if} $hasPerUserInstallation == "1"
      StrCpy $isForceCurrentInstall "1"
    ${elseif} $hasPerMachineInstallation == "1"
      StrCpy $isForceMachineInstall "1"
    ${endif}
  ${endif}
!macroend

; The default finish page (with "Run Alva"), except after an update: then Alva opens right away.
!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function skipFinishPageIfUpdated
    ${if} ${isUpdated}
      ; Otherwise the app window opens behind the installer's.
      HideWindow
      Call StartApp
      Abort
    ${endif}
  FunctionEnd

  !define MUI_PAGE_CUSTOMFUNCTION_PRE skipFinishPageIfUpdated
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !insertmacro MUI_PAGE_FINISH
!macroend
