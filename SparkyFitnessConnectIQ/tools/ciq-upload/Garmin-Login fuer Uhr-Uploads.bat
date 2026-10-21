@echo off
rem Normal Edge with its own profile, no remote control: Garmin's sign-in
rem refuses automated browsers. Sign in, then close the window.
start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --user-data-dir="%USERPROFILE%\sparky-ciq-upload\profile-edge" --no-first-run --no-default-browser-check https://apps-developer.garmin.com/
