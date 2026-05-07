#!/usr/bin/env bash
# Start the Claude-WhatsApp bridge + expose it via ngrok for webhook testing
set -euo pipefail

PORT=8000

# ── check .env ────────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "[ERROR] .env not found. Copy .env.example → .env and fill in the values."
  exit 1
fi

# ── install ngrok if missing ──────────────────────────────────────────────────
if ! command -v ngrok &>/dev/null; then
  echo "[INFO] Installing ngrok..."
  curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
  echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
  sudo apt-get update -qq && sudo apt-get install -y ngrok
fi

# ── start server in background ────────────────────────────────────────────────
echo "[INFO] Starting FastAPI server on port $PORT..."
uvicorn whatsapp_claude_server:app --host 0.0.0.0 --port $PORT &
SERVER_PID=$!

sleep 2

# ── start ngrok tunnel ────────────────────────────────────────────────────────
echo "[INFO] Starting ngrok tunnel..."
ngrok http $PORT --log stdout &
NGROK_PID=$!

sleep 3

# ── print the public URL ──────────────────────────────────────────────────────
PUBLIC_URL=$(curl -s http://localhost:4040/api/tunnels | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data['tunnels'][0]['public_url'])
" 2>/dev/null || echo "Could not fetch ngrok URL — check http://localhost:4040")

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  Server:       http://localhost:$PORT"
echo "  Public URL:   $PUBLIC_URL"
echo "  Webhook URL:  $PUBLIC_URL/webhook"
echo ""
echo "  → Paste the webhook URL into Meta App Dashboard:"
echo "    developers.facebook.com → your app → WhatsApp → Configuration"
echo "    Callback URL : $PUBLIC_URL/webhook"
echo "    Verify token : manthan_verify_2024  (or your WA_VERIFY_TOKEN)"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Press Ctrl+C to stop."

trap "kill $SERVER_PID $NGROK_PID 2>/dev/null; echo 'Stopped.'" INT TERM
wait
