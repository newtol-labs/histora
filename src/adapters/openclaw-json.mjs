import { discoverJsonConversations } from "./conversation-json.mjs";

export const adapter = {
  id: "openclaw-json",
  version: "openclaw-json-v1",
  discover
};

function discover(channel) {
  return discoverJsonConversations(channel, {
    adapterVersion: adapter.version,
    label: "OpenClaw",
    defaultProject: "OpenClaw"
  });
}
