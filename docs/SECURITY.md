# GRVT-Binance Grid Bots — Security Notes

## Exchange-Specific Security Considerations

### GRVT

- **Authentication**: EIP-712 typed data signatures. The private key IS the credential — treat it like a hot wallet private key.
- **Sub-accounts**: GRVT supports multiple sub-accounts per user. Each sub-account has its own margin/position隔离.
- **Chain ID**: Testnet=326, Mainnet=325. Always verify the chainId in the EIP-712 domain to prevent replay attacks.
- **Rate limits**: GRVT edge endpoints have per-user rate limits. The grid engine batches WebSocket subscriptions to stay within limits.

### Binance

- **Authentication**: HMAC-SHA256. API key + secret are static — rotate them regularly.
- **API Key Permissions**: Binance API keys can be restricted to read-only, spot trading, or futures trading. Grid bots require **futures trading** permission.
- **IP Whitelisting**: Recommended to whitelist your server IP on the Binance API key. Without IP whitelist, any attacker with the API key can trade.
- **Testnet vs Mainnet**: Testnet API keys are separate from mainnet. Do NOT use testnet keys in production.
- **WebSocket Authentication**: Binance requires a signed "listen key" for account update streams. The `BinanceClient` must manage listen key lifecycle (ping every 30min to keep alive).

## General Security Practices

1. **Never commit .env** — contains API keys and secrets
2. **API key rotation**: Rotate Binance API keys every 90 days. Rotate GRVT private keys if compromised.
3. **IP whitelisting**: Enable on Binance API keys
4. **Read-only keys where possible**: The notifier only needs read permissions
5. **Dashboard API key**: Set a strong random string. It protects all bot data.
6. **Telegram bot token**: Keep private. Anyone with the token can send messages to your Telegram chat.
7. **Paper mode first**: Always test new bots in paper/testnet mode before going live.

## Bot Safety Features

Each bot has configurable safeguards (see `docs/ARCHITECTURE.md`):
- **Stop-loss (SL)**: Closes position when loss exceeds `sl_pct` of investment
- **Take-profit (TP)**: Closes position when profit exceeds `tp_pct` of investment
- **Liquidation proximity safeguard**: Auto-pause/close when mark price approaches liquidation
- **Max drawdown alert**: Telegram alert when drawdown exceeds threshold

## Data Privacy

- All data stored locally in `data/bot.db` (SQLite)
- No data sent to external servers except:
  - Exchange APIs (GRVT/Binance) for trading
  - Telegram API for notifications
- WebSocket connections go directly to exchange endpoints
- Database is encrypted at rest if filesystem-level encryption is enabled

## Incident Response

If your API key is compromised:
1. **Binance**: Go to Binance API Management, delete the compromised key, create a new one
2. **GRVT**: Rotate the Ethereum private key immediately
3. **All bots**: Use the dashboard to pause all running bots immediately
4. **Rotate DASHBOARD_API_KEY** in .env
5. Restart the bot container: `docker compose restart bot`

If Telegram token is leaked:
1. Create a new bot via @BotFather
2. Update `TELEGRAM_BOT_TOKEN` in .env
3. Restart notifier: `docker compose restart notifier`