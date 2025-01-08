#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const ANKI_CONNECT_URL = "http://localhost:8765";

interface AnkiConnectRequest {
  action: string;
  version: number;
  params: any;
}

interface AnkiNote {
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
  tags?: string[];
}

async function invokeAnkiConnect(action: string, params = {}) {
  const response = await fetch(ANKI_CONNECT_URL, {
    method: "POST",
    body: JSON.stringify({
      action,
      version: 6,
      params,
    } as AnkiConnectRequest),
  });

  const result = await response.json();
  if (result.error) {
    throw new Error(result.error);
  }
  return result.result;
}

// Create server instance
const server = new Server(
  {
    name: "anki-connect",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "add-note",
        description: "Add a new note to Anki",
        inputSchema: {
          type: "object",
          properties: {
            deckName: {
              type: "string",
              description: "Name of the deck to add note to",
            },
            modelName: {
              type: "string", 
              description: "Name of the note model/type to use",
            },
            fields: {
              type: "object",
              description: "Fields for the note as key-value pairs",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Optional tags to add to the note",
            },
          },
          required: ["deckName", "modelName", "fields"],
        },
      },
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "add-note" && args) {
    try {
      const note: AnkiNote = {
        deckName: args.deckName as string,
        modelName: args.modelName as string,
        fields: args.fields as Record<string, string>,
        tags: args.tags as string[] | undefined,
      };

      const noteId = await invokeAnkiConnect("addNote", { note });

      return {
        content: [
          {
            type: "text",
            text: `Successfully created note with ID: ${noteId}`,
          },
        ],
      };

    } catch (err) {
      const error = err as Error;
      return {
        content: [
          {
            type: "text", 
            text: `Failed to create note: ${error.message}`,
          },
        ],
      };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Anki MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});