import { discoverJsonConversations } from "./conversation-json.mjs";

export const adapter = {
  id: "gemini-json",
  version: "gemini-json-v1",
  discover
};

function discover(channel) {
  return discoverJsonConversations(channel, {
    adapterVersion: adapter.version,
    label: "Gemini CLI",
    defaultProject: "Gemini CLI"
  });
}
