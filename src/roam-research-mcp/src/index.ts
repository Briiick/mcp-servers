#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { 
  initializeGraph, 
  q, 
  createPage, 
  createBlock,
  updateBlock,
  deleteBlock,
  deletePage,
  moveBlock,
  pull,
  batchActions,
} from '@roam-research/roam-api-sdk';
import type { Graph } from '@roam-research/roam-api-sdk';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { 
  parseMarkdown, 
  convertToRoamActions, 
  type BatchAction, 
  convertAllTables, 
  hasMarkdownTable,
  convertToRoamMarkdown 
} from './markdown-utils.js';

// Define RoamBlock interface
interface RoamBlock {
  uid: string;
  string: string;
  order: number;
  children: RoamBlock[];
}

// Get the project root from the script path
const scriptPath = process.argv[1];  // Full path to the running script
const projectRoot = dirname(dirname(scriptPath));  // Go up two levels from build/index.js

// Try to load .env from project root
const envPath = join(projectRoot, '.env');
if (existsSync(envPath)) {
  const result = dotenv.config({ path: envPath });
} else {
  // No logging needed
}

const API_TOKEN = process.env.ROAM_API_TOKEN as string;
const GRAPH_NAME = process.env.ROAM_GRAPH_NAME as string;

if (!API_TOKEN || !GRAPH_NAME) {
  const missingVars = [];
  if (!API_TOKEN) missingVars.push('ROAM_API_TOKEN');
  if (!GRAPH_NAME) missingVars.push('ROAM_GRAPH_NAME');

  throw new Error(
    `Missing required environment variables: ${missingVars.join(', ')}\n\n` +
    'Please configure these variables either:\n' +
    '1. In your MCP settings file:\n' +
    '   - For Cline: ~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json\n' +
    '   - For Claude: ~/Library/Application Support/Claude/claude_desktop_config.json\n\n' +
    '   Example configuration:\n' +
    '   {\n' +
    '     "mcpServers": {\n' +
    '       "roam-research": {\n' +
    '         "command": "node",\n' +
    '         "args": ["/path/to/roam-research/build/index.js"],\n' +
    '         "env": {\n' +
    '           "ROAM_API_TOKEN": "your-api-token",\n' +
    '           "ROAM_GRAPH_NAME": "your-graph-name"\n' +
    '         }\n' +
    '       }\n' +
    '     }\n' +
    '   }\n\n' +
    '2. Or in a .env file in the roam-research directory:\n' +
    '   ROAM_API_TOKEN=your-api-token\n' +
    '   ROAM_GRAPH_NAME=your-graph-name'
  );
}

// Helper function to get ordinal suffix
function getOrdinalSuffix(n: number): string {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return "st";
  if (j === 2 && k !== 12) return "nd";
  if (j === 3 && k !== 13) return "rd";
  return "th";
}

// Helper function to format date in Roam's format
function formatRoamDate(date: Date): string {
  const month = date.toLocaleDateString('en-US', { month: 'long' });
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month} ${day}${getOrdinalSuffix(day)}, ${year}`;
}

class RoamServer {
  private server: Server;
  private graph: Graph;

  constructor() {
    this.graph = initializeGraph({
      token: API_TOKEN,
      graph: GRAPH_NAME,
    });
    this.server = new Server(
      {
        name: 'roam-research',
        version: '0.12.1',
      },
      {
          capabilities: {
            tools: {
              roam_add_todo: {},
              roam_fetch_page_by_title: {},
              roam_create_page: {},
              roam_create_block: {},
              roam_import_markdown: {}
            },
          },
        }
      );

    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => { /* handle error silently */ };
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
              // Add todo
              {
                name: 'roam_add_todo',
                description: 'Add a list of todo items as individual blocks to today\'s daily page in Roam. Each item becomes its own actionable block with todo status.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    todos: {
                      type: 'array',
                      items: {
                        type: 'string',
                        description: 'Todo item text'
                      },
                      description: 'List of todo items to add'
                    }
                  },
                  required: ['todos'],
                },
              },
              // Read page
          {
            name: 'roam_fetch_page_by_title',
            description: 'Retrieve complete page contents by exact title, including all nested blocks and resolved block references. Use for reading and analyzing existing Roam pages.',
            inputSchema: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: 'Title of the page to fetch and read',
                },
              },
              required: ['title'],
            },
          },
          // Create page
          {
            name: 'roam_create_page',
            description: 'Create a new standalone page in Roam from markdown with given title. Best for hierarchical content, reference materials, markdown tables, and topics that deserve their own namespace. Optional initial content will be properly nested as blocks.',
            inputSchema: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: 'Title of the new page',
                },
                content: {
                  type: 'string',
                  description: 'Initial content for the page (optional)',
                },
              },
              required: ['title'],
            },
          },
          // Create block
          {
            name: 'roam_create_block',
            description: 'Add a new block to an existing Roam page. If no page specified, adds to today\'s daily note. Best for capturing immediate thoughts, additions to discussions, or content that doesn\'t warrant its own page. Can specify page by title or UID.',
            inputSchema: {
              type: 'object',
              properties: {
                content: {
                  type: 'string',
                  description: 'Content of the block',
                },
                page_uid: {
                  type: 'string',
                  description: 'Optional: UID of the page to add block to',
                },
                title: {
                  type: 'string',
                  description: 'Optional: Title of the page to add block to (defaults to today\'s date if neither page_uid nor title provided)',
                },
              },
              required: ['content'],
            },
          },
          // Import markdown
          {
            name: 'roam_import_markdown',
            description: 'Import nested markdown content into Roam under a specific block. Can locate the parent block by UID or by exact string match within a specific page.',
            inputSchema: {
              type: 'object',
              properties: {
                content: {
                  type: 'string',
                  description: 'Nested markdown content to import'
                },
                page_uid: {
                  type: 'string',
                  description: 'Optional: UID of the page containing the parent block'
                },
                page_title: {
                  type: 'string',
                  description: 'Optional: Title of the page containing the parent block (ignored if page_uid provided)'
                },
                parent_uid: {
                  type: 'string',
                  description: 'Optional: UID of the parent block to add content under'
                },
                parent_string: {
                  type: 'string',
                  description: 'Optional: Exact string content of the parent block to add content under (must provide either page_uid or page_title)'
                },
                order: {
                  type: 'string',
                  description: 'Optional: Where to add the content under the parent ("first" or "last")',
                  enum: ['first', 'last'],
                  default: 'first'
                }
              },
              required: ['content']
            }
          },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case 'roam_fetch_page_by_title': {
            const { title } = request.params.arguments as { title: string };
            
            if (!title) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                'title is required'
              );
            }

            // Try to find the page with different case variations
            console.log('Finding page...');
            
            // Helper function to capitalize each word
            const capitalizeWords = (str: string) => {
              return str.split(' ').map(word => 
                word.charAt(0).toUpperCase() + word.slice(1)
              ).join(' ');
            };

            // Try different case variations
            const variations = [
              title, // Original
              capitalizeWords(title), // Each word capitalized
              title.toLowerCase() // All lowercase
            ];

            let uid: string | null = null;
            for (const variation of variations) {
              const searchQuery = `[:find ?uid .
                               :where [?e :node/title "${variation}"]
                                      [?e :block/uid ?uid]]`;
              const result = await q(this.graph, searchQuery, []);
              uid = (result === null || result === undefined) ? null : String(result);
              console.log(`Trying "${variation}" - UID:`, uid);
              if (uid) break;
            }

            if (!uid) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                `Page with title "${title}" not found (tried original, capitalized words, and lowercase)`
              );
            }

            // Helper function to collect all referenced block UIDs from text
            const collectRefs = (text: string, depth: number = 0, refs: Set<string> = new Set()): Set<string> => {
              if (depth >= 4) return refs; // Max recursion depth
              
              const refRegex = /\(\(([a-zA-Z0-9_-]+)\)\)/g;
              let match;
              
              while ((match = refRegex.exec(text)) !== null) {
                const [_, uid] = match;
                refs.add(uid);
              }
              
              return refs;
            };

            // Helper function to resolve block references
            const resolveRefs = async (text: string, depth: number = 0): Promise<string> => {
              if (depth >= 4) return text; // Max recursion depth
              
              const refs = collectRefs(text, depth);
              if (refs.size === 0) return text;

              // Get referenced block contents
              const refQuery = `[:find ?uid ?string
                               :in $ [?uid ...]
                               :where [?b :block/uid ?uid]
                                     [?b :block/string ?string]]`;
              const refResults = await q(this.graph, refQuery, [Array.from(refs)]) as [string, string][];
              
              // Create lookup map of uid -> string
              const refMap = new Map<string, string>();
              refResults.forEach(([uid, string]) => {
                refMap.set(uid, string);
              });
              
              // Replace references with their content
              let resolvedText = text;
              for (const uid of refs) {
                const refContent = refMap.get(uid);
                if (refContent) {
                  // Recursively resolve nested references
                  const resolvedContent = await resolveRefs(refContent, depth + 1);
                  resolvedText = resolvedText.replace(
                    new RegExp(`\\(\\(${uid}\\)\\)`, 'g'),
                    resolvedContent
                  );
                }
              }
              
              return resolvedText;
            };

            // Get all blocks under this page with their order and parent relationships
            console.log('\nGetting blocks...');
            const blocksQuery = `[:find ?block-uid ?block-str ?order ?parent-uid
                               :where [?p :block/uid "${uid}"]
                                      [?b :block/page ?p]
                                      [?b :block/uid ?block-uid]
                                      [?b :block/string ?block-str]
                                      [?b :block/order ?order]
                                      [?b :block/parents ?parent]
                                      [?parent :block/uid ?parent-uid]]`;
            const blocks = await q(this.graph, blocksQuery, []);
            console.log('Found', blocks.length, 'blocks');
            
            if (blocks.length > 0) {
                const blockMap = new Map<string, RoamBlock>();
                for (const [uid, string, order] of blocks) {
                  if (!blockMap.has(uid)) {
                    const resolvedString = await resolveRefs(string);
                    blockMap.set(uid, {
                      uid,
                      string: resolvedString,
                      order: order as number,
                      children: []
                    });
                  }
                }
                console.log('Created block map with', blockMap.size, 'entries');
                // Create a map of all blocks and resolve references

                // Build parent-child relationships
                let relationshipsBuilt = 0;
                blocks.forEach(([childUid, _, __, parentUid]) => {
                  const child = blockMap.get(childUid);
                  const parent = blockMap.get(parentUid);
                  if (child && parent && !parent.children.includes(child)) {
                    parent.children.push(child);
                    relationshipsBuilt++;
                  }
                });
                console.log('Built', relationshipsBuilt, 'parent-child relationships');

                // Get top-level blocks (those directly under the page)
                console.log('\nGetting top-level blocks...');
                const topQuery = `[:find ?block-uid ?block-str ?order
                                :where [?p :block/uid "${uid}"]
                                      [?b :block/page ?p]
                                      [?b :block/uid ?block-uid]
                                      [?b :block/string ?block-str]
                                      [?b :block/order ?order]
                                      (not-join [?b]
                                        [?b :block/parents ?parent]
                                        [?parent :block/page ?p])]`;
                const topBlocks = await q(this.graph, topQuery, []);
                console.log('Found', topBlocks.length, 'top-level blocks');

                // Create root blocks
                const rootBlocks = topBlocks
                  .map(([uid, string, order]) => ({
                    uid,
                    string,
                    order: order as number,
                    children: blockMap.get(uid)?.children || []
                  }))
                  .sort((a, b) => a.order - b.order);

                // Convert to markdown
                const toMarkdown = (blocks: RoamBlock[], level: number = 0): string => {
                  return blocks.map(block => {
                    const indent = '  '.repeat(level);
                    let md = `${indent}- ${block.string}\n`;
                    if (block.children.length > 0) {
                      md += toMarkdown(block.children.sort((a, b) => a.order - b.order), level + 1);
                    }
                    return md;
                  }).join('');
                };

                const markdown = `# ${title}\n\n${toMarkdown(rootBlocks)}`;

                return {
                content: [
                  {
                    type: 'text',
                    text: markdown,
                  },
                ],
              };
            } else {
              return { content: [
                {
                  type: 'text',
                  text: `${title} (no content found)`
                }
              ]};
            }
          }

          case 'search_for_page_title': {
            const { search_string } = request.params.arguments as { search_string: string };
            const query = `[:find ?page-title ?uid
                          :in $ ?search-string
                          :where [?e :node/title ?page-title]
                                [?e :block/uid ?uid]
                                [(clojure.string/includes? ?page-title ?search-string)]]`;
            const results = await q(this.graph, query, [search_string]);
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(results, null, 2),
                },
              ],
            };
          }

          case 'search_blocks': {
            const { search_string } = request.params.arguments as { search_string: string };
            const query = `[:find ?block-uid ?block-str 
                          :in $ ?search-string 
                          :where [?b :block/uid ?block-uid] 
                                [?b :block/string ?block-str] 
                                [(clojure.string/includes? ?block-str ?search-string)]]`;
            const results = await q(this.graph, query, [search_string]);
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(results, null, 2),
                },
              ],
            };
          }

          case 'roam_create_page': {
            const { title, content } = request.params.arguments as { title: string; content?: string };
            // Ensure title is properly formatted
            const pageTitle = String(title).trim();
            
            // First try to find if the page exists
            const findQuery = `[:find ?uid :in $ ?title :where [?e :node/title ?title] [?e :block/uid ?uid]]`;
            type FindResult = [string];
            const findResults = await q(this.graph, findQuery, [pageTitle]) as FindResult[];
            
            let pageUid: string | undefined;
            
            if (findResults && findResults.length > 0) {
              // Page exists, use its UID
              pageUid = findResults[0][0];
            } else {
              // Create new page
              const success = await createPage(this.graph, {
                action: 'create-page',
                page: {
                  title: pageTitle
                }
              });

              if (!success) {
                throw new Error('Failed to create page');
              }

              // Get the new page's UID
              const results = await q(this.graph, findQuery, [pageTitle]) as FindResult[];
              if (!results || results.length === 0) {
                throw new Error('Could not find created page');
              }
              pageUid = results[0][0];
            }
            
            // If content is provided, check if it looks like nested markdown
            if (content) {

              const isMultilined = content.includes('\n') || hasMarkdownTable(content);
              
              if (isMultilined) {
                // Use import_nested_markdown functionality
                const convertedContent = convertToRoamMarkdown(content);
                const nodes = parseMarkdown(convertedContent);
                const actions = convertToRoamActions(nodes, pageUid, 'last');
                const result = await batchActions(this.graph, {
                  action: 'batch-actions',
                  actions
                });
                
                if (!result) {
                  throw new Error('Failed to import nested markdown content');
                }
              } else {
                // Create a simple block for non-nested content
                const blockSuccess = await createBlock(this.graph, {
                  action: 'create-block',
                  location: { 
                    "parent-uid": pageUid,
                    "order": "last"
                  },
                  block: { string: content }
                });

                if (!blockSuccess) {
                  throw new Error('Failed to create content block');
                }
              }
            }
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ success: true, uid: pageUid }, null, 2),
                },
              ],
            };
          }

          case 'roam_create_block': {
            const { content, page_uid, title } = request.params.arguments as { 
              content: string; 
              page_uid?: string;
              title?: string;
            };
            
            // If page_uid provided, use it directly
            let targetPageUid = page_uid;
            
            // If no page_uid but title provided, search for page by title
            if (!targetPageUid && title) {
              const findQuery = `[:find ?uid :in $ ?title :where [?e :node/title ?title] [?e :block/uid ?uid]]`;
              const findResults = await q(this.graph, findQuery, [title]) as [string][];
              
              if (findResults && findResults.length > 0) {
                targetPageUid = findResults[0][0];
              } else {
                // Create page with provided title if it doesn't exist
                const success = await createPage(this.graph, {
                  action: 'create-page',
                  page: { title }
                });

                if (!success) {
                  throw new Error('Failed to create page with provided title');
                }

                // Get the new page's UID
                const results = await q(this.graph, findQuery, [title]) as [string][];
                if (!results || results.length === 0) {
                  throw new Error('Could not find created page');
                }
                targetPageUid = results[0][0];
              }
            }
            
            // If neither page_uid nor title provided, use today's date page
            if (!targetPageUid) {
              const today = new Date();
              const dateStr = formatRoamDate(today);
              
              // Try to find today's page
              const findQuery = `[:find ?uid :in $ ?title :where [?e :node/title ?title] [?e :block/uid ?uid]]`;
              const findResults = await q(this.graph, findQuery, [dateStr]) as [string][];
              
              if (findResults && findResults.length > 0) {
                targetPageUid = findResults[0][0];
              } else {
                // Create today's page if it doesn't exist
                const success = await createPage(this.graph, {
                  action: 'create-page',
                  page: { title: dateStr }
                });

                if (!success) {
                  throw new Error('Failed to create today\'s page');
                }

                // Get the new page's UID
                const results = await q(this.graph, findQuery, [dateStr]) as [string][];
                if (!results || results.length === 0) {
                  throw new Error('Could not find created today\'s page');
                }
                targetPageUid = results[0][0];
              }
            }

            // If the converted content has multiple lines (e.g. from table conversion)
            // or is a table (which will be converted to multiple lines), use nested import
            if (content.includes('\n')) {
              // Parse and import the nested content
              const convertedContent = convertToRoamMarkdown(content);
              const nodes = parseMarkdown(convertedContent);
              const actions = convertToRoamActions(nodes, targetPageUid, 'last');
              
              // Execute batch actions to create the nested structure
              const result = await batchActions(this.graph, {
                action: 'batch-actions',
                actions
              });

              if (!result) {
                throw new Error('Failed to create nested blocks');
              }

              const blockUid = result.created_uids?.[0];
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ 
                      success: true,
                      block_uid: blockUid,
                      parent_uid: targetPageUid
                    }, null, 2),
                  },
                ],
              };
            } else {
              // For non-table content, create a simple block
              const result = await createBlock(this.graph, {
                action: 'create-block',
                location: { 
                  "parent-uid": targetPageUid,
                  "order": "last"
                },
                block: { string: content }
              });

              if (!result) {
                throw new Error('Failed to create block');
              }

              // Get the block's UID
              const findBlockQuery = `[:find ?uid
                                    :in $ ?parent ?string
                                    :where [?b :block/uid ?uid]
                                          [?b :block/string ?string]
                                          [?b :block/parents ?p]
                                          [?p :block/uid ?parent]]`;
              const blockResults = await q(this.graph, findBlockQuery, [targetPageUid, content]) as [string][];
              
              if (!blockResults || blockResults.length === 0) {
                throw new Error('Could not find created block');
              }

              const blockUid = blockResults[0][0];
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ 
                      success: true,
                      block_uid: blockUid,
                      parent_uid: targetPageUid
                    }, null, 2),
                  },
                ],
              };
            }
            
          }

          case 'roam_import_markdown': {
            const { 
              content,
              page_uid,
              page_title,
              parent_uid,
              parent_string,
              order = 'first'
            } = request.params.arguments as {
              content: string;
              page_uid?: string;
              page_title?: string;
              parent_uid?: string;
              parent_string?: string;
              order?: 'first' | 'last';
            };

            // First get the page UID
            let targetPageUid = page_uid;
            
            if (!targetPageUid && page_title) {
              const findQuery = `[:find ?uid :in $ ?title :where [?e :node/title ?title] [?e :block/uid ?uid]]`;
              const findResults = await q(this.graph, findQuery, [page_title]) as [string][];
              
              if (findResults && findResults.length > 0) {
                targetPageUid = findResults[0][0];
              } else {
                throw new McpError(
                  ErrorCode.InvalidRequest,
                  `Page with title "${page_title}" not found`
                );
              }
            }

            // If no page specified, use today's date page
            if (!targetPageUid) {
              const today = new Date();
              const dateStr = formatRoamDate(today);
              
              const findQuery = `[:find ?uid :in $ ?title :where [?e :node/title ?title] [?e :block/uid ?uid]]`;
              const findResults = await q(this.graph, findQuery, [dateStr]) as [string][];
              
              if (findResults && findResults.length > 0) {
                targetPageUid = findResults[0][0];
              } else {
                // Create today's page
                const success = await createPage(this.graph, {
                  action: 'create-page',
                  page: { title: dateStr }
                });

                if (!success) {
                  throw new McpError(
                    ErrorCode.InternalError,
                    'Failed to create today\'s page'
                  );
                }

                const results = await q(this.graph, findQuery, [dateStr]) as [string][];
                if (!results || results.length === 0) {
                  throw new McpError(
                    ErrorCode.InternalError,
                    'Could not find created today\'s page'
                  );
                }
                targetPageUid = results[0][0];
              }
            }

            // Now get the parent block UID
            let targetParentUid = parent_uid;

            if (!targetParentUid && parent_string) {
              if (!targetPageUid) {
                throw new McpError(
                  ErrorCode.InvalidRequest,
                  'Must provide either page_uid or page_title when using parent_string'
                );
              }

              // Find block by exact string match within the page
              const findBlockQuery = `[:find ?uid
                                    :where [?p :block/uid "${targetPageUid}"]
                                           [?b :block/page ?p]
                                           [?b :block/string "${parent_string}"]]`;
              const blockResults = await q(this.graph, findBlockQuery, []) as [string][];
              
              if (!blockResults || blockResults.length === 0) {
                throw new McpError(
                  ErrorCode.InvalidRequest,
                  `Block with content "${parent_string}" not found on specified page`
                );
              }
              
              targetParentUid = blockResults[0][0];
            }

            // If no parent specified, use page as parent
            if (!targetParentUid) {
              targetParentUid = targetPageUid;
            }

            // Always use parseMarkdown for content with multiple lines or any markdown formatting
            const isMultilined = content.includes('\n');
            
            if (isMultilined) {
              // Parse markdown into hierarchical structure
              const convertedContent = convertToRoamMarkdown(content);
              const nodes = parseMarkdown(convertedContent);

              // Convert markdown nodes to batch actions
              const actions = convertToRoamActions(nodes, targetParentUid, order);

              // Execute batch actions to add content
              const result = await batchActions(this.graph, {
                action: 'batch-actions',
                actions
              });

              if (!result) {
                throw new McpError(
                  ErrorCode.InternalError,
                  'Failed to import nested markdown content'
                );
              }

              // Get the created block UIDs
              const createdUids = result.created_uids || [];
              
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ 
                      success: true,
                      page_uid: targetPageUid,
                      parent_uid: targetParentUid,
                      created_uids: createdUids
                    }, null, 2),
                  },
                ],
              };
            } else {
              // Create a simple block for non-nested content
              const blockSuccess = await createBlock(this.graph, {
                action: 'create-block',
                location: { 
                  "parent-uid": targetParentUid,
                  order
                },
                block: { string: content }
              });

              if (!blockSuccess) {
                throw new McpError(
                  ErrorCode.InternalError,
                  'Failed to create content block'
                );
              }

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ 
                      success: true,
                      page_uid: targetPageUid,
                      parent_uid: targetParentUid
                    }, null, 2),
                  },
                ],
              };
            }
          }

          case 'roam_add_todo': {
            const { todos } = request.params.arguments as { todos: string[] };
            
            if (!Array.isArray(todos) || todos.length === 0) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                'todos must be a non-empty array'
              );
            }

            // Get today's date
            const today = new Date();
            const dateStr = formatRoamDate(today);
            
            // Try to find today's page
            const findQuery = `[:find ?uid :in $ ?title :where [?e :node/title ?title] [?e :block/uid ?uid]]`;
            const findResults = await q(this.graph, findQuery, [dateStr]) as [string][];
            
            let targetPageUid: string;
            
            if (findResults && findResults.length > 0) {
              targetPageUid = findResults[0][0];
            } else {
              // Create today's page if it doesn't exist
              const success = await createPage(this.graph, {
                action: 'create-page',
                page: { title: dateStr }
              });

              if (!success) {
                throw new Error('Failed to create today\'s page');
              }

              // Get the new page's UID
              const results = await q(this.graph, findQuery, [dateStr]) as [string][];
              if (!results || results.length === 0) {
                throw new Error('Could not find created today\'s page');
              }
              targetPageUid = results[0][0];
            }

            // If more than 10 todos, use batch actions
            const todo_tag = "{{TODO}}";
            if (todos.length > 10) {
              const actions = todos.map((todo, index) => ({
                action: 'create-block',
                location: {
                  'parent-uid': targetPageUid,
                  order: index
                },
                block: {
                  string: `${todo_tag} ${todo}`
                }
              }));

              const result = await batchActions(this.graph, {
                action: 'batch-actions',
                actions
              });

              if (!result) {
                throw new Error('Failed to create todo blocks');
              }
            } else {
              // Create todos sequentially
              for (const todo of todos) {
                const success = await createBlock(this.graph, {
                  action: 'create-block',
                  location: { 
                    "parent-uid": targetPageUid,
                    "order": "last"
                  },
                  block: { string: `${todo_tag} ${todo}` }
                });
                
                if (!success) {
                  throw new Error('Failed to create todo block');
                }
              }
            }
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ success: true }, null, 2),
                },
              ],
            };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error: unknown) {
        if (error instanceof McpError) {
          throw error;
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new McpError(
          ErrorCode.InternalError,
          `Roam API error: ${errorMessage}`
        );
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

const server = new RoamServer();
server.run().catch(() => { /* handle error silently */ });
