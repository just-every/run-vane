# Ask a question in plain English

Questions are off until the owner turns them on. The deployment also needs a model provider: set `AI_ENABLED=true`, `AI_MODEL`, `AI_API_KEY` and, for an OpenAI-compatible host other than OpenAI, `AI_BASE_URL` as Worker variables and secrets. Without them the Ask page says questions cannot be answered, and nothing leaves Vane.

The owner opens **Ask** in a site, chooses **On** and saves; the choice is audited and applies to that site only. Owners, administrators and team members with access to the site then type a question such as "Which campaigns brought paying customers from Texas this month?".

What leaves Vane is the question text, Vane's own list of metrics, breakdowns, filter operators and periods, the site's goal names, its time zone and today's date. No figure, visitor field, page value or identifier is sent. The model only chooses a Stats API query. Vane checks every field against the Stats API's vocabulary, refuses anything else without running it, runs the query itself and shows the answer with its exact metrics, breakdown, range, filters and `/api/v1/stats` query, so the figures equal the dashboard's and the Stats API's for that query.

An ambiguous question returns two to four choices; picking one runs its query without asking the model again. A question about people, causes or anything Vane does not collect is answered with a reason and no figures. Questions and answers are not stored. The audit history records who asked and when, and at most 60 questions an hour go to the provider for one site. Questions with an email address are refused.

Assistants use the same door through the MCP tool `ask_question` with a Stats API key for the site. A site archive does not carry the setting: the owner turns questions on again at the destination.
