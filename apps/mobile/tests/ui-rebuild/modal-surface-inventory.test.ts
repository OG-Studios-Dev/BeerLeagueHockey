import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

import colors from '../../src/theme/colors.ts';

const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url));
const translucentModalToken = /\bcolors\.(?:bgSurface|bgElevated)\b/;

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? tsxFiles(absolute) : entry.name.endsWith('.tsx') ? [absolute] : [];
  });
}

function inventoryModalTransparency(file: string) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const styles = new Map<string, string>();
  const findings: string[] = [];

  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)
      && node.initializer.expression.getText(source).endsWith('StyleSheet.create')
      && node.initializer.arguments[0]
      && ts.isObjectLiteralExpression(node.initializer.arguments[0])) {
      for (const property of node.initializer.arguments[0].properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        styles.set(property.name.getText(source).replace(/^['"]|['"]$/g, ''), property.initializer.getText(source));
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  const inspect = (node: ts.Node, insideModal = false) => {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) ? node : null;
    const nextInsideModal = insideModal || opening?.tagName.getText(source) === 'Modal';
    if (nextInsideModal && opening) {
      const style = opening.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'style');
      const expression = style && ts.isJsxAttribute(style) ? style.initializer?.getText(source) ?? '' : '';
      for (const match of expression.matchAll(/\bstyles\.([A-Za-z0-9_]+)/g)) {
        if (translucentModalToken.test(styles.get(match[1]) ?? '')) {
          const line = source.getLineAndCharacterOfPosition(opening.getStart(source)).line + 1;
          findings.push(`${path.relative(sourceRoot, file)}:${line} styles.${match[1]}`);
        }
      }
    }
    ts.forEachChild(node, (child) => inspect(child, nextInsideModal));
  };
  inspect(source);

  for (const [name, body] of styles) {
    if (/(?:modal|sheet|reader|dialog|drawer|popover)/i.test(name) && translucentModalToken.test(body)) {
      findings.push(`${path.relative(sourceRoot, file)} styles.${name}`);
    }
  }
  return [...new Set(findings)];
}

describe('opaque modal and reader surfaces', () => {
  it('uses an opaque modal token', () => {
    assert.equal(colors.bgModal, '#0A1628');
    assert.doesNotMatch(colors.bgModal, /rgba|hsla|transparent/i);
  });

  it('does not reuse translucent card tokens inside modal, sheet, or reader surfaces', () => {
    const findings = tsxFiles(sourceRoot).flatMap(inventoryModalTransparency);
    assert.deepEqual(findings, [], `Translucent modal surfaces:\n${findings.join('\n')}`);
  });
});
