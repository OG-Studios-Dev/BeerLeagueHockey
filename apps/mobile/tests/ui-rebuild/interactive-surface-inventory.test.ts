import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url));
const translucentToken = /\bcolors\.(?:bgSurface|bgElevated)\b/;
const interactiveTags = new Set(['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TextInput', 'Switch']);

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? tsxFiles(absolute) : entry.name.endsWith('.tsx') ? [absolute] : [];
  });
}

function inventoryInteractiveTransparency(file: string) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const styles = new Map<string, string>();
  const surfaceVariables = new Set<string>();
  const findings: string[] = [];

  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.initializer) {
      const initializer = node.initializer.getText(source);
      const isStyleSheet = ts.isCallExpression(node.initializer)
        && node.initializer.expression.getText(source).endsWith('StyleSheet.create')
        && node.initializer.arguments[0]
        && ts.isObjectLiteralExpression(node.initializer.arguments[0]);
      if (!isStyleSheet && translucentToken.test(initializer)) surfaceVariables.add(node.name.text);
      if (isStyleSheet && ts.isCallExpression(node.initializer) && ts.isObjectLiteralExpression(node.initializer.arguments[0])) {
        for (const property of node.initializer.arguments[0].properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          styles.set(property.name.getText(source).replace(/^['"]|['"]$/g, ''), property.initializer.getText(source));
        }
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  const inspect = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (interactiveTags.has(tag)) {
        const style = node.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'style');
        const expression = style && ts.isJsxAttribute(style) ? style.initializer?.getText(source) ?? '' : '';
        const referencedStyles = [...expression.matchAll(/\bstyles\.([A-Za-z0-9_]+)/g)].map((match) => match[1]);
        const referencedVariables = [...surfaceVariables].filter((name) => new RegExp(`\\b${name}\\b`).test(expression));
        const unsafeStyles = referencedStyles.filter((name) => translucentToken.test(styles.get(name) ?? ''));
        if (translucentToken.test(expression) || unsafeStyles.length || referencedVariables.length) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          findings.push(`${path.relative(sourceRoot, file)}:${line} <${tag}> ${[...unsafeStyles.map((name) => `styles.${name}`), ...referencedVariables].join(', ') || expression}`);
        }
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(source);

  for (const [name, body] of styles) {
    if (/(?:input|search|compose)/i.test(name) && translucentToken.test(body)) {
      findings.push(`${path.relative(sourceRoot, file)} styles.${name}`);
    }
  }
  return findings;
}

describe('opaque semantic mobile controls', () => {
  it('keeps every token-backed press, selection, and input surface opaque', () => {
    const findings = tsxFiles(sourceRoot).flatMap(inventoryInteractiveTransparency);
    assert.deepEqual(findings, [], `Translucent semantic controls:\n${findings.join('\n')}`);
  });
});
