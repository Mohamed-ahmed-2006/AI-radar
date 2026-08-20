# AI-use disclosure

AI Radar was built with AI coding assistants (Cursor, Claude, Codex, and related agents) for implementation, tests, documentation, and review. Humans directed product scope, contracts, and freeze decisions.

## What AI helped with

- Application code, UI, and tests in this repository
- Documentation, including this submission package
- Wiring product surfaces to deterministic backends already specified in the repo

## What AI does not do at runtime

Ask AI Radar does **not** answer ecosystem questions from a language model's pretrained memory. A question is compiled into a typed plan. Temporal questions read collected change events. Decision questions run the model explorer and stack optimizer over observed prices and capabilities. If trusted evidence is missing, the product says so.

Bright Data Scraper Studio collectors extract published pages. Sentinel decides whether those payloads may become history. Those systems are deterministic code plus contracted extraction — not a chatbot.

## Honesty bounds

- Fixtures, the Sentinel in-memory simulator, and the temporal demo corpus are explicit opt-ins. Production leaves them unset.
- This disclosure does not claim a live healing success. That requires a production collector run with `evidence.isLive` and a recovered phase earned through the gate.
- Internal agent transcripts are not part of the submission.
