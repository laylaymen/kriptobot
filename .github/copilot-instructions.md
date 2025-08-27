# Copilot Instructions for kriptobot

## Big Picture Architecture
- The project is a modular crypto trading bot with 5 main systems: Grafik Beyni (technical analysis), Otobilinç (psychological analysis), VIVO (signal routing), LIVIA (emotional filtering), and Denetim Asistanı (monitoring/feedback).
- Each system is implemented as a separate module under `kirpto bot sinyal/modules/` and communicates via function calls and (planned) event bus.
- The entry point is `kirpto bot sinyal/index.js`, which wires together modules and orchestrates data flow.
- Strategies are in `kirpto bot sinyal/strategies/`, with config in `config.json` and logic in files like `basicStop.js` and `volumeCompression.js`.
- Logging is handled in `kirpto bot sinyal/logs/logger.js`, with logs written to files in `logs/`.
- Environment variables (API keys, tokens) are encrypted in `.env` and decrypted at runtime using `modules/envSecure.js` and `modules/encryptEnv.js`.

## Developer Workflows
- No build step; run with `node index.js` from the `kirpto bot sinyal/` directory.
- Tests (where present) are in `modules/*.test.js`. Run with `node modules/<testfile>.js`.
- Debugging is typically done via log files in `logs/` and `console.log` statements.
- For NewsAPI or Binance integration issues, check `.env` and use curl to verify API keys.

## Project-Specific Patterns
- Each main system is a self-contained module, but a central orchestrator (`coreOrchestrator.js`, planned) will manage cross-system communication and event handling.
- Event-driven architecture is planned: modules will publish/subscribe to events via a shared bus (`modularEventStream.js`, planned).
- All sensitive data is accessed via encrypted environment variables; never hardcode secrets.
- Strategies and technical indicators are extensible—add new files to `strategies/` or `modules/` following existing patterns.
- Logging uses a custom logger; errors and events are written to separate log files.

## Integration Points
- External APIs: NewsAPI, Binance, Telegram (see `.env` and related modules).
- Telegram notifications are sent via `modules/sendTelegram.js`.
- News fetching and impact analysis via `modules/newsFetcher.js`.

## Examples
- To add a new strategy: create a file in `strategies/`, update `config.json`, and wire it in `index.js`.
- To add a new system: create a module in `modules/`, export its main function/class, and connect it in `index.js` or the orchestrator.

## Key Files/Directories
- `kirpto bot sinyal/index.js`: Main entry, system wiring
- `kirpto bot sinyal/modules/`: All core modules
- `kirpto bot sinyal/strategies/`: Trading strategies
- `kirpto bot sinyal/logs/`: Logging
- `.env`: Encrypted secrets

---
If any section is unclear or missing, please provide feedback so instructions can be improved iteratively.
"