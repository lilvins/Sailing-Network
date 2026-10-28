@echo off
cd /d "%~dp0"
echo [%date% %time%] seed:cards > update-cards.log
call npm run seed:cards >> update-cards.log 2>&1
echo SEED_EXIT=%errorlevel% >> update-cards.log
echo [%date% %time%] art >> update-cards.log
call npm run art >> update-cards.log 2>&1
echo ART_EXIT=%errorlevel% >> update-cards.log
echo DONE >> update-cards.log
exit
