@echo off
REM Sailing Network — daily refresh of public/data/popular.json from egmanevents.
REM Registered as a Windows Scheduled Task (TN: SailingNetwork-ScrapeEgman).
cd /d "C:\Users\vinci\Music\Sailing Network"
echo. >> "%TEMP%\sn-scrape.log"
echo ===== %DATE% %TIME% ===== >> "%TEMP%\sn-scrape.log"
REM Ensure the matching Playwright browser exists in this (real) environment.
REM Idempotent: downloads only the first time, then it's cached.
call npx --yes playwright install chromium chromium-headless-shell >> "%TEMP%\sn-scrape.log" 2>&1
call npm run scrape >> "%TEMP%\sn-scrape.log" 2>&1
