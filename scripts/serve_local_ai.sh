#!/bin/sh
set -eu

exec llama-server -hf Qwen/Qwen3-VL-2B-Instruct-GGUF:Q4_K_M --alias seaguard-vision \
    --host 127.0.0.1 --port 18121 --ctx-size 4096 --parallel 1 --no-webui \
    --cors-origins http://127.0.0.1:18121
