#!/bin/bash
# LAUNCH_ENV_TO_SET.sh — env vars Tradesly needs for Monday launch.
#
# DO NOT JUST RUN THIS. Open it, fill in the {{placeholders}} with real
# values, then either:
#   (a) Copy the export lines into ~/.zshrc and `source ~/.zshrc`, OR
#   (b) Run this file as-is once values are in, then `source` it.
#
# Tradesly's hourly cron inherits user-session env via launchctl, so
# anything in ~/.zshrc / ~/.zshenv will be available to the qualifier,
# inbox_watcher, router, etc.

# ─── Telegram (capture alerts to phone) ────────────────────────────────
# Create the bot once via @BotFather on Telegram, get a token. Get your
# chat id by messaging @userinfobot. Then:
export TG_BOT_TOKEN="{{TELEGRAM_BOT_TOKEN}}"   # e.g. 7123456789:AAH...
export TG_CHAT_ID="{{TELEGRAM_CHAT_ID}}"        # e.g. 1522022288

# ─── Mailer cap (bump for launch week) ─────────────────────────────────
# Default in tradesly_mailer.py is 20/day. Audit recommends 30 for launch.
export TRADESLY_DAILY_CAP=30

# ─── Cloudflare (only needed once for `wrangler login`) ────────────────
# `wrangler login` writes its own token to ~/.wrangler — you do NOT need
# to export CLOUDFLARE_API_TOKEN unless running wrangler in a non-interactive
# context (CI, scheduled deploys). Leaving these commented is fine.
# export CF_ACCOUNT_ID="{{CF_ACCOUNT_ID}}"
# export CF_API_TOKEN="{{CF_API_TOKEN}}"

# ─── Kill switches (UNCOMMENT to halt operations) ──────────────────────
# export TRADESLY_AUTOSEND=off       # blocks ALL outgoing mail
# export TRADESLY_AUTODELIVER=off    # blocks just the lead-delivery step

# ─── Echo state (sanity check) ─────────────────────────────────────────
echo "Tradesly env applied:"
echo "  TG_BOT_TOKEN:        $([ -n "${TG_BOT_TOKEN:-}" ] && echo SET || echo UNSET)"
echo "  TG_CHAT_ID:          $([ -n "${TG_CHAT_ID:-}" ] && echo SET || echo UNSET)"
echo "  TRADESLY_DAILY_CAP:  ${TRADESLY_DAILY_CAP:-(unset, defaulting to 20)}"
echo "  TRADESLY_AUTOSEND:   ${TRADESLY_AUTOSEND:-on}"
echo "  TRADESLY_AUTODELIVER: ${TRADESLY_AUTODELIVER:-on}"
