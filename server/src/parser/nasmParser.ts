import { existsSync } from "node:fs";
import * as path from "node:path";
import { Position, Range } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DocComment, ParsedProgram, ParsedStatement, RawOperand, StructuralDiagnostic } from "./ast";

const SYMBOL = "[A-Za-z_.$?@][A-Za-z0-9_.$?@]*";
const STORAGE = new Set([
  "db", "dw", "dd", "dq", "dt", "do", "dy", "dz",
  "resb", "resw", "resd", "resq", "rest", "reso", "resy", "resz",
  "byte", "word", "dword", "qword", "tword", "oword", "yword", "zword",
]);
const DIRECTIVES = new Set([
  "%define", "%xdefine", "%ixdefine", "%assign", "%iassign", "%undef",
  "%include", "%ifdef", "%ifndef", "%if", "%elif", "%else", "%endif",
  "%macro", "%imacro", "%endmacro", "%rep", "%endrep", "%local",
  "absolute", "align", "bits", "common", "cpu", "default", "end", "extern",
  "global", "group", "import", "export", "library", "module", "org", "public",
  "rel", "abs", "section", "segment", "use16", "use32", "use64",
]);

let treeSitterParser: { parse(text: string): { rootNode: TreeSitterNode } } | undefined;

export async function initNasmParser(extensionRoot: string) {
  const wasmPath = path.join(extensionRoot, "server", "assets", "tree-sitter-nasm.wasm");
  if (!existsSync(wasmPath)) return;

  try {
    const Parser = require("web-tree-sitter");
    await Parser.init();
    const language = await Parser.Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(language);
    treeSitterParser = parser;
  } catch {
    treeSitterParser = undefined;
  }
}

export function parseNasmDocument(document: TextDocument): ParsedProgram {
  const text = document.getText();
  const lines = text.split(/\r?\n/);
  const diagnostics: StructuralDiagnostic[] = treeSitterParser
    ? collectTreeSitterErrors(treeSitterParser.parse(text).rootNode, lines)
    : [];
  const statements: ParsedStatement[] = [];
  const commentRanges: Range[] = [];
  const docComments = collectDocComments(lines);
  let offset = 0;
  let inBlockComment = false;

  for (let line = 0; line < lines.length; line++) {
    const rawLine = lines[line];
    const stripped = stripCommentsFromLine(rawLine, line, inBlockComment);
    inBlockComment = stripped.inBlockComment;
    commentRanges.push(...stripped.ranges);
    const code = stripped.code;
    const parsed = parseLine(document, line, offset, rawLine, code, diagnostics);
    for (const statement of parsed) {
      if (statement.kind !== "empty" && docComments.has(statement.line)) {
        statement.documentation = docComments.get(statement.line);
      }
    }
    statements.push(...parsed);
    offset += rawLine.length + newlineWidth(text, offset + rawLine.length);
  }

  return { uri: document.uri, text, statements, diagnostics, commentRanges };
}

function stripCommentsFromLine(line: string, lineNumber: number, startsInBlockComment: boolean) {
  const chars = [...line];
  const ranges: Range[] = [];
  let quote: string | undefined;
  let inBlockComment = startsInBlockComment;
  let i = 0;

  while (i < chars.length) {
    if (inBlockComment) {
      const end = line.indexOf("*/", i);
      const rangeEnd = end === -1 ? chars.length : end + 2;
      blank(chars, i, rangeEnd);
      ranges.push(Range.create(Position.create(lineNumber, i), Position.create(lineNumber, rangeEnd)));
      if (end === -1) return { code: chars.join(""), ranges, inBlockComment: true };
      inBlockComment = false;
      i = rangeEnd;
      continue;
    }

    const char = chars[i];
    if ((char === "\"" || char === "'") && chars[i - 1] !== "\\") {
      quote = quote === char ? undefined : quote ?? char;
      i++;
      continue;
    }
    if (quote) {
      i++;
      continue;
    }

    if (char === "/" && chars[i + 1] === "*") {
      inBlockComment = true;
      continue;
    }

    if (char === ";") {
      blank(chars, i, chars.length);
      ranges.push(Range.create(Position.create(lineNumber, i), Position.create(lineNumber, line.length)));
      return { code: chars.join(""), ranges, inBlockComment: false };
    }

    if (char === "@" && (i === 0 || /\s/.test(chars[i - 1]))) {
      blank(chars, i, chars.length);
      ranges.push(Range.create(Position.create(lineNumber, i), Position.create(lineNumber, line.length)));
      return { code: chars.join(""), ranges, inBlockComment: false };
    }

    i++;
  }

  return { code: chars.join(""), ranges, inBlockComment };
}

function blank(chars: string[], start: number, end: number) {
  for (let i = start; i < end; i++) chars[i] = " ";
}

type TreeSitterNode = {
  type: string;
  isMissing(): boolean;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  namedChildCount: number;
  namedChild(index: number): TreeSitterNode | null;
};

function collectTreeSitterErrors(root: TreeSitterNode, lines: string[]): StructuralDiagnostic[] {
  const diagnostics: StructuralDiagnostic[] = [];

  function visit(node: TreeSitterNode) {
    if (node.type === "ERROR" || node.isMissing()) {
      const line = lines[node.startPosition.row] ?? "";
      if (/^\s*\.cfi_[A-Za-z_]+\b/.test(stripComment(line))) return;
      diagnostics.push({
        message: node.isMissing()
          ? `Missing NASM syntax element: ${node.type}`
          : "Invalid NASM syntax.",
        range: Range.create(
          Position.create(node.startPosition.row, node.startPosition.column),
          Position.create(node.endPosition.row, node.endPosition.column)
        ),
        severity: "error",
      });
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) visit(child);
    }
  }

  visit(root);
  return diagnostics;
}

function collectDocComments(lines: string[]): Map<number, DocComment> {
  const docs = new Map<number, DocComment>();
  let pending: string[] = [];

  for (let line = 0; line < lines.length; line++) {
    const raw = lines[line];
    const text = docCommentText(raw);
    if (text !== undefined) {
      pending.push(text);
      continue;
    }

    if (!raw.trim()) {
      if (pending.length) pending = [];
      continue;
    }

    if (pending.length && startsStatement(raw)) {
      docs.set(line, parseDocComment(pending));
    }
    pending = [];
  }

  return docs;
}

function docCommentText(line: string): string | undefined {
  const match = line.match(/^\s*;\s?(.*)$/);
  if (!match) return undefined;
  const text = match[1].trim();
  if (/^(?:@(?:brief|param|return|returns|note)\b|note:)/i.test(text)) return text;
  return undefined;
}

function parseDocComment(lines: string[]): DocComment {
  const doc: DocComment = { params: [], notes: [], raw: lines };
  for (const line of lines) {
    let match = line.match(/^@brief\s+(.*)$/i);
    if (match) {
      doc.brief = appendDocText(doc.brief, match[1]);
      continue;
    }

    match = line.match(/^@param\s+(?:(\S+)\s+)?(.*)$/i);
    if (match) {
      doc.params.push({ name: match[1], description: match[2].trim() });
      continue;
    }

    match = line.match(/^@returns?\s+(.*)$/i);
    if (match) {
      doc.returns = appendDocText(doc.returns, match[1]);
      continue;
    }

    match = line.match(/^(?:@note\b|note:)\s*(.*)$/i);
    if (match) {
      doc.notes.push(match[1].trim());
    }
  }
  return doc;
}

function appendDocText(existing: string | undefined, next: string) {
  return existing ? `${existing} ${next.trim()}` : next.trim();
}

function startsStatement(line: string) {
  const code = stripComment(line);
  return Boolean(firstToken(code));
}

function parseLine(
  document: TextDocument,
  line: number,
  lineOffset: number,
  rawLine: string,
  code: string,
  diagnostics: StructuralDiagnostic[]
): ParsedStatement[] {
  const statements: ParsedStatement[] = [];
  let rest = code;
  let localOffset = 0;

  while (true) {
    const labelMatch = rest.match(new RegExp(`^\\s*(${SYMBOL}):`));
    if (!labelMatch || labelMatch.index !== 0) break;

    const name = labelMatch[1];
    const start = lineOffset + rest.indexOf(name);
    const end = start + name.length + 1;
    statements.push(makeStatement(document, "label", line, rawLine, start, end, {
      label: name,
      operands: [],
    }));

    localOffset += labelMatch[0].length;
    rest = code.slice(localOffset);
  }

  if (!rest.trim()) {
    if (statements.length === 0) {
      statements.push(makeStatement(document, "empty", line, rawLine, lineOffset, lineOffset, { operands: [] }));
    }
    return statements;
  }

  const first = firstToken(rest);
  if (!first) return statements;

  const tokenStart = lineOffset + localOffset + first.start;
  const tokenEnd = tokenStart + first.text.length;
  const tail = rest.slice(first.end);
  const operands = splitOperands(document, tail, tokenEnd, diagnostics);
  const lower = first.text.toLowerCase();

  if (looksLikeOperand(first.text) && !isRegisterNamedInstruction(lower)) {
    statements.push(makeStatement(document, "invalid", line, rawLine, tokenStart, lineOffset + code.length, {
      operands,
      message: "Expected instruction, label, directive, or macro invocation.",
    }));
    diagnostics.push({
      message: "Expected instruction, label, directive, or macro invocation.",
      range: Range.create(document.positionAt(tokenStart), document.positionAt(Math.max(tokenEnd, lineOffset + code.length))),
      severity: "error",
    });
    return statements;
  }

  const second = firstToken(tail);
  const secondLower = second?.text.toLowerCase() ?? "";
  if (STORAGE.has(secondLower)) {
    const dataStart = tokenStart;
    const storageStart = tokenEnd + (second?.start ?? 0);
    const dataOperands = splitOperands(document, tail.slice((second?.end ?? 0)), storageStart + secondLower.length, diagnostics);
    statements.push(makeStatement(document, "data", line, rawLine, dataStart, lineOffset + code.length, {
      label: first.text,
      mnemonic: secondLower,
      operands: dataOperands,
    }));
    return statements;
  }

  if (secondLower === "equ" || secondLower === "=") {
    const valueStart = tokenEnd + (second?.end ?? 0);
    const valueOperands = splitOperands(document, tail.slice(second?.end ?? 0), valueStart, diagnostics);
    statements.push(makeStatement(document, "equ", line, rawLine, tokenStart, lineOffset + code.length, {
      label: first.text,
      mnemonic: secondLower,
      operands: valueOperands,
    }));
    return statements;
  }

  if (lower.startsWith("%") || lower.startsWith(".") || DIRECTIVES.has(lower)) {
    const directiveOperands = splitDirectiveOperands(document, lower, tail, tokenEnd, diagnostics);
    statements.push(makeStatement(document, "directive", line, rawLine, tokenStart, lineOffset + code.length, {
      directive: lower,
      operands: directiveOperands,
    }));
    return statements;
  }

  statements.push(makeStatement(document, "instruction", line, rawLine, tokenStart, lineOffset + code.length, {
    mnemonic: lower,
    operands,
  }));
  return statements;
}

function makeStatement(
  document: TextDocument,
  kind: ParsedStatement["kind"],
  line: number,
  text: string,
  startOffset: number,
  endOffset: number,
  fields: Partial<ParsedStatement>
): ParsedStatement {
  return {
    kind,
    uri: document.uri,
    text,
    line,
    startOffset,
    endOffset,
    range: Range.create(document.positionAt(startOffset), document.positionAt(endOffset)),
    operands: fields.operands ?? [],
    ...fields,
  };
}

function firstToken(text: string): { text: string; start: number; end: number } | undefined {
  const match = text.match(/\S+/);
  if (!match || match.index === undefined) return undefined;
  const token = match[0].match(/^%?[A-Za-z_.$?@][A-Za-z0-9_.$?@]*|^=|^\[[^\]]*|^\$?-?(?:0x[0-9a-fA-F]+|[0-9]+)/);
  if (!token) return undefined;
  return { text: token[0], start: match.index, end: match.index + token[0].length };
}

function splitOperands(
  document: TextDocument,
  text: string,
  baseOffset: number,
  diagnostics: StructuralDiagnostic[]
): RawOperand[] {
  const operands: RawOperand[] = [];
  let quote: string | undefined;
  const stack: Array<{ char: string; offset: number }> = [];
  let start: number | undefined;
  let lastNonWs: number | undefined;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if ((char === "\"" || char === "'") && text[i - 1] !== "\\") {
      quote = quote === char ? undefined : quote ?? char;
      start ??= i;
      lastNonWs = i;
      continue;
    }
    if (quote) {
      if (!/\s/.test(char)) lastNonWs = i;
      continue;
    }
    if (char === "[" || char === "(" || char === "{") {
      stack.push({ char, offset: baseOffset + i });
      start ??= i;
      lastNonWs = i;
      continue;
    }
    if (char === "]" || char === ")" || char === "}") {
      const open = stack.pop();
      if (!open || expectedClosing(open.char) !== char) {
        diagnostics.push({
          message: `Unmatched '${char}'.`,
          range: Range.create(document.positionAt(baseOffset + i), document.positionAt(baseOffset + i + 1)),
          severity: "error",
        });
      }
      start ??= i;
      lastNonWs = i;
      continue;
    }
    if (char === "," && stack.length === 0) {
      pushOperand(document, operands, text, baseOffset, start, lastNonWs);
      start = undefined;
      lastNonWs = undefined;
      continue;
    }
    if (!/\s/.test(char)) {
      start ??= i;
      lastNonWs = i;
    }
  }

  pushOperand(document, operands, text, baseOffset, start, lastNonWs);

  if (quote) {
    diagnostics.push({
      message: `Unclosed ${quote} string.`,
      range: Range.create(document.positionAt(baseOffset), document.positionAt(baseOffset + text.length)),
      severity: "error",
    });
  }
  for (const open of stack) {
    diagnostics.push({
      message: `Unclosed '${open.char}'.`,
      range: Range.create(document.positionAt(open.offset), document.positionAt(open.offset + 1)),
      severity: "error",
    });
  }

  return operands;
}

function splitDirectiveOperands(
  document: TextDocument,
  directive: string,
  text: string,
  baseOffset: number,
  diagnostics: StructuralDiagnostic[]
): RawOperand[] {
  const commaOperands = splitOperands(document, text, baseOffset, diagnostics);
  if (!directive.startsWith("%")) return commaOperands;

  const trimmed = text.trim();
  if (!trimmed) return [];

  if (directive === "%define" || directive === "%xdefine" || directive === "%ixdefine") {
    return splitHeadAndBody(document, text, baseOffset);
  }

  if (directive === "%assign" || directive === "%iassign") {
    const pair = splitHeadAndBody(document, text, baseOffset);
    return pair.length > 0 ? pair : commaOperands;
  }

  return commaOperands;
}

function splitHeadAndBody(document: TextDocument, text: string, baseOffset: number): RawOperand[] {
  const match = text.match(/^\s*([A-Za-z_.$?@][A-Za-z0-9_.$?@]*)(?:\([^)]*\))?(?:\s+([\s\S]*\S))?/);
  if (!match || match.index === undefined) return [];

  const operands: RawOperand[] = [];
  const nameStart = baseOffset + match[0].indexOf(match[1]);
  operands.push({
    text: match[1],
    startOffset: nameStart,
    endOffset: nameStart + match[1].length,
    range: Range.create(document.positionAt(nameStart), document.positionAt(nameStart + match[1].length)),
  });

  if (match[2]) {
    const bodyStartInMatch = match[0].lastIndexOf(match[2]);
    const bodyStart = baseOffset + bodyStartInMatch;
    operands.push({
      text: match[2],
      startOffset: bodyStart,
      endOffset: bodyStart + match[2].length,
      range: Range.create(document.positionAt(bodyStart), document.positionAt(bodyStart + match[2].length)),
    });
  }

  return operands;
}

function pushOperand(
  document: TextDocument,
  operands: RawOperand[],
  text: string,
  baseOffset: number,
  start: number | undefined,
  lastNonWs: number | undefined
) {
  if (start === undefined || lastNonWs === undefined) return;
  const raw = text.slice(start, lastNonWs + 1).trim();
  const trimLeft = text.slice(start, lastNonWs + 1).search(/\S/);
  const realStart = baseOffset + start + Math.max(0, trimLeft);
  const end = realStart + raw.length;
  operands.push({ text: raw, startOffset: realStart, endOffset: end, range: Range.create(document.positionAt(realStart), document.positionAt(end)) });
}

function stripComment(line: string) {
  const index = commentStartIndex(line);
  return index === undefined ? line : line.slice(0, index);
}

function commentStartIndex(line: string): number | undefined {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if ((char === "\"" || char === "'") && line[i - 1] !== "\\") {
      quote = quote === char ? undefined : quote ?? char;
    }
    if (!quote && char === ";") return i;
    if (!quote && char === "@" && (i === 0 || /\s/.test(line[i - 1]))) return i;
  }
  return undefined;
}

function looksLikeOperand(text: string) {
  return text.startsWith("[") || text.includes(",") || /^[$]?-?(?:0x[0-9a-f]+|[0-9]+)/i.test(text) || isRegisterName(text);
}

function isRegisterNamedInstruction(text: string) {
  return /^(?:b|bl)$/.test(text);
}

function isRegisterName(text: string) {
  return /^(?:r(?:1[0-5]|[8-9])(?:b|w|d)?|[er]?(?:ax|bx|cx|dx|si|di|bp|sp)|[abcd][hl]|[sd]il|[sb]pl|xmm\d+|ymm\d+|zmm\d+)$/i.test(text);
}

function expectedClosing(open: string) {
  return open === "[" ? "]" : open === "(" ? ")" : "}";
}

function newlineWidth(text: string, at: number) {
  if (text[at] === "\r" && text[at + 1] === "\n") return 2;
  if (text[at] === "\n" || text[at] === "\r") return 1;
  return 0;
}
