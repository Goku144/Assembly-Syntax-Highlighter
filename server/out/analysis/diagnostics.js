"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectDiagnostics = collectDiagnostics;
const node_1 = require("vscode-languageserver/node");
const instructionValidator_1 = require("./instructionValidator");
const DIRECTIVE_ARITY = new Map([
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
function collectDiagnostics(program, index, knownInstructions) {
    const diagnostics = program.diagnostics.map(item => ({
        range: item.range,
        message: item.message,
        severity: item.severity === "error" ? node_1.DiagnosticSeverity.Error : node_1.DiagnosticSeverity.Warning,
        source: "nasm-lsp",
    }));
    for (const statement of program.statements) {
        if (statement.kind === "directive") {
            diagnostics.push(...validateDirective(statement.directive ?? "", statement.operands.length, statement.range));
        }
    }
    diagnostics.push(...(0, instructionValidator_1.validateInstructions)(program, knownInstructions, index.macroNames()));
    return diagnostics;
}
function validateDirective(name, count, range) {
    const rule = DIRECTIVE_ARITY.get(name);
    if (!rule)
        return [];
    if (count < rule.min || (rule.max !== undefined && count > rule.max)) {
        const expected = rule.max === undefined || rule.max !== rule.min
            ? `${rule.min}${rule.max === undefined ? "+" : `-${rule.max}`} operands`
            : `${rule.min} operands`;
        return [{
                range,
                message: `${name} expects ${expected}; got ${count}.`,
                severity: node_1.DiagnosticSeverity.Error,
                source: "nasm-lsp",
            }];
    }
    return [];
}
//# sourceMappingURL=diagnostics.js.map