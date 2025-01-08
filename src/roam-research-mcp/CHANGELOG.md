# Changelog

## [0.12.3] - 2024-12-21

### Fixed

- Improved table parsing in markdown import:
  - Fixed loss of "Name" column and other first-level columns in tables
  - Simplified table handling by treating {{table}} markers like headings
  - Removed unnecessary special case handling for tables
  - Properly maintains all column headers and row values
  - Preserves correct nesting structure for all table elements

## [0.12.2] - 2024-12-21

### Added

- Added support for converting traditional markdown tables to Roam Research table format:
  - Automatically detects and converts pipe-delimited tables
  - Transforms tables into Roam's {{[[table]]}} format
  - Preserves headers and data rows with proper nesting
  - Maintains cell alignment and spacing
  - Integrates with existing markdown conversion pipeline

## [0.12.1] - 2024-12-21

### Fixed

- Fixed markdown parsing in roam_import_markdown and roam_create_page:
  - Properly nests bullet points under bold text sections
  - Resets nesting level for each new bold line
  - Preserves markdown formatting (\*\* markers)
  - Maintains consistent hierarchy for all content types

## [0.12.0] - 2024-12-21

### Changed

- Prefixed all tool names with "roam\_" for better namespacing:
  - roam_add_todo (previously add_todo)
  - roam_fetch_page_by_title (previously fetch_page_by_title)
  - roam_create_page (previously create_page)
  - roam_create_block (previously create_block)
  - roam_import_markdown (new tool)

### Added

- New roam_import_markdown tool for precise nested content placement:
  - Import markdown under specific blocks by UID or exact string match
  - Locate parent blocks within specific pages by title or UID
  - Control content placement order (first or last)
  - Returns created block UIDs for reference
  - Efficient batch operations for nested content
  - Automatic detection and handling of nested vs non-nested content
  - Improved error handling with specific error codes
  - Consistent response format with other tools

## [0.11.1] - 2024-12-21

### Fixed

- Standardized date formatting across all tools:
  - Ensures consistent use of Roam's date format with ordinal suffixes
  - Updated import_nested_markdown helper to use formatRoamDate
  - Maintains proper formatting (e.g., "December 21st, 2024")
  - Aligns with existing date handling in other tools

## [0.11.0] - 2024-12-21

### Changed

- Removed import_nested_markdown from exposed tools:
  - Functionality remains as internal helper
  - Still used by create_page for nested markdown content
  - Maintains existing nested markdown parsing capabilities
  - Breaking change: Direct tool access no longer available

## [0.10.0] - 2024-12-21

### Changed

- Enhanced add_todo tool to support multiple todos:
  - Now accepts an array of todos instead of a single todo
  - Uses batch actions for efficiency when adding more than 10 todos
  - Maintains sequential creation for smaller sets of todos
  - Preserves existing page handling and checkbox formatting

## [0.9.2] - 2024-12-21

### Changed

- Modified add_todo tool to use YYYY-MM-DD format for page UIDs:
  - Uses ISO date format (e.g., "2024-12-21") as the parent UID
  - Maintains human-readable date format for page title
  - Simplifies block creation by using date UID directly

## [0.9.1] - 2024-12-21

### Changed

- Improved date formatting for daily pages:
  - Added helper functions for proper ordinal date formatting
  - Updated date format to match Roam's style (e.g., "December 21st, 2024")
  - Applied to both add_todo and create_block tools
  - Ensures consistent date page references

## [0.9.0] - 2024-12-21

### Added

- New `add_todo` tool for adding todo items:
  - Creates todo blocks with checkbox syntax (`- [ ] todo text`)
  - Automatically adds to today's daily page
  - Creates today's page if it doesn't exist
  - Adds todos as top-level blocks in last position

## [0.8.0] - 2024-12-21

### Added

- Enhanced `create_page` tool with nested markdown support:
  - Automatically detects if content is nested markdown (starts with bullet points)
  - Uses import_nested_markdown functionality for nested content
  - Maintains simple block creation for non-nested content
  - Preserves existing page handling behavior

## [0.7.0] - 2024-12-21

### Added

- Enhanced `create_block` tool with page title support:
  - Added optional `title` parameter as an alternative to `page_uid`
  - Automatically finds or creates page by title when specified
  - Maintains backward compatibility with `page_uid` parameter
  - Preserves default behavior of using today's date when neither specified

All notable changes to the Roam Research MCP server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.1] - 2024-12-21

### Changed

- Streamlined tool set to four core functionalities:
  - fetch_page_by_title: Fetch and read page content with recursive reference resolution
  - create_page: Create new pages with optional content
  - create_block: Create blocks with automatic daily page support
  - import_nested_markdown: Import structured markdown content
- Significantly improved documentation:
  - Reorganized README to reflect current tools
  - Enhanced usage examples with return value descriptions
  - Added detailed markdown import examples
  - Improved error handling documentation
  - Updated development guidelines

### Added

- Case-insensitive page title matching for fetch_page_by_title:
  - Tries original title, capitalized words, and lowercase variations
  - Returns first matching page found
- Enhanced daily page integration:
  - Automatic creation of daily pages when needed
  - Default target for blocks when no page specified
  - Uses US date format (e.g., "December 21, 2024")

### Removed

- Deprecated tools to focus on core functionality:
  - search_blocks
  - pull_data
  - pull_many_data
  - move_block
  - update_block
  - delete_block
  - delete_page
  - batch_actions

## [0.5.0] - 2024-12-20

### Changed

- Replaced `read_page` with `read_page_by_title` tool:
  - Finds pages by title first to get UID
  - Maintains all previous functionality including:
    - Retrieves all blocks with hierarchical structure
    - Recursively resolves block references up to 4 levels deep
    - Converts content to markdown format preserving nesting
  - Improves usability by allowing page lookup by title instead of requiring UID

## [0.4.0] - 2024-12-20

### Added

- New `read_page` tool for reading and resolving page content:
  - Retrieves all blocks from a page with their hierarchical structure
  - Recursively resolves block references (((uid))) up to 4 levels deep
  - Converts the content to markdown format preserving nesting
  - Uses indentation to represent block hierarchy
  - Returns a single markdown document with all references resolved

## [0.3.0] - 2024-12-19

### Added

- New `import_nested_markdown` tool for importing nested markdown content:
  - Supports headings (# to ######)
  - Supports bullet points (\* + -)
  - Supports numbered lists
  - Supports arbitrary nesting via indentation
  - Uses batch actions for efficient creation
  - Preserves hierarchical structure in Roam
  - Implements pre-generated UIDs for immediate block access:
    - Uses 9-character format matching Roam's convention
    - Generates using alphanumeric plus special chars (-, \_)
    - Enables direct block referencing during creation
    - Allows efficient parent-child relationship management

## [0.2.0] - 2024-12-19

### Changed

- Improved environment variable handling with better debug logging
- Added support for loading .env from both current directory and roam-research directory
- Added detailed error messages explaining configuration options
- Updated documentation with clearer setup instructions for both configuration methods

## [0.1.0] - 2024-12-19

### Added

- Initial release of the Roam Research MCP server
- Implemented ten core tools for Roam Research API interaction:
  - search_blocks: Search for blocks containing specific text
  - create_page: Create new pages with optional content
  - create_block: Create new blocks in existing pages
  - pull_data: Get data for specific blocks/pages
  - pull_many_data: Get data for multiple blocks/pages
  - move_block: Move blocks to new locations
  - update_block: Update block content and properties
  - delete_block: Delete blocks
  - delete_page: Delete pages
  - batch_actions: Perform multiple operations at once
- Full TypeScript support with comprehensive type definitions
- Proper error handling for all API responses
- Support for finding existing pages before creation
- Support for batch operations
- Detailed input schemas for all tools
- Comprehensive documentation in README.md
