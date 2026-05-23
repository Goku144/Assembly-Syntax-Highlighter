import * as fs from "node:fs";
import * as path from "node:path";
import { Diagnostic, DiagnosticSeverity, Range } from "vscode-languageserver/node";
import { ParsedProgram, ParsedStatement, RawOperand } from "../parser/ast";

type Bits = "16" | "32" | "64";
type OperandKind = "reg" | "mem" | "imm" | "rel" | "unknown";
type RegisterClass = "gpr" | "xmm" | "ymm" | "zmm" | "segment" | "control";

type OperandPattern = {
  kind: OperandKind;
  width?: number;
  widthFrom?: number;
  class?: RegisterClass;
};

type InstructionForm = {
  mnemonic: string;
  mode?: Bits | "any";
  operands: OperandPattern[];
};

type ActualOperand = {
  kind: OperandKind;
  width?: number;
  class?: RegisterClass;
  text: string;
  range: Range;
  errors: Diagnostic[];
};

type ValidationContext = {
  bits: Bits;
  knownInstructions: Set<string>;
  macroNames: Set<string>;
  constantNames: Set<string>;
};

let forms: InstructionForm[] = [];
let formsByMnemonic = new Map<string, InstructionForm[]>();

export function loadInstructionForms(extensionRoot: string) {
  const formsPath = path.join(extensionRoot, "server", "assets", "x86_instruction_forms.json");
  try {
    forms = JSON.parse(fs.readFileSync(formsPath, "utf8")) as InstructionForm[];
  } catch {
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

export function validateInstructions(program: ParsedProgram, knownInstructions: Set<string>, macroNames: Set<string>) {
  const diagnostics: Diagnostic[] = [];
  const context: ValidationContext = {
    bits: inferBits(program),
    knownInstructions,
    macroNames,
    constantNames: collectConstantNames(program),
  };

  for (const statement of program.statements) {
    if (statement.kind !== "instruction" || !statement.mnemonic) continue;
    diagnostics.push(...validateInstruction(statement, context));
  }

  return diagnostics;
}

export function validateInstruction(statement: ParsedStatement, context: ValidationContext): Diagnostic[] {
  const mnemonic = statement.mnemonic?.toLowerCase() ?? "";
  if (context.macroNames.has(mnemonic)) return [];
  if (isClearlyNonX86Statement(statement)) return [];

  const candidates = (formsByMnemonic.get(mnemonic) ?? []).filter(
    form => !form.mode || form.mode === "any" || form.mode === context.bits
  );

  if (candidates.length === 0) {
    if (context.knownInstructions.has(mnemonic) || isConditionalJump(mnemonic)) return [];
    return [error(statement.range, `Unknown instruction or macro '${mnemonic}'.`)];
  }

  const actual = statement.operands.map(operand => classifyOperand(operand, context));
  const operandErrors = actual.flatMap(operand => operand.errors);
  if (operandErrors.length > 0) return operandErrors;

  if (candidates.some(form => operandsMatch(form.operands, actual))) return [];

  return [error(statement.range, explainBestMismatch(mnemonic, candidates, actual))];
}

function operandsMatch(expected: OperandPattern[], actual: ActualOperand[]) {
  if (expected.length !== actual.length) return false;

  return expected.every((pattern, index) => {
    const operand = actual[index];
    if (pattern.kind !== operand.kind) {
      if (!(pattern.kind === "rel" && operand.kind === "imm")) return false;
    }
    if (pattern.class && pattern.class !== operand.class) return false;
    if (pattern.width && operand.width && pattern.width !== operand.width) return false;
    if (pattern.widthFrom !== undefined) {
      const source = actual[pattern.widthFrom];
      if (source?.width && operand.width && source.width !== operand.width) return false;
    }
    return true;
  });
}

function classifyOperand(operand: RawOperand, context: ValidationContext): ActualOperand {
  const text = operand.text.trim();
  const register = classifyRegister(text);
  if (register) return { kind: "reg", text, range: operand.range, errors: [], ...register };

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

function classifyMemory(operand: RawOperand, context: ValidationContext): ActualOperand {
  const text = operand.text.trim();
  const errors: Diagnostic[] = [];
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

function classifyRegister(text: string): { width: number; class: RegisterClass } | undefined {
  const lower = text.toLowerCase();
  if (/^(?:al|ah|bl|bh|cl|ch|dl|dh|sil|dil|spl|bpl|r(?:[8-9]|1[0-5])b)$/.test(lower)) return { width: 8, class: "gpr" };
  if (/^(?:ax|bx|cx|dx|si|di|sp|bp|r(?:[8-9]|1[0-5])w)$/.test(lower)) return { width: 16, class: "gpr" };
  if (/^(?:eax|ebx|ecx|edx|esi|edi|esp|ebp|r(?:[8-9]|1[0-5])d)$/.test(lower)) return { width: 32, class: "gpr" };
  if (/^(?:rax|rbx|rcx|rdx|rsi|rdi|rsp|rbp|r(?:[8-9]|1[0-5]))$/.test(lower)) return { width: 64, class: "gpr" };
  if (/^xmm(?:[0-9]|[12][0-9]|3[01])$/.test(lower)) return { width: 128, class: "xmm" };
  if (/^ymm(?:[0-9]|[12][0-9]|3[01])$/.test(lower)) return { width: 256, class: "ymm" };
  if (/^zmm(?:[0-9]|[12][0-9]|3[01])$/.test(lower)) return { width: 512, class: "zmm" };
  if (/^(?:cs|ds|ss|es|fs|gs)$/.test(lower)) return { width: 16, class: "segment" };
  if (/^(?:cr[0-8]|dr[0-7])$/.test(lower)) return { width: 64, class: "control" };
  return undefined;
}

function inferBits(program: ParsedProgram): Bits {
  for (const statement of program.statements) {
    if (statement.kind === "instruction" && statement.mnemonic === "bits" && statement.operands[0]) {
      const value = statement.operands[0].text;
      if (value === "16" || value === "32" || value === "64") return value;
    }
    if (statement.kind === "directive" && statement.directive === "bits" && statement.operands[0]) {
      const value = statement.operands[0].text;
      if (value === "16" || value === "32" || value === "64") return value;
    }
  }
  return "64";
}

function collectConstantNames(program: ParsedProgram) {
  const names = new Set<string>();
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

function isKnownConstantExpression(text: string, constantNames: Set<string>) {
  const withoutLiterals = text
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/\$?-?(?:0x[0-9a-f]+|0b[01]+|0o[0-7]+|[0-9][0-9a-f]*h|[0-9]+d?)/gi, " ");
  const symbolPattern = /[A-Za-z_.$?@][A-Za-z0-9_.$?@]*/g;
  let sawConstant = false;
  let match = symbolPattern.exec(withoutLiterals);
  while (match) {
    if (!constantNames.has(match[0])) return false;
    sawConstant = true;
    match = symbolPattern.exec(withoutLiterals);
  }

  return sawConstant && /^[A-Za-z0-9_.$?@\s+\-*/%()'"]+$/.test(text);
}

function memoryWidth(size: string) {
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

function explainBestMismatch(mnemonic: string, candidates: InstructionForm[], actual: ActualOperand[]) {
  const actualText = actual.map(formatActual).join(", ") || "no operands";
  const expected = candidates.map(form => form.operands.map(formatPattern).join(", ") || "no operands").join(" | ");
  return `${mnemonic} operands do not match any known NASM/x86 form. Got ${actualText}; expected ${expected}.`;
}

function formatActual(operand: ActualOperand) {
  return operand.width ? `${operand.kind}${operand.width}` : operand.kind;
}

function formatPattern(pattern: OperandPattern) {
  const width = pattern.width ? `${pattern.width}` : "";
  const cls = pattern.class ? `:${pattern.class}` : "";
  return `${pattern.kind}${width}${cls}`;
}

function isConditionalJump(mnemonic: string) {
  return /^j(?:a|ae|b|be|c|e|g|ge|l|le|na|nae|nb|nbe|nc|ne|ng|nge|nl|nle|no|np|ns|nz|o|p|pe|po|s|z|cxz|ecxz|rcxz)$/.test(mnemonic);
}

function isClearlyNonX86Statement(statement: ParsedStatement) {
  const mnemonic = statement.mnemonic?.toLowerCase() ?? "";
  const operands = statement.operands.map(operand => operand.text.trim().toLowerCase());
  const operandText = operands.join(", ");

  if (isArmOrAarch64Statement(mnemonic, operands, operandText)) return true;
  if (isRiscVStatement(mnemonic, operands, operandText)) return true;
  if (isMipsStatement(mnemonic, operands, operandText)) return true;

  return false;
}

function isArmOrAarch64Statement(mnemonic: string, operands: string[], operandText: string) {
  if (operands.some(operand => /^\{.*\}$/.test(operand))) return true;
  if (operands.some(operand => /^#/.test(operand))) return true;
  if (operands.some(operand => /:[a-z][a-z0-9_]*:/i.test(operand))) return true;
  if (operands.some(isAarch64Register)) return true;

  const armOnlyMnemonics = new Set([
    "adr", "adrp", "b", "bl", "bx", "cbnz", "cbz", "ldr", "ldp", "str", "stp", "svc", "tbnz", "tbz",
  ]);
  if (armOnlyMnemonics.has(mnemonic)) return true;

  return /\b(?:r(?:1[0-5]|[0-9])|lr|pc)\b/.test(operandText) && /[{}#]/.test(operandText);
}

function isAarch64Register(text: string) {
  return /^(?:[wx](?:[0-9]|[12][0-9]|3[01])|[wx]zr|[wx]sp)$/.test(text);
}

function isRiscVStatement(mnemonic: string, operands: string[], operandText: string) {
  const riscVMnemonics = new Set([
    "addi", "auipc", "beq", "bge", "bgeu", "blt", "bltu", "bne", "ecall", "fence", "jal", "jalr",
    "lb", "lbu", "ld", "lh", "lhu", "li", "lui", "lw", "lwu", "sb", "sd", "sh", "sw",
  ]);
  if (riscVMnemonics.has(mnemonic)) return true;

  return operands.some(isRiscVRegister) || /\b(?:zero|ra|gp|tp|fp|s(?:[0-9]|1[01])|a[0-7]|t[0-6])\b/.test(operandText);
}

function isRiscVRegister(text: string) {
  return /^(?:x(?:[0-9]|[12][0-9]|3[01])|zero|ra|gp|tp|fp|s(?:[0-9]|1[01])|a[0-7]|t[0-6])$/.test(text);
}

function isMipsStatement(mnemonic: string, operands: string[], operandText: string) {
  const mipsMnemonics = new Set(["jr", "jal", "jalr", "la", "lb", "lbu", "lh", "lhu", "li", "lw", "sb", "sh", "sw"]);
  if (mipsMnemonics.has(mnemonic) && operands.some(operand => operand.startsWith("$"))) return true;

  return /\$(?:zero|at|v[01]|a[0-3]|t[0-9]|s[0-7]|k[01]|gp|sp|fp|ra)\b/.test(operandText);
}

function error(range: Range, message: string): Diagnostic {
  return { range, message, severity: DiagnosticSeverity.Error, source: "nasm-lsp" };
}
