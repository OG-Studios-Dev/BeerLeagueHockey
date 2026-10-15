import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

describe('Hockey Life Times server action exports', () => {
  it('exports only async runtime values from the use-server module', () => {
    const filename = path.resolve(__dirname, '../hockey-life-times.ts');
    const sourceText = fs.readFileSync(filename, 'utf8');
    const source = ts.createSourceFile(filename, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const violations: string[] = [];

    for (const statement of source.statements) {
      if (ts.isExportDeclaration(statement)) {
        if (!statement.isTypeOnly) {
          violations.push(statement.exportClause?.getText(source) || statement.moduleSpecifier?.getText(source) || '<export>');
        }
        continue;
      }
      const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      if (!exported) continue;

      if (ts.isFunctionDeclaration(statement)) {
        const isAsync = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
        if (!isAsync) violations.push(statement.name?.text || '<anonymous function>');
      } else if (ts.isVariableStatement(statement)) {
        violations.push(...statement.declarationList.declarations.map((declaration) => declaration.name.getText(source)));
      } else if (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) {
        violations.push(statement.getText(source));
      }
    }

    expect(violations).toEqual([]);
  });
});
