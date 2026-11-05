/** Builds one MCP server instance. Safe to call per connection (stdio or HTTP). */

import { McpServer } from "@modelcontextprotocol/server";
import { SpriteStore, Project } from "./core/canvas.js";
import { registerTools } from "./tools.js";
import { registerResources, registerPrompts } from "./resources.js";

export const SERVER_NAME = "sprite-agent-mcp";
export const SERVER_VERSION = "1.0.0";

export interface ServerContext {
  store: SpriteStore;
  afterMutation: (project: Project) => void;
}

export function buildServer(ctx: ServerContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION, title: "Sprite Agent MCP · pixel art for Arena.ai", description: "Draw beautiful pixel art and sprite animations with indexed palettes, procedural generators, hue-shifted shading, timeline tools and lossless exports. Repository source is READ-ONLY for agents." },
    { capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false }, logging: {} } },
  );
  registerTools(server, ctx.store, ctx.afterMutation);
  registerResources(server, ctx.store);
  registerPrompts(server);
  return server;
}
