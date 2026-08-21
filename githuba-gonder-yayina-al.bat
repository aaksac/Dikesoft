@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

title Dikesoft - GitHub Yayin Deposuna Gonder

set "REPO_URL=https://github.com/aaksac/Dikesoft.git"
set "BRANCH=main"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss" 2^>nul') do set "TS=%%i"
if not defined TS set "TS=%random%%random%"
set "REPORT_FILE=%CD%\github-cmd-raporu-%TS%.txt"

> "%REPORT_FILE%" echo Dikesoft GitHub yayin raporu
>> "%REPORT_FILE%" echo Tarih/Saat: %date% %time%
>> "%REPORT_FILE%" echo Klasor: %CD%
>> "%REPORT_FILE%" echo Repo: %REPO_URL%
>> "%REPORT_FILE%" echo Branch: %BRANCH%
>> "%REPORT_FILE%" echo.

echo ==========================================
echo  Dikesoft - GitHub Yayin Deposuna Gonder
echo ==========================================
echo.
echo Rapor dosyasi:
echo %REPORT_FILE%
echo.

if not exist "app.html" (
  echo HATA: Bu klasorde app.html bulunamadi.
  echo Bu BAT dosyasini Dikesoft-main ana klasorunde calistirin.
  >> "%REPORT_FILE%" echo [HATA] app.html bulunamadi. Yanlis klasor olabilir.
  pause
  exit /b 1
)

if not exist "js" (
  echo HATA: Bu klasorde js klasoru bulunamadi.
  echo Bu BAT dosyasini Dikesoft-main ana klasorunde calistirin.
  >> "%REPORT_FILE%" echo [HATA] js klasoru bulunamadi. Yanlis klasor olabilir.
  pause
  exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
  echo HATA: Git bulunamadi. Once Git for Windows kurulmali.
  >> "%REPORT_FILE%" echo [HATA] Git bulunamadi.
  pause
  exit /b 1
)

if not exist ".git" (
  echo Bu klasor Git deposu degil. Git baslatiliyor...
  >> "%REPORT_FILE%" echo Git deposu degil. git init calistiriliyor.
  git init >> "%REPORT_FILE%" 2>&1
  if errorlevel 1 goto :git_error
)

if not exist ".git\info" mkdir ".git\info" >nul 2>nul
if not exist ".git\info\exclude" type nul > ".git\info\exclude"
findstr /C:"github-cmd-raporu-*.txt" ".git\info\exclude" >nul 2>nul
if errorlevel 1 echo github-cmd-raporu-*.txt>> ".git\info\exclude"
findstr /C:"github-yayin-raporu-*.txt" ".git\info\exclude" >nul 2>nul
if errorlevel 1 echo github-yayin-raporu-*.txt>> ".git\info\exclude"

echo Yayin deposu: %REPO_URL%
echo Branch      : %BRANCH%
echo.
>> "%REPORT_FILE%" echo Git versiyonu:
git --version >> "%REPORT_FILE%" 2>&1
>> "%REPORT_FILE%" echo.

echo Once yarim kalan rebase/merge islemleri temizleniyor...
>> "%REPORT_FILE%" echo Yarim kalan rebase/merge temizleniyor.
git rebase --abort >> "%REPORT_FILE%" 2>&1
git merge --abort >> "%REPORT_FILE%" 2>&1
if exist ".git\rebase-merge" rmdir /s /q ".git\rebase-merge"
if exist ".git\rebase-apply" rmdir /s /q ".git\rebase-apply"
if exist ".git\MERGE_HEAD" del /f /q ".git\MERGE_HEAD"
echo Temizleme tamam.
echo.

git remote get-url origin >nul 2>nul
if errorlevel 1 (
  git remote add origin "%REPO_URL%" >> "%REPORT_FILE%" 2>&1
) else (
  git remote set-url origin "%REPO_URL%" >> "%REPORT_FILE%" 2>&1
)
if errorlevel 1 goto :git_error

echo Branch ayarlaniyor...
>> "%REPORT_FILE%" echo Branch ayarlaniyor.
git checkout %BRANCH% >> "%REPORT_FILE%" 2>&1
if errorlevel 1 (
  git checkout -b %BRANCH% >> "%REPORT_FILE%" 2>&1
  if errorlevel 1 goto :git_error
)

echo.
echo Degisen dosyalar hazirlaniyor...
>> "%REPORT_FILE%" echo Degisen dosyalar hazirlaniyor.
git add -A >> "%REPORT_FILE%" 2>&1
if errorlevel 1 goto :git_error

>> "%REPORT_FILE%" echo.
>> "%REPORT_FILE%" echo Git status:
git status --short >> "%REPORT_FILE%" 2>&1

git diff --cached --quiet
if errorlevel 1 (
  git commit -m "Dikesoft musteri analitigi yayin guncellemesi %date% %time%" >> "%REPORT_FILE%" 2>&1
  if errorlevel 1 goto :git_error
) else (
  echo Commit edilecek yeni degisiklik yok. Mevcut yerel commit yayin deposuna basilacak.
  >> "%REPORT_FILE%" echo Commit edilecek yeni degisiklik yok.
)

echo.
echo Uzak depo bilgisi aliniyor; dosya birlestirme yapilmayacak...
>> "%REPORT_FILE%" echo Uzak depo bilgisi aliniyor.
git fetch origin %BRANCH% >> "%REPORT_FILE%" 2>&1

echo.
echo DIKKAT: Bu islem GitHub'daki %BRANCH% branch'ini bu klasordeki hal ile gunceller.
echo Normal pull/rebase yapilmayacak; add/add cakismasi bu yuzden tekrar olusmaz.
echo.
set /p ONAY=Devam edip GitHub yayin deposuna basilsin mi? ^(E/H^): 
if /I not "%ONAY%"=="E" (
  echo Islem iptal edildi.
  >> "%REPORT_FILE%" echo Islem kullanici tarafindan iptal edildi.
  pause
  exit /b 0
)

echo.
echo GitHub'a gonderiliyor...
>> "%REPORT_FILE%" echo GitHub'a gonderiliyor.
git push --force-with-lease origin %BRANCH% >> "%REPORT_FILE%" 2>&1
if errorlevel 1 (
  echo.
  echo force-with-lease reddetti veya push basarisiz oldu.
  echo Bunun nedeni genellikle GitHub'da sizden sonra yeni degisiklik yapilmasidir.
  echo Eminseniz asagidaki komutu elle calistirabilirsiniz:
  echo git push --force origin %BRANCH%
  >> "%REPORT_FILE%" echo [HATA] Push basarisiz oldu. force-with-lease reddetmis olabilir.
  pause
  exit /b 1
)

echo.
echo TAMAM: Bu klasordeki dosyalar GitHub yayin deposuna gonderildi.
echo Repo: %REPO_URL%
echo Branch: %BRANCH%
echo Rapor: %REPORT_FILE%
>> "%REPORT_FILE%" echo.
>> "%REPORT_FILE%" echo [TAMAM] Push basarili.
pause
exit /b 0

:git_error
echo.
echo HATA: Git islemi basarisiz oldu.
echo Rapor: %REPORT_FILE%
>> "%REPORT_FILE%" echo.
>> "%REPORT_FILE%" echo [HATA] Git islemi basarisiz oldu.
>> "%REPORT_FILE%" echo Git status:
git status --short >> "%REPORT_FILE%" 2>&1
pause
exit /b 1
