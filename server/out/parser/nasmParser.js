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
exports.initNasmParser = initNasmParser;
exports.parseNasmDocument = parseNasmDocument;
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
const node_1 = require("vscode-languageserver/node");
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
let treeSitterParser;
async function initNasmParser(extensionRoot) {
    const wasmPath = path.join(extensionRoot, "server", "assets", "tree-sitter-nasm.wasm");
    if (!(0, node_fs_1.existsSync)(wasmPath))
        return;
    try {
        const Parser = require("web-tree-sitter");
        await Parser.init();
        const language = await Parser.Language.load(wasmPath);
        const parser = new Parser();
        parser.setLanguage(language);
        treeSitterParser = parser;
    }
    catch {
        treeSitterParser = undefined;
    }
}
function parseNasmDocument(document) {
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const diagnostics = treeSitterParser
        ? collectTreeSitterErrors(treeSitterParser.parse(text).rootNode, lines)
        : [];
    const statements = [];
    const commentRanges = [];
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
function stripCommentsFromLine(line, lineNumber, startsInBlockComment) {
    const chars = [...line];
    const ranges = [];
    let quote;
    let inBlockComment = startsInBlockComment;
    let i = 0;
    while (i < chars.length) {
        if (inBlockComment) {
            const end = line.indexOf("*/", i);
            const rangeEnd = end === -1 ? chars.length : end + 2;
            blank(chars, i, rangeEnd);
            ranges.push(node_1.Range.create(node_1.Position.create(lineNumber, i), node_1.Position.create(lineNumber, rangeEnd)));
            if (end === -1)
                return { code: chars.join(""), ranges, inBlockComment: true };
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
            ranges.push(node_1.Range.create(node_1.Position.create(lineNumber, i), node_1.Position.create(lineNumber, line.length)));
            return { code: chars.join(""), ranges, inBlockComment: false };
        }
        if (char === "@" && (i === 0 || /\s/.test(chars[i - 1]))) {
            blank(chars, i, chars.length);
            ranges.push(node_1.Range.create(node_1.Position.create(lineNumber, i), node_1.Position.create(lineNumber, line.length)));
            return { code: chars.join(""), ranges, inBlockComment: false };
        }
        i++;
    }
    return { code: chars.join(""), ranges, inBlockComment };
}
function blank(chars, start, end) {
    for (let i = start; i < end; i++)
        chars[i] = " ";
}
function collectTreeSitterErrors(root, lines) {
    const diagnostics = [];
    function visit(node) {
        if (node.type === "ERROR" || node.isMissing()) {
            const line = lines[node.startPosition.row] ?? "";
            if (/^\s*\.cfi_[A-Za-z_]+\b/.test(stripComment(line)))
                return;
            diagnostics.push({
                message: node.isMissing()
                    ? `Missing NASM syntax element: ${node.type}`
                    : "Invalid NASM syntax.",
                range: node_1.Range.create(node_1.Position.create(node.startPosition.row, node.startPosition.column), node_1.Position.create(node.endPosition.row, node.endPosition.column)),
                severity: "error",
            });
        }
        for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (child)
                visit(child);
        }
    }
    visit(root);
    return diagnostics;
}
function collectDocComments(lines) {
    const docs = new Map();
    let pending = [];
    for (let line = 0; line < lines.length; line++) {
        const raw = lines[line];
        const text = docCommentText(raw);
        if (text !== undefined) {
            pending.push(text);
            continue;
        }
        if (!raw.trim()) {
            if (pending.length)
                pending = [];
            continue;
        }
        if (pending.length && startsStatement(raw)) {
            docs.set(line, parseDocComment(pending));
        }
        pending = [];
    }
    return docs;
}
function docCommentText(line) {
    const match = line.match(/^\s*;\s?(.*)$/);
    if (!match)
        return undefined;
    const text = match[1].trim();
    if (/^(?:@(?:brief|param|return|returns|note)\b|note:)/i.test(text))
        return text;
    return undefined;
}
function parseDocComment(lines) {
    const doc = { params: [], notes: [], raw: lines };
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
function appendDocText(existing, next) {
    return existing ? `${existing} ${next.trim()}` : next.trim();
}
function startsStatement(line) {
    const code = stripComment(line);
    return Boolean(firstToken(code));
}
function parseLine(document, line, lineOffset, rawLine, code, diagnostics) {
    const statements = [];
    let rest = code;
    let localOffset = 0;
    while (true) {
        const labelMatch = rest.match(new RegExp(`^\\s*(${SYMBOL}):`));
        if (!labelMatch || labelMatch.index !== 0)
            break;
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
    if (!first)
        return statements;
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
            range: node_1.Range.create(document.positionAt(tokenStart), document.positionAt(Math.max(tokenEnd, lineOffset + code.length))),
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
function makeStatement(document, kind, line, text, startOffset, endOffset, fields) {
    return {
        kind,
        uri: document.uri,
        text,
        line,
        startOffset,
        endOffset,
        range: node_1.Range.create(document.positionAt(startOffset), document.positionAt(endOffset)),
        operands: fields.operands ?? [],
        ...fields,
    };
}
function firstToken(text) {
    const match = text.match(/\S+/);
    if (!match || match.index === undefined)
        return undefined;
    const token = match[0].match(/^%?[A-Za-z_.$?@][A-Za-z0-9_.$?@]*|^=|^\[[^\]]*|^\$?-?(?:0x[0-9a-fA-F]+|[0-9]+)/);
    if (!token)
        return undefined;
    return { text: token[0], start: match.index, end: match.index + token[0].length };
}
function splitOperands(document, text, baseOffset, diagnostics) {
    const operands = [];
    let quote;
    const stack = [];
    let start;
    let lastNonWs;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if ((char === "\"" || char === "'") && text[i - 1] !== "\\") {
            quote = quote === char ? undefined : quote ?? char;
            start ?? (start = i);
            lastNonWs = i;
            continue;
        }
        if (quote) {
            if (!/\s/.test(char))
                lastNonWs = i;
            continue;
        }
        if (char === "[" || char === "(" || char === "{") {
            stack.push({ char, offset: baseOffset + i });
            start ?? (start = i);
            lastNonWs = i;
            continue;
        }
        if (char === "]" || char === ")" || char === "}") {
            const open = stack.pop();
            if (!open || expectedClosing(open.char) !== char) {
                diagnostics.push({
                    message: `Unmatched '${char}'.`,
                    range: node_1.Range.create(document.positionAt(baseOffset + i), document.positionAt(baseOffset + i + 1)),
                    severity: "error",
                });
            }
            start ?? (start = i);
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
            start ?? (start = i);
            lastNonWs = i;
        }
    }
    pushOperand(document, operands, text, baseOffset, start, lastNonWs);
    if (quote) {
        diagnostics.push({
            message: `Unclosed ${quote} string.`,
            range: node_1.Range.create(document.positionAt(baseOffset), document.positionAt(baseOffset + text.length)),
            severity: "error",
        });
    }
    for (const open of stack) {
        diagnostics.push({
            message: `Unclosed '${open.char}'.`,
            range: node_1.Range.create(document.positionAt(open.offset), document.positionAt(open.offset + 1)),
            severity: "error",
        });
    }
    return operands;
}
function splitDirectiveOperands(document, directive, text, baseOffset, diagnostics) {
    const commaOperands = splitOperands(document, text, baseOffset, diagnostics);
    if (!directive.startsWith("%"))
        return commaOperands;
    const trimmed = text.trim();
    if (!trimmed)
        return [];
    if (directive === "%define" || directive === "%xdefine" || directive === "%ixdefine") {
        return splitHeadAndBody(document, text, baseOffset);
    }
    if (directive === "%assign" || directive === "%iassign") {
        const pair = splitHeadAndBody(document, text, baseOffset);
        return pair.length > 0 ? pair : commaOperands;
    }
    return commaOperands;
}
function splitHeadAndBody(document, text, baseOffset) {
    const match = text.match(/^\s*([A-Za-z_.$?@][A-Za-z0-9_.$?@]*)(?:\([^)]*\))?(?:\s+([\s\S]*\S))?/);
    if (!match || match.index === undefined)
        return [];
    const operands = [];
    const nameStart = baseOffset + match[0].indexOf(match[1]);
    operands.push({
        text: match[1],
        startOffset: nameStart,
        endOffset: nameStart + match[1].length,
        range: node_1.Range.create(document.positionAt(nameStart), document.positionAt(nameStart + match[1].length)),
    });
    if (match[2]) {
        const bodyStartInMatch = match[0].lastIndexOf(match[2]);
        const bodyStart = baseOffset + bodyStartInMatch;
        operands.push({
            text: match[2],
            startOffset: bodyStart,
            endOffset: bodyStart + match[2].length,
            range: node_1.Range.create(document.positionAt(bodyStart), document.positionAt(bodyStart + match[2].length)),
        });
    }
    return operands;
}
function pushOperand(document, operands, text, baseOffset, start, lastNonWs) {
    if (start === undefined || lastNonWs === undefined)
        return;
    const raw = text.slice(start, lastNonWs + 1).trim();
    const trimLeft = text.slice(start, lastNonWs + 1).search(/\S/);
    const realStart = baseOffset + start + Math.max(0, trimLeft);
    const end = realStart + raw.length;
    operands.push({ text: raw, startOffset: realStart, endOffset: end, range: node_1.Range.create(document.positionAt(realStart), document.positionAt(end)) });
}
function stripComment(line) {
    const index = commentStartIndex(line);
    return index === undefined ? line : line.slice(0, index);
}
function commentStartIndex(line) {
    let quote;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if ((char === "\"" || char === "'") && line[i - 1] !== "\\") {
            quote = quote === char ? undefined : quote ?? char;
        }
        if (!quote && char === ";")
            return i;
        if (!quote && char === "@" && (i === 0 || /\s/.test(line[i - 1])))
            return i;
    }
    return undefined;
}
function looksLikeOperand(text) {
    return text.startsWith("[") || text.includes(",") || /^[$]?-?(?:0x[0-9a-f]+|[0-9]+)/i.test(text) || isRegisterName(text);
}
function isRegisterNamedInstruction(text) {
    return /^(?:b|bl)$/.test(text);
}
function isRegisterName(text) {
    return /^(?:r(?:1[0-5]|[8-9])(?:b|w|d)?|[er]?(?:ax|bx|cx|dx|si|di|bp|sp)|[abcd][hl]|[sd]il|[sb]pl|xmm\d+|ymm\d+|zmm\d+)$/i.test(text);
}
function expectedClosing(open) {
    return open === "[" ? "]" : open === "(" ? ")" : "}";
}
function newlineWidth(text, at) {
    if (text[at] === "\r" && text[at + 1] === "\n")
        return 2;
    if (text[at] === "\n" || text[at] === "\r")
        return 1;
    return 0;
}
//# sourceMappingURL=nasmParser.js.map