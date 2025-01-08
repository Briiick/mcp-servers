import type { 
  RoamCreateBlock,
  RoamCreatePage,
  RoamUpdateBlock,
  RoamDeleteBlock,
  RoamDeletePage,
  RoamMoveBlock
} from '@roam-research/roam-api-sdk';

export type BatchAction = 
  | RoamCreateBlock 
  | RoamCreatePage 
  | RoamUpdateBlock 
  | RoamDeleteBlock 
  | RoamDeletePage 
  | RoamMoveBlock;

interface MarkdownNode {
  content: string;
  level: number;
  children: MarkdownNode[];
}

/**
 * Check if text has a traditional markdown table
 */
function hasMarkdownTable(text: string): boolean {
  return /^\|([^|]+\|)+\s*$\n\|(\s*:?-+:?\s*\|)+\s*$\n(\|([^|]+\|)+\s*$\n*)+$/.test(text);
}

/**
 * Converts a markdown table to Roam format
 */
function convertTableToRoamFormat(text: string) {
  const lines = text.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const tableRegex = /^\|([^|]+\|)+\s*$\n\|(\s*:?-+:?\s*\|)+\s*$\n(\|([^|]+\|)+\s*$\n*)+/m;

  if (!tableRegex.test(text)) {
    return text;
  }

  const rows = lines
    .filter((_, index) => index !== 1)
    .map(line => 
      line.trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map(cell => cell.trim())
    );

  let roamTable = '{{table}}\n';
  
  // First row becomes column headers
  const headers = rows[0];
  for (let i = 0; i < headers.length; i++) {
    roamTable += `${'  '.repeat(i + 1)}- ${headers[i]}\n`;
  }
  
  // Remaining rows become nested under each column
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      roamTable += `${'  '.repeat(colIndex + 1)}- ${row[colIndex]}\n`;
    }
  }

  return roamTable.trim();
}

function convertAllTables(text: string) {
  return text.replaceAll(
    /(^\|([^|]+\|)+\s*$\n\|(\s*:?-+:?\s*\|)+\s*$\n(\|([^|]+\|)+\s*$\n*)+)/gm,
          (match) => {
      return '\n' + convertTableToRoamFormat(match) + '\n';
          }
        );
      }

function convertToRoamMarkdown(text: string): string {
  // First handle double asterisks/underscores (bold)
  text = text.replace(/\*\*(.+?)\*\*/g, '**$1**');  // Preserve double asterisks
  
  // Then handle single asterisks/underscores (italic)
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '__$1__');  // Single asterisk to double underscore
  text = text.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '__$1__');        // Single underscore to double underscore
  
  // Handle highlights
  text = text.replace(/==(.+?)==/g, '^^$1^^');
  
  // Convert tables
  text = convertAllTables(text);
  
  return text;
}

function parseMarkdown(markdown: string): MarkdownNode[] {
  const lines = markdown.split('\n');
  const rootNodes: MarkdownNode[] = [];
  const stack: MarkdownNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trimEnd();
    
    // Skip truly empty lines (no spaces)
    if (trimmedLine === '') {
      continue;
    }

    // Calculate indentation level (2 spaces = 1 level)
    const indentation = line.match(/^\s*/)?.[0].length ?? 0;
    let level = Math.floor(indentation / 2);

    // Extract content after bullet point or heading
    let content = trimmedLine;
    if (trimmedLine.startsWith('#') || trimmedLine.includes('{{table}}')) {
      // Remove bullet point if it precedes a table marker
      content = trimmedLine.replace(/^\s*[-*+]\s+/, '');
      level = 0;
      // Reset stack but keep heading/table as parent
      stack.length = 1;  // Keep only the heading/table
    } else if (stack[0]?.content.startsWith('#') || stack[0]?.content.includes('{{table}}')) {
      // If previous node was a heading or table marker, increase level by 1
      level = Math.max(level, 1);
      // Remove bullet point
      content = trimmedLine.replace(/^\s*[-*+]\s+/, '');
    } else {
      // Remove bullet point
      content = trimmedLine.replace(/^\s*[-*+]\s+/, '');
    }

    // Create new node
    const node: MarkdownNode = {
      content,
      level,
      children: []
    };

    // Find the appropriate parent for this node based on level
    if (level === 0) {
      rootNodes.push(node);
      stack[0] = node;
    } else {
      // Pop stack until we find the parent level
      while (stack.length > level) {
        stack.pop();
      }
      
      // Add as child to parent
      if (stack[level - 1]) {
        stack[level - 1].children.push(node);
      } else {
        // If no parent found, treat as root node
        rootNodes.push(node);
      }
      stack[level] = node;
    }
  }

  return rootNodes;
}

function parseTableRows(lines: string[]): MarkdownNode[] {
  const tableNodes: MarkdownNode[] = [];
  let currentLevel = -1;

  for (const line of lines) {
    const trimmedLine = line.trimEnd();
    if (!trimmedLine) continue;

    // Calculate indentation level
    const indentation = line.match(/^\s*/)?.[0].length ?? 0;
    const level = Math.floor(indentation / 2);

    // Extract content after bullet point
    const content = trimmedLine.replace(/^\s*[-*+]\s*/, '');

    // Create node for this cell
    const node: MarkdownNode = {
      content,
      level,
      children: []
    };

    // Track the first level we see to maintain relative nesting
    if (currentLevel === -1) {
      currentLevel = level;
    }

    // Add node to appropriate parent based on level
    if (level === currentLevel) {
      tableNodes.push(node);
    } else {
      // Find parent by walking back through nodes
      let parent = tableNodes[tableNodes.length - 1];
      while (parent && parent.level < level - 1) {
        parent = parent.children[parent.children.length - 1];
      }
      if (parent) {
        parent.children.push(node);
      }
    }
  }

  return tableNodes;
}

function generateBlockUid(): string {
  // Generate a random string of 9 characters (Roam's format)
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
  let uid = '';
  for (let i = 0; i < 9; i++) {
    uid += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return uid;
}

interface BlockInfo {
  uid: string;
  content: string;
  children: BlockInfo[];
}

function convertNodesToBlocks(nodes: MarkdownNode[]): BlockInfo[] {
  return nodes.map(node => ({
    uid: generateBlockUid(),
    content: node.content,
    children: convertNodesToBlocks(node.children)
  }));
}

function convertToRoamActions(
  nodes: MarkdownNode[], 
  parentUid: string,
  order: 'first' | 'last' | number = 'last'
): BatchAction[] {
  // First convert nodes to blocks with UIDs
  const blocks = convertNodesToBlocks(nodes);
  const actions: BatchAction[] = [];

  // Helper function to recursively create actions
  function createBlockActions(blocks: BlockInfo[], parentUid: string, order: 'first' | 'last' | number): void {
    for (const block of blocks) {
      // Create the current block
      const action: RoamCreateBlock = {
        action: 'create-block',
        location: {
          'parent-uid': parentUid,
          order
        },
        block: {
          uid: block.uid,
          string: block.content
        }
      };
      
      actions.push(action);

      // Create child blocks if any
      if (block.children.length > 0) {
        createBlockActions(block.children, block.uid, 'last');
      }
    }
  }

  // Create all block actions
  createBlockActions(blocks, parentUid, order);
  
  return actions;
}

// Export public functions and types
export {
  parseMarkdown,
  convertToRoamActions,
  hasMarkdownTable,
  convertAllTables,
  convertToRoamMarkdown
};
