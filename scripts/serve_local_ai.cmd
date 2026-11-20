@echo off
setlocal
set "SEAGUARD_LLAMA_EXE=%~1"
if defined SEAGUARD_LLAMA_EXE goto launch

for /f "delims=" %%A in ('where llama-server.exe 2^>nul') do if not defined SEAGUARD_LLAMA_EXE set "SEAGUARD_LLAMA_EXE=%%A"
if defined SEAGUARD_LLAMA_EXE goto launch
for /f "delims=" %%A in ('where llama.exe 2^>nul') do if not defined SEAGUARD_LLAMA_EXE set "SEAGUARD_LLAMA_EXE=%%A"
if defined SEAGUARD_LLAMA_EXE goto launch

echo llama.cpp was not found. Run winget install llama.cpp, then open a new terminal.
exit /b 1

:launch
set "SEAGUARD_LLAMA_SUBCOMMAND="
for %%A in ("%SEAGUARD_LLAMA_EXE%") do if /i "%%~nxA"=="llama.exe" set "SEAGUARD_LLAMA_SUBCOMMAND=serve"
echo The first launch downloads the model and its visual projector. Keep this window open.
echo SeaGuard vision is ready when http://127.0.0.1:18121/health reports ok.
"%SEAGUARD_LLAMA_EXE%" %SEAGUARD_LLAMA_SUBCOMMAND% -hf Qwen/Qwen3-VL-2B-Instruct-GGUF:Q4_K_M --alias seaguard-vision --host 127.0.0.1 --port 18121 --ctx-size 8192 --parallel 1 --no-webui
exit /b %errorlevel%
