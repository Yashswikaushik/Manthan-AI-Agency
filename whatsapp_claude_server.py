"""
WhatsApp ↔ Claude bidirectional server.

Inbound:  Meta WhatsApp Business webhook → this server → Claude API → reply via WhatsApp
Outbound: POST /send  →  Claude composes or passes through message → WhatsApp
"""

import os
import hmac
import hashlib
import httpx
import logging
from fastapi import FastAPI, Request, HTTPException, BackgroundTasks
from fastapi.responses import PlainTextResponse
from dotenv import load_dotenv
import anthropic

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="Manthan Claude-WhatsApp Bridge")

# ── env vars ──────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY      = os.environ["ANTHROPIC_API_KEY"]
WA_PHONE_NUMBER_ID     = os.environ["WA_PHONE_NUMBER_ID"]      # Meta dashboard → Phone Number ID
WA_ACCESS_TOKEN        = os.environ["WA_ACCESS_TOKEN"]         # Meta System User token
WA_VERIFY_TOKEN        = os.environ.get("WA_VERIFY_TOKEN", "manthan_verify_2024")
FOUNDER_PHONE          = os.environ.get("FOUNDER_PHONE", "+918875566031")

claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

SYSTEM_PROMPT = """You are Claude, AI co-founder of Manthan AI Agency.
You are talking to the human founder directly on WhatsApp.
Be concise, smart, and action-oriented. When asked to do something, do it.
Keep replies under 400 words unless more detail is explicitly requested.
No markdown formatting — plain text only since this is WhatsApp."""

# ── WhatsApp API helpers ───────────────────────────────────────────────────────

WA_API_URL = f"https://graph.facebook.com/v19.0/{WA_PHONE_NUMBER_ID}/messages"

async def send_whatsapp(to: str, text: str, reply_to_id: str | None = None) -> dict:
    payload: dict = {
        "messaging_product": "whatsapp",
        "to": to.lstrip("+"),
        "type": "text",
        "text": {"body": text[:4096]},
    }
    if reply_to_id:
        payload["context"] = {"message_id": reply_to_id}

    async with httpx.AsyncClient() as client:
        r = await client.post(
            WA_API_URL,
            json=payload,
            headers={"Authorization": f"Bearer {WA_ACCESS_TOKEN}"},
            timeout=15,
        )
    r.raise_for_status()
    return r.json()


def ask_claude(user_message: str) -> str:
    response = claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )
    return response.content[0].text


# ── Webhook verification (GET) ─────────────────────────────────────────────────

@app.get("/webhook")
async def verify_webhook(request: Request):
    params = dict(request.query_params)
    mode      = params.get("hub.mode")
    token     = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")

    if mode == "subscribe" and token == WA_VERIFY_TOKEN:
        log.info("Webhook verified by Meta.")
        return PlainTextResponse(challenge)

    raise HTTPException(status_code=403, detail="Verification failed")


# ── Incoming WhatsApp message (POST) ──────────────────────────────────────────

@app.post("/webhook")
async def receive_webhook(request: Request, background: BackgroundTasks):
    body = await request.json()
    log.info("Webhook payload: %s", body)

    try:
        entry    = body["entry"][0]
        changes  = entry["changes"][0]["value"]
        messages = changes.get("messages")
        if not messages:
            return {"status": "no_message"}

        msg       = messages[0]
        from_num  = msg["from"]           # sender's phone (no +)
        msg_id    = msg["id"]
        msg_type  = msg.get("type", "")

        if msg_type == "text":
            user_text = msg["text"]["body"]
        elif msg_type == "interactive":
            user_text = (msg.get("interactive", {})
                         .get("button_reply", {})
                         .get("title", "[button tap]"))
        else:
            log.info("Unsupported message type: %s", msg_type)
            return {"status": "ignored"}

        log.info("Message from %s: %s", from_num, user_text)
        background.add_task(process_and_reply, from_num, user_text, msg_id)

    except (KeyError, IndexError) as exc:
        log.warning("Unexpected payload shape: %s", exc)

    return {"status": "ok"}


async def process_and_reply(from_num: str, user_text: str, msg_id: str):
    try:
        reply = ask_claude(user_text)
        await send_whatsapp(from_num, reply, reply_to_id=msg_id)
        log.info("Replied to %s", from_num)
    except Exception as exc:
        log.error("Failed to process/reply: %s", exc)


# ── Outbound endpoint (Claude → founder) ──────────────────────────────────────

@app.post("/send")
async def send_to_founder(request: Request):
    """
    POST /send  {"message": "your text"}
    Claude (or any internal caller) uses this to proactively message the founder.
    """
    data = await request.json()
    text = data.get("message", "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="'message' field required")

    result = await send_whatsapp(FOUNDER_PHONE, text)
    return {"status": "sent", "result": result}


# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "model": "claude-sonnet-4-6"}
