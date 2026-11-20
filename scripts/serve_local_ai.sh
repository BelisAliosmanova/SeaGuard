#!/bin/sh
set -eu

if command -v llama-server >/dev/null 2>&1; then
    set -- llama-server
elif command -v llama >/dev/null 2>&1; then
    set -- llama serve
else
    echo 'llama.cpp is missing from PATH.' >&2
    exit 1
fi

exec "$@" -hf Qwen/Qwen3-VL-2B-Instruct-GGUF:Q4_K_M --alias seaguard-vision \
    --host 127.0.0.1 --port 18121 --ctx-size 8192 --parallel 1 --no-webui
