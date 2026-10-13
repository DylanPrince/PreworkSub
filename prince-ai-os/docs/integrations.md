# Integrations

Status shown in the UI is derived from server configuration and live checks only. A name on the
Integrations page never implies a connection.

| Integration               | Status in this build                          | Auth                                      | Cost                                                       | Notes                                                                                                                      |
| ------------------------- | --------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Anthropic Claude API      | Implemented; **requires `ANTHROPIC_API_KEY`** | API key in server env                     | Usage-billed per token (see `docs/technical-decisions.md`) | "Test connection" calls `models.retrieve` (metadata only, no tokens). Runs fail with `not_configured` until the key is set |
| Shopify                   | Not connected (M6)                            | OAuth app, Admin API scopes               | Free API; store plan required                              | Orders, inventory, refunds only after a real, tested adapter. Refunds/purchases always need approval                       |
| Meta (Facebook/Instagram) | Not connected (M6)                            | Meta app + App Review, system user tokens | Ad spend billed by Meta                                    | Launching ads, raising budgets, publishing, deleting campaigns need approval                                               |
| Google / YouTube          | Not connected (M6)                            | OAuth, YouTube Data API quotas            | Free within quota                                          | Upload requires verified OAuth app                                                                                         |
| TikTok                    | Not connected (M6)                            | Developer app approval                    | –                                                          | Content Posting API access is gated                                                                                        |
| GitHub                    | Not connected (M6)                            | GitHub App                                | Free                                                       | Production deploys / destructive ops need approval                                                                         |
| Stripe                    | Not connected (M6)                            | Restricted read-only key                  | –                                                          | Revenue import only; the system never initiates payments                                                                   |
| Email provider            | Not chosen                                    | –                                         | –                                                          | –                                                                                                                          |
| S3-compatible storage     | Not connected                                 | Access key                                | Usage-billed                                               | Local storage first                                                                                                        |

## Requires your action (none done yet)

- **Anthropic API key**: create one in the Claude Console and set `ANTHROPIC_API_KEY` in the server
  environment (never commit it, never paste it into chat). Running agents then incurs charges, capped
  by `AI_DAILY_BUDGET_USD` / `AI_MONTHLY_BUDGET_USD`.
- Any third-party account above requires your approval before it is created or connected.
