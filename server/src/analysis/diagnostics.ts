import { Diagnostic, DiagnosticSeverity, Range } from "vscode-languageserver/node";
import { ParsedProgram } from "../parser/ast";
import { validateInstructions } from "./instructionValidator";
import { WorkspaceIndex } from "./symbolTable";

const DIRECTIVE_ARITY = new Map<string, { min: number; max?: number }>([
  ["%define", { min: 2 }],
  ["%xdefine", { min: 2 }],
  ["%ixdefine", { min: 2 }],
  ["%assign", { min: 2, max: 2 }],
  ["%iassign", { min: 2, max: 2 }],
  ["%undef", { min: 1, max: 1 }],
  ["%include", { min: 1, max: 1 }],
  ["%macro", { min: 2, max: 2 }],
  ["%imacro", { min: 2, max: 2 }],
  ["%endmacro", { min: 0, max: 0 }],
  ["%if", { min: 1 }],
  ["%ifdef", { min: 1, max: 1 }],
  ["%ifndef", { min: 1, max: 1 }],
  ["%endif", { min: 0, max: 0 }],
]);

export function collectDiagnostics(program: ParsedProgram, index: WorkspaceIndex, knownInstructions: Set<string>): Diagnostic[] {
  const diagnostics: Diagnostic[] = program.diagnostics.map(item => ({
    range: item.range,
    message: item.message,
    severity: item.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
    source: "nasm-lsp",
  }));

  for (const statement of program.statements) {
    if (statement.kind === "directive") {
      diagnostics.push(...validateDirective(statement.directive ?? "", statement.operands.length, statement.range));
    }
  }

  diagnostics.push(...validateInstructions(program, knownInstructions, index.macroNames()));
  return diagnostics;
}

function validateDirective(name: string, count: number, range: Range): Diagnostic[] {
  const rule = DIRECTIVE_ARITY.get(name);
  if (!rule) return [];
  if (count < rule.min || (rule.max !== undefined && count > rule.max)) {
    const expected = rule.max === undefined || rule.max !== rule.min
      ? `${rule.min}${rule.max === undefined ? "+" : `-${rule.max}`} operands`
      : `${rule.min} operands`;
    return [{
      range,
      message: `${name} expects ${expected}; got ${count}.`,
      severity: DiagnosticSeverity.Error,
      source: "nasm-lsp",
    }];
  }
  return [];
}
