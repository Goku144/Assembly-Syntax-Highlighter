"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadInstructionForms = loadInstructionForms;
exports.validateInstructions = validateInstructions;
exports.validateInstruction = validateInstruction;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_1 = require("vscode-languageserver/node");
let forms = [];
let formsByMnemonic = new Map();
function loadInstructionForms(extensionRoot) {
    const formsPath = path.join(extensionRoot, "server", "assets", "x86_instruction_forms.json");
    try {
        forms = JSON.parse(fs.readFileSync(formsPath, "utf8"));
    }
    catch {
        forms = [];
        formsByMnemonic = new Map();
        return;
    }
    formsByMnemonic = new Map();
    for (const form of forms) {
        const list = formsByMnemonic.get(form.mnemonic) ?? [];
        list.push(form);
        formsByMnemonic.set(form.mnemonic, list);
    }
}
function validateInstructions(program, knownInstructions, macroNames) {
    const diagnostics = [];
    const context = {
        bits: inferBits(program),
        knownInstructions,
        macroNames,
        constantNames: collectConstantNames(program),
    };
    for (const statement of program.statements) {
        if (statement.kind !== "instruction" || !statement.mnemonic)
            continue;
        diagnostics.push(...validateInstruction(statement, context));
    }
    return diagnostics;
}
function validateInstruction(statement, context) {
    const mnemonic = statement.mnemonic?.toLowerCase() ?? "";
    if (context.macroNames.has(mnemonic))
        return [];
    if (isClearlyNonX86Statement(statement))
        return [];
    const candidates = (formsByMnemonic.get(mnemonic) ?? []).filter(form => !form.mode || form.mode === "any" || form.mode === context.bits);
    if (candidates.length === 0) {
        if (context.knownInstructions.has(mnemonic) || isConditionalJump(mnemonic))
            return [];
        return [error(statement.range, `Unknown instruction or macro '${mnemonic}'.`)];
    }
    const actual = statement.operands.map(operand => classifyOperand(operand, context));
    const operandErrors = actual.flatMap(operand => operand.errors);
    if (operandErrors.length > 0)
        return operandErrors;
    if (candidates.some(form => operandsMatch(form.operands, actual)))
        return [];
    return [error(statement.range, explainBestMismatch(mnemonic, candidates, actual))];
}
function operandsMatch(expected, actual) {
    if (expected.length !== actual.length)
        return false;
    return expected.every((pattern, index) => {
        const operand = actual[index];
        if (pattern.kind !== operand.kind) {
            if (!(pattern.kind === "rel" && operand.kind === "imm"))
                return false;
        }
        if (pattern.class && pattern.class !== operand.class)
            return false;
        if (pattern.width && operand.width && pattern.width !== operand.width)
            return false;
        if (pattern.widthFrom !== undefined) {
            const source = actual[pattern.widthFrom];
            if (source?.width && operand.width && source.width !== operand.width)
                return false;
        }
        return true;
    });
}
function classifyOperand(operand, context) {
    const text = operand.text.trim();
    const register = classifyRegister(text);
    if (register)
        return { kind: "reg", text, range: operand.range, errors: [], ...register };
    if (/^\[.*\]$/.test(text) || /^(?:byte|word|dword|qword|tword|oword|xmmword|ymmword|zmmword)\s+/i.test(text)) {
        return classifyMemory(operand, context);
    }
    if (/^\$?-?(?:0x[0-9a-f]+|0b[01]+|[0-9]+|'.*'|".*")$/i.test(text)) {
        return { kind: "imm", text, range: operand.range, errors: [] };
    }
    if (isKnownConstantExpression(text, context.constantNames)) {
        return { kind: "imm", text, range: operand.range, errors: [] };
    }
    if (/^[A-Za-z_.$?@][A-Za-z0-9_.$?@]*(?:[+\-][A-Za-z0-9_.$?@]+)*$/.test(text)) {
        return { kind: "rel", text, range: operand.range, errors: [] };
    }
    return { kind: "unknown", text, range: operand.range, errors: [] };
}
function classifyMemory(operand, context) {
    const text = operand.text.trim();
    const errors = [];
    const sizeMatch = text.match(/^(byte|word|dword|qword|tword|oword|xmmword|ymmword|zmmword)\s+/i);
    const width = sizeMatch ? memoryWidth(sizeMatch[1].toLowerCase()) : undefined;
    const bracketMatch = text.match(/\[(.*)\]/);
    if (!bracketMatch) {
        errors.push(error(operand.range, "Invalid memory operand; NASM memory references must use '[' and ']' around the address expression."));
        return { kind: "mem", width, text, range: operand.range, errors };
    }
    const expression = bracketMatch[1];
    const registers = expression.match(/\b(?:r(?:1[0-5]|[8-9])(?:b|w|d)?|[er]?(?:ax|bx|cx|dx|si|di|bp|sp)|[abcd][hl]|[sd]il|[sb]pl|xmm\d+|ymm\d+|zmm\d+)\b/gi) ?? [];
    for (const reg of registers) {
        const classified = classifyRegister(reg);
        if (!classified || classified.class !== "gpr") {
            errors.push(error(operand.range, `Register '${reg}' cannot be used in a NASM memory address.`));
            continue;
        }
        if (context.bits === "64" && classified.width && classified.width < 64 && !["eax", "ebx", "ecx", "edx", "esi", "edi", "ebp", "esp"].includes(reg.toLowerCase())) {
            errors.push(error(operand.range, `Register '${reg}' is not a valid ${context.bits}-bit address register.`));
        }
    }
    const scales = expression.match(/\*\s*([0-9]+)/g) ?? [];
    for (const scale of scales) {
        const value = Number(scale.replace(/[^0-9]/g, ""));
        if (![1, 2, 4, 8].includes(value)) {
            errors.push(error(operand.range, `Invalid NASM memory scale ${value}; expected 1, 2, 4, or 8.`));
        }
    }
    return { kind: "mem", width, text, range: operand.range, errors };
}
function classifyRegister(text) {
    const lower = text.toLowerCase();
    if (/^(?:al|ah|bl|bh|cl|ch|dl|dh|sil|dil|spl|bpl|r(?:[8-9]|1[0-5])b)$/.test(lower))
        return { width: 8, class: "gpr" };
    if (/^(?:ax|bx|cx|dx|si|di|sp|bp|r(?:[8-9]|1[0-5])w)$/.test(lower))
        return { width: 16, class: "gpr" };
    if (/^(?:eax|ebx|ecx|edx|esi|edi|esp|ebp|r(?:[8-9]|1[0-5])d)$/.test(lower))
        return { width: 32, class: "gpr" };
    if (/^(?:rax|rbx|rcx|rdx|rsi|rdi|rsp|rbp|r(?:[8-9]|1[0-5]))$/.test(lower))
        return { width: 64, class: "gpr" };
    if (/^xmm(?:[0-9]|[12][0-9]|3[01])$/.test(lower))
        return { width: 128, class: "xmm" };
    if (/^ymm(?:[0-9]|[12][0-9]|3[01])$/.test(lower))
        return { width: 256, class: "ymm" };
    if (/^zmm(?:[0-9]|[12][0-9]|3[01])$/.test(lower))
        return { width: 512, class: "zmm" };
    if (/^(?:cs|ds|ss|es|fs|gs)$/.test(lower))
        return { width: 16, class: "segment" };
    if (/^(?:cr[0-8]|dr[0-7])$/.test(lower))
        return { width: 64, class: "control" };
    return undefined;
}
function inferBits(program) {
    for (const statement of program.statements) {
        if (statement.kind === "instruction" && statement.mnemonic === "bits" && statement.operands[0]) {
            const value = statement.operands[0].text;
            if (value === "16" || value === "32" || value === "64")
                return value;
        }
        if (statement.kind === "directive" && statement.directive === "bits" && statement.operands[0]) {
            const value = statement.operands[0].text;
            if (value === "16" || value === "32" || value === "64")
                return value;
        }
    }
    return "64";
}
function collectConstantNames(program) {
    const names = new Set();
    for (const statement of program.statements) {
        if (statement.kind === "equ" && statement.label) {
            names.add(statement.label);
        }
        if (statement.kind === "directive" && statement.operands[0]) {
            switch (statement.directive) {
                case "%define":
                case "%xdefine":
                case "%ixdefine":
                case "%assign":
                case "%iassign":
                    names.add(statement.operands[0].text);
                    break;
            }
        }
    }
    return names;
}
function isKnownConstantExpression(text, constantNames) {
    const withoutLiterals = text
        .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, " ")
        .replace(/\$?-?(?:0x[0-9a-f]+|0b[01]+|0o[0-7]+|[0-9][0-9a-f]*h|[0-9]+d?)/gi, " ");
    const symbolPattern = /[A-Za-z_.$?@][A-Za-z0-9_.$?@]*/g;
    let sawConstant = false;
    let match = symbolPattern.exec(withoutLiterals);
    while (match) {
        if (!constantNames.has(match[0]))
            return false;
        sawConstant = true;
        match = symbolPattern.exec(withoutLiterals);
    }
    return sawConstant && /^[A-Za-z0-9_.$?@\s+\-*/%()'"]+$/.test(text);
}
function memoryWidth(size) {
    switch (size) {
        case "byte": return 8;
        case "word": return 16;
        case "dword": return 32;
        case "qword": return 64;
        case "tword": return 80;
        case "oword":
        case "xmmword": return 128;
        case "ymmword": return 256;
        case "zmmword": return 512;
        default: return undefined;
    }
}
function explainBestMismatch(mnemonic, candidates, actual) {
    const actualText = actual.map(formatActual).join(", ") || "no operands";
    const expected = candidates.map(form => form.operands.map(formatPattern).join(", ") || "no operands").join(" | ");
    return `${mnemonic} operands do not match any known NASM/x86 form. Got ${actualText}; expected ${expected}.`;
}
function formatActual(operand) {
    return operand.width ? `${operand.kind}${operand.width}` : operand.kind;
}
function formatPattern(pattern) {
    const width = pattern.width ? `${pattern.width}` : "";
    const cls = pattern.class ? `:${pattern.class}` : "";
    return `${pattern.kind}${width}${cls}`;
}
function isConditionalJump(mnemonic) {
    return /^j(?:a|ae|b|be|c|e|g|ge|l|le|na|nae|nb|nbe|nc|ne|ng|nge|nl|nle|no|np|ns|nz|o|p|pe|po|s|z|cxz|ecxz|rcxz)$/.test(mnemonic);
}
function isClearlyNonX86Statement(statement) {
    const mnemonic = statement.mnemonic?.toLowerCase() ?? "";
    const operands = statement.operands.map(operand => operand.text.trim().toLowerCase());
    const operandText = operands.join(", ");
    if (isArmOrAarch64Statement(mnemonic, operands, operandText))
        return true;
    if (isRiscVStatement(mnemonic, operands, operandText))
        return true;
    if (isMipsStatement(mnemonic, operands, operandText))
        return true;
    return false;
}
function isArmOrAarch64Statement(mnemonic, operands, operandText) {
    if (operands.some(operand => /^\{.*\}$/.test(operand)))
        return true;
    if (operands.some(operand => /^#/.test(operand)))
        return true;
    if (operands.some(operand => /:[a-z][a-z0-9_]*:/i.test(operand)))
        return true;
    if (operands.some(isAarch64Register))
        return true;
    const armOnlyMnemonics = new Set([
        "adr", "adrp", "b", "bl", "bx", "cbnz", "cbz", "ldr", "ldp", "str", "stp", "svc", "tbnz", "tbz",
    ]);
    if (armOnlyMnemonics.has(mnemonic))
        return true;
    return /\b(?:r(?:1[0-5]|[0-9])|lr|pc)\b/.test(operandText) && /[{}#]/.test(operandText);
}
function isAarch64Register(text) {
    return /^(?:[wx](?:[0-9]|[12][0-9]|3[01])|[wx]zr|[wx]sp)$/.test(text);
}
function isRiscVStatement(mnemonic, operands, operandText) {
    const riscVMnemonics = new Set([
        "addi", "auipc", "beq", "bge", "bgeu", "blt", "bltu", "bne", "ecall", "fence", "jal", "jalr",
        "lb", "lbu", "ld", "lh", "lhu", "li", "lui", "lw", "lwu", "sb", "sd", "sh", "sw",
    ]);
    if (riscVMnemonics.has(mnemonic))
        return true;
    return operands.some(isRiscVRegister) || /\b(?:zero|ra|gp|tp|fp|s(?:[0-9]|1[01])|a[0-7]|t[0-6])\b/.test(operandText);
}
function isRiscVRegister(text) {
    return /^(?:x(?:[0-9]|[12][0-9]|3[01])|zero|ra|gp|tp|fp|s(?:[0-9]|1[01])|a[0-7]|t[0-6])$/.test(text);
}
function isMipsStatement(mnemonic, operands, operandText) {
    const mipsMnemonics = new Set(["jr", "jal", "jalr", "la", "lb", "lbu", "lh", "lhu", "li", "lw", "sb", "sh", "sw"]);
    if (mipsMnemonics.has(mnemonic) && operands.some(operand => operand.startsWith("$")))
        return true;
    return /\$(?:zero|at|v[01]|a[0-3]|t[0-9]|s[0-7]|k[01]|gp|sp|fp|ra)\b/.test(operandText);
}
function error(range, message) {
    return { range, message, severity: node_1.DiagnosticSeverity.Error, source: "nasm-lsp" };
}
//# sourceMappingURL=instructionValidator.js.map