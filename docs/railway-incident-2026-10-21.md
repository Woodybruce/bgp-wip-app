# Railway security incident, 21 October 2026: what to rotate

Railway disclosed on 21 October 2026 that an unauthorised party may have
read customer environment variables, and for some accounts the decrypted
values (https://blog.railway.com/p/security-disclosure-wednesday-october-21st).
Railway's instruction is to roll every environment variable and every
private registry credential, and to review the logs of the services
behind them. Builds were paused on the 21st and were coming back in
stages on the morning of the 22nd.

Both the BGP dashboard and the bgp.uk.com marketing service run on
Railway, and so does Pave. Treat every secret in those projects as
exposed until it is replaced.

The two Railway project tokens that were in this repo's CLAUDE.md no
longer resolve ("Project Token not found" on 22 October), so they are
dead. Mint a new one in Railway only when it is needed, and keep it in
the Claude environment settings, not in the repo.

## Order of work

Rotate at the provider first, then paste the new value into Railway,
then redeploy. Do the first group today.

### 1. Keys that reach money, mail or the database

| Variable | Where to rotate |
|---|---|
| `DATABASE_URL` | Railway Postgres: reset the password, or create a new user and drop the old |
| `SESSION_SECRET` | Any new random string; everyone is logged out once |
| `AZURE_CLIENT_SECRET`, `AZURE_SECRET_V2` | Entra admin centre → App registrations → the BGP app → Certificates & secrets. This is Graph: mail, SharePoint, Teams |
| `STRIPE_SECRET_KEY` | Stripe dashboard → Developers → API keys |
| `REVOLUT_JWT_PRIVATE_KEY`, `REVOLUT_WEBHOOK_SECRET` | Revolut Business API settings: new certificate and webhook |
| `XERO_CLIENT_SECRET`, `XERO_WEBHOOK_KEY` | Xero developer portal → the app |
| `ANTHROPIC_API_KEY`, `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | console.anthropic.com → API keys |
| `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_AI_API_KEY`, `AI_INTEGRATIONS_GEMINI_API_KEY`, `MOONSHOT_API_KEY` | Each provider's console |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Resend dashboard |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_TOKEN_V2`, `WHATSAPP_APP_SECRET`, `META_ACCESS_TOKEN` | Meta for Developers → the app |
| `AGENTMAIL_API_KEY` | AgentMail |
| `DEPLOY_WEBHOOK_SECRET`, `MCP_API_KEY`, `ADMIN_LOAD_SECRET` | New random strings; update whoever calls them |

### 2. Data and compliance providers

`COMPANIES_HOUSE_API_KEY`, `CREDITSAFE_API_KEY` and `CREDITSAFE_USERNAME`,
`COMPLY_ADVANTAGE_USERNAME` and `COMPLY_ADVANTAGE_PASSWORD`,
`VERIFF_*` (API key, secret, shared secret, private key),
`HMLR_API_KEY`, `LR_BG_USERNAME`, `LR_BG_PASSWORD` and the `LR_BG_*_B64`
Business Gateway certificates and keys, `PROPERTYDATA_API_KEY`,
`EDOZO_*` (client secret, password, access token), `EPC_API_KEY` and
`EPC_AUTH`, `OS_API_KEY`, `OS_PLACES_API_KEY`, `APOLLO_API_KEY`,
`ROCKETREACH_API_KEY`, `PIPNET_PASSWORD`, `AZURE_DOCUMENT_INTELLIGENCE_KEY`,
`GOOGLE_MAPS_API_KEY`, `VITE_GOOGLE_MAPS_API_KEY`, `GOOGLE_API_KEY`,
`GOOGLE_CSE_KEY`.

### 3. Everything else

`CANVA_CLIENT_SECRET`, `DROPBOX_APP_SECRET`, `EVERNOTE_CLIENT_SECRET`,
`EXA_API_KEY`, `FAL_KEY`, `IMAGINE_TOKEN`, `LOGO_DEV_SECRET_KEY`,
`LOGO_DEV_TOKEN`, `ONLYOFFICE_JWT_SECRET`, `PERPLEXITY_API_KEY`,
`PEXELS_API_KEY`, `PIXABAY_API_KEY`, `UNSPLASH_ACCESS_KEY`,
`RSSAPP_API_KEY` and `RSSAPP_API_SECRET`, `SCRAPERAPI_KEY`,
`STOOQ_API_KEY`, `TRL_TOKEN`, `VAPID_PRIVATE_KEY` (and the public key with
it; push subscriptions re-register), `WEBSHARE_PROXY_PASSWORD`,
`UK_PROXY_URL` if it carries a password, `RAILWAY_API_TOKEN` and
`RAILWAY_TOKEN` if set.

### Pave

Pave's Railway project holds the same families of secrets plus
`EXPERIAN_CLIENT_SECRET` and `EXPERIAN_PASSWORD`,
`GOOGLE_SERVICE_ACCOUNT_JSON`, `GREEN_STREET_API_TOKEN`,
`BRANDFETCH_API_KEY`, `GOOGLE_DRIVE_API_KEY`, and the operator logins
`OPERATOR_WINGSTOP_PASSWORD` and `OPERATOR_OURHOUSE_PASSWORD`. Same order.

### Not on Railway, so not in scope

`BGP_QA_TOKEN` lives in the Claude environment settings. The Porkbun API
keys were pasted in chat, not Railway; they were already on the list to
delete.

## After rotating

- Review the last two weeks of logs at Stripe, Revolut, Xero, Entra
  (sign-in and audit logs for the app registration), Anthropic and
  OpenAI usage, Resend sends, and Railway Postgres connections for
  anything from an unfamiliar address.
- Watch for Railway's email naming affected accounts.
- Redeploy both BGP services and Pave once every value is replaced.
