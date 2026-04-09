# OpenClaw BGP Dashboard Plugin

Connect your OpenClaw AI assistant to the BGP property management dashboard. Query properties, deals, contacts, diary, news, and chat with ChatBGP — all from WhatsApp, Telegram, or any messaging channel connected to OpenClaw.

## Setup

### 1. Install OpenClaw (if not already)

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

### 2. Copy this plugin to your OpenClaw extensions folder

```bash
cp -r openclaw-bgp-plugin ~/.openclaw/extensions/bgp-dashboard
```

### 3. Configure the plugin

Edit your OpenClaw config (`~/.openclaw/config.yaml` or via the Control UI) and add:

```yaml
plugins:
  entries:
    bgp-dashboard:
      enabled: true
      config:
        dashboardUrl: "https://your-bgp-dashboard.replit.app"
        username: "woody"
        password: "your-password"
```

Replace the URL with your actual BGP Dashboard deployment URL.

### 4. Restart OpenClaw

```bash
openclaw gateway restart
```

## Available Tools

Once installed, you can ask OpenClaw things like:

- "Show me BGP properties in Mayfair"
- "What deals are we working on?"
- "Find contacts at Grosvenor"
- "What's in the team diary today?"
- "Get me the latest property news for the Investment team"
- "Ask ChatBGP about current yields in Belgravia"
- "Show me tenant requirements for retail spaces"
- "Find comparable transactions for office properties"

## Tools Reference

| Tool | Description |
|------|-------------|
| `bgp_properties` | Search property listings |
| `bgp_deals` | Search active deals |
| `bgp_contacts` | Search contacts |
| `bgp_companies` | Search companies |
| `bgp_requirements` | Search tenant requirements |
| `bgp_comps` | Search comparable transactions |
| `bgp_diary` | View team diary |
| `bgp_news` | AI-curated property news |
| `bgp_chat` | Chat with ChatBGP AI assistant |
