/**
 * MarkdownView - Markdown-ish renderer for diagnosis / plan narrative.
 *
 * Renders micromark-parsed MDAST as native Ink <Box>/<Text> nodes with
 * theme-driven colors for headings, code, inline code, lists, bold/italic.
 * Used inside DPEVPanel for completed phase tokens (D-20 boundary).
 *
 * Chosen over the pre-built ANSI-string terminal renderers per 19.3-RESEARCH.md
 * section 3 (see section 2 for the disqualified alternatives): no ANSI boundary,
 * ~307 KB deps total, clean snapshot tests.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Root, RootContent, PhrasingContent } from 'mdast';

export interface MarkdownViewProps {
  children: string;
}

const HEADING_COLORS = [
  'cyanBright',
  'cyan',
  'blueBright',
  'blue',
  'magenta',
  'magentaBright',
] as const;

/**
 * Recursive renderer for a single MDAST node.
 * Returns null for node types we intentionally do not style (D-21: unknown
 * nodes degrade to nothing rather than leaking raw Markdown tokens).
 * Keys are composite `${parentKey}-${index}` per RESEARCH.md Pitfall 5.
 */
function renderNode(node: RootContent | PhrasingContent, key: string): React.ReactElement | null {
  switch (node.type) {
    case 'heading': {
      const color = HEADING_COLORS[(node.depth - 1) % HEADING_COLORS.length] ?? 'cyanBright';
      return (
        <Text key={key} bold color={color}>
          {node.children.map((c, i) => renderNode(c, `${key}-${i}`))}
        </Text>
      );
    }
    case 'paragraph':
      return (
        <Box key={key} flexDirection="row" flexWrap="wrap">
          {node.children.map((c, i) => renderNode(c, `${key}-${i}`))}
        </Box>
      );
    case 'code':
      return (
        <Box
          key={key}
          flexDirection="column"
          marginY={1}
          paddingLeft={2}
          borderStyle="single"
          borderColor="gray"
        >
          {node.lang ? <Text dimColor>{node.lang}</Text> : null}
          <Text color="greenBright">{node.value}</Text>
        </Box>
      );
    case 'inlineCode':
      return (
        <Text key={key} color="yellowBright">
          {node.value}
        </Text>
      );
    case 'strong':
      return (
        <Text key={key} bold>
          {node.children.map((c, i) => renderNode(c, `${key}-${i}`))}
        </Text>
      );
    case 'emphasis':
      return (
        <Text key={key} italic>
          {node.children.map((c, i) => renderNode(c, `${key}-${i}`))}
        </Text>
      );
    case 'list':
      return (
        <Box key={key} flexDirection="column" marginLeft={2}>
          {node.children.map((item, i) => (
            <Box key={`${key}-item-${i}`} gap={1}>
              <Text>{node.ordered ? `${(node.start ?? 1) + i}.` : '-'}</Text>
              <Box flexDirection="column">
                {item.children.map((c, j) => renderNode(c as RootContent, `${key}-item-${i}-${j}`))}
              </Box>
            </Box>
          ))}
        </Box>
      );
    case 'text':
      return <Text key={key}>{node.value}</Text>;
    default:
      return null;
  }
}

/**
 * Pure function: parse Markdown string into an Ink JSX tree.
 * Tolerates undefined / empty / malformed input -- returns an empty Box or a
 * plain-text fallback, never throws (D-21).
 */
export function renderMarkdown(input: string | undefined): React.ReactElement {
  if (!input || typeof input !== 'string') {
    return <Box flexDirection="column" />;
  }
  let ast: Root;
  try {
    ast = fromMarkdown(input);
  } catch {
    // Graceful degradation: malformed/partial Markdown falls back to plain text.
    return (
      <Box flexDirection="column">
        <Text>{input}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      {ast.children.map((node, i) => renderNode(node, `md-${i}`))}
    </Box>
  );
}

/**
 * Component wrapper. Memoized on `children` so a streaming parent re-render
 * does not re-parse the accumulated string (RESEARCH.md Pitfall 1).
 */
export function MarkdownView({ children }: MarkdownViewProps): React.ReactElement {
  const rendered = React.useMemo(() => renderMarkdown(children), [children]);
  return rendered;
}
