// AgentMail integration - email inbox for News Intelligence
// Reference: connection:conn_agentmail_01KJ3EVDH38GEW7X4NKC5FXQ8Y
import { AgentMailClient } from 'agentmail';

async function getApiKey(): Promise<string> {
  if (process.env.AGENTMAIL_API_KEY) {
    return process.env.AGENTMAIL_API_KEY;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error('AgentMail not configured - set AGENTMAIL_API_KEY');
  }

  const connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=agentmail',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings?.settings?.api_key) {
    throw new Error('AgentMail not connected');
  }
  return connectionSettings.settings.api_key;
}

// WARNING: Never cache this client.
export async function getUncachableAgentMailClient() {
  const apiKey = await getApiKey();
  return new AgentMailClient({
    apiKey: apiKey
  });
}
