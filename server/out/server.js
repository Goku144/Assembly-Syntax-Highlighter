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
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const node_url_1 = require("node:url");
const nasmParser_1 = require("./parser/nasmParser");
const symbolTable_1 = require("./analysis/symbolTable");
const diagnostics_1 = require("./analysis/diagnostics");
const instructionValidator_1 = require("./analysis/instructionValidator");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
const index = new symbolTable_1.WorkspaceIndex();
const parsedDocuments = new Map();
const extensionRoot = path.resolve(__dirname, "../..");
const knownInstructions = new Set();
let instructionDocs = {};
const semanticTokenTypes = [
    "nasmDirectivePercent",
    "nasmDirectiveKeyword",
    "number",
    "variable",
    "nasmRegister",
    "nasmDocTag",
];
const semanticTokenModifiers = ["readonly"];
const registerTokenPattern = /%(?:r(?:1[0-5]|[8-9])(?:b|w|d)?|[er]?(?:ax|bx|cx|dx|si|di|bp|sp)|[abcd][hl]|[sb]pl|[sd]il|xmm(?:[0-9]|[12][0-9]|3[01])|ymm(?:[0-9]|[12][0-9]|3[01])|zmm(?:[0-9]|[12][0-9]|3[01])|k[0-7]|tmm[0-7]|mm[0-7]|st(?:\([0-7]\)|[0-7])?|cs|ds|ss|es|fs|gs|cr[0-8]|dr[0-7]|rip|eip|eflags|rflags)\b|\b(?:r(?:1[0-5]|[8-9])(?:b|w|d)?|[er]?(?:ax|bx|cx|dx|si|di|bp|sp)|[abcd][hl]|[sb]pl|[sd]il|xmm(?:[0-9]|[12][0-9]|3[01])|ymm(?:[0-9]|[12][0-9]|3[01])|zmm(?:[0-9]|[12][0-9]|3[01])|k[0-7]|tmm[0-7]|mm[0-7]|st(?:\([0-7]\)|[0-7])?|cs|ds|ss|es|fs|gs|cr[0-8]|dr[0-7]|tr[3-7]|gdtr|idtr|ldtr|msw|mxcsr|pkru|bnd[0-3]|e?flags|rflags|eip|rip)\b/gi;
const numberLiteralPattern = /(?<![A-Za-z0-9_.$])(?:[0-9]+\.[0-9]*|\.[0-9]+)(?:e[+-]?[0-9]+)?(?![A-Za-z0-9_.$])|(?<![A-Za-z0-9_.$])(?:0x[0-9a-f]+h?|[0-9][0-9a-f]*h|0b[01]+|[01]+b|0o[0-7]+|[0-7]+[oq]|[0-9]+d?)(?![A-Za-z0-9_.$])|(?<![A-Za-z0-9_.$])#-?(?:0x[0-9a-f]+|0b[01]+|[0-9]+)(?![A-Za-z0-9_.$])|\$-?(?:0x[0-9a-f]+|0b[01]+|[0-9]+)(?![A-Za-z0-9_.$])/gi;
connection.onInitialize((_params) => ({
    capabilities: {
        textDocumentSync: node_1.TextDocumentSyncKind.Incremental,
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        renameProvider: { prepareProvider: false },
        semanticTokensProvider: {
            legend: { tokenTypes: [...semanticTokenTypes], tokenModifiers: [...semanticTokenModifiers] },
            full: true,
        },
    },
}));
connection.onInitialized(async () => {
    loadInstructionData();
    (0, instructionValidator_1.loadInstructionForms)(extensionRoot);
    try {
        await (0, nasmParser_1.initNasmParser)(extensionRoot);
    }
    catch (error) {
        connection.console.warn(`NASM parser initialization failed: ${formatError(error)}`);
    }
    try {
        await indexWorkspaceFiles();
    }
    catch (error) {
        connection.console.warn(`Workspace indexing failed: ${formatError(error)}`);
    }
    for (const document of documents.all()) {
        try {
            await validateTextDocument(document);
        }
        catch (error) {
            connection.console.warn(`Validation failed for ${document.uri}: ${formatError(error)}`);
        }
    }
});
documents.onDidOpen(event => validateTextDocument(event.document));
documents.onDidChangeContent(event => validateTextDocument(event.document));
documents.onDidClose(event => {
    parsedDocuments.delete(event.document.uri);
    index.delete(event.document.uri);
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});
connection.onHover(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document)
        return undefined;
    if (isCommentPosition(document.uri, params.position))
        return undefined;
    const word = wordAt(document, params.position);
    if (!word)
        return undefined;
    const normalizedWord = word.startsWith("%") ? word.slice(1) : word;
    const register = registerInfo(normalizedWord);
    if (register) {
        return {
            contents: {
                kind: node_1.MarkupKind.Markdown,
                value: [
                    `**${word.toUpperCase()}**`,
                    `**Role:** ${register.role}`,
                    `**Description:** ${register.description}`,
                    register.abi ? `**System V AMD64 ABI:** ${register.abi}` : "",
                    register.aliases ? `**Aliases:** ${register.aliases}` : "",
                ].filter(Boolean).join("\n\n"),
            },
        };
    }
    const token = index.tokenAt(params.textDocument.uri, params.position);
    if (token) {
        const symbol = index.resolveToken(token, params.textDocument.uri);
        if (symbol?.documentation) {
            return {
                contents: {
                    kind: node_1.MarkupKind.Markdown,
                    value: formatSymbolDocumentation(symbol.name, symbol.documentation),
                },
            };
        }
        ;
    }
    const directive = directiveInfo(normalizedWord);
    if (directive) {
        return {
            contents: {
                kind: node_1.MarkupKind.Markdown,
                value: [
                    `**${directive.name}**`,
                    `**Role:** ${directive.role}`,
                    `**Description:** ${directive.description}`,
                ].join("\n\n"),
            },
        };
    }
    const info = instructionDocs[normalizedWord.toLowerCase()];
    if (!info)
        return undefined;
    const contents = [
        `**${info.title ?? normalizedWord.toUpperCase()}**`,
        info.opcode ? `**Opcode:** ${info.opcode}` : "",
        info.description ? `**Description:** ${info.description}` : "",
        info.url ? `[View Documentation](${info.url})` : "",
    ].filter(Boolean).join("\n\n");
    return { contents: { kind: node_1.MarkupKind.Markdown, value: contents } };
});
connection.onDefinition(params => {
    if (isCommentPosition(params.textDocument.uri, params.position))
        return [];
    const location = index.definitionAt(params.textDocument.uri, params.position);
    return location ? [location] : [];
});
connection.onReferences((params) => {
    if (isCommentPosition(params.textDocument.uri, params.position))
        return [];
    return index.referencesAt(params.textDocument.uri, params.position, Boolean(params.context.includeDeclaration));
});
connection.onRenameRequest((params) => {
    if (isCommentPosition(params.textDocument.uri, params.position))
        return undefined;
    return index.renameAt(params.textDocument.uri, params.position, params.newName);
});
connection.languages.semanticTokens.on(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document)
        return { data: [] };
    let program = parsedDocuments.get(document.uri);
    if (!program) {
        try {
            program = (0, nasmParser_1.parseNasmDocument)(document);
        }
        catch (error) {
            connection.console.warn(`Semantic token parsing failed for ${document.uri}: ${formatError(error)}`);
            return { data: [] };
        }
    }
    const builder = new node_1.SemanticTokensBuilder();
    const tokens = [];
    for (const statement of program.statements) {
        if (statement.kind === "empty")
            continue;
        if (statement.kind === "directive" && statement.directive?.startsWith("%")) {
            const start = document.positionAt(statement.startOffset);
            tokens.push({ line: start.line, char: start.character, length: 1, type: 0 /* TokenType.DirectivePercent */, modifiers: 0 /* TokenModifier.None */ });
            tokens.push({
                line: start.line,
                char: start.character + 1,
                length: statement.directive.length - 1,
                type: 1 /* TokenType.DirectiveKeyword */,
                modifiers: 0 /* TokenModifier.None */,
            });
        }
        const code = program.text.slice(statement.startOffset, statement.endOffset);
        collectRegexTokens(document, program, statement.startOffset, code, registerTokenPattern, 4 /* TokenType.Register */, tokens);
        collectRegexTokens(document, program, statement.startOffset, code, numberLiteralPattern, 2 /* TokenType.Number */, tokens);
    }
    collectConstantTokens(document, index.constantRanges(document.uri), tokens);
    collectDocTagTokens(document, program, tokens);
    tokens.sort((a, b) => a.line - b.line || a.char - b.char || b.length - a.length);
    for (const token of removeOverlaps(tokens)) {
        builder.push(token.line, token.char, token.length, token.type, token.modifiers);
    }
    return builder.build();
});
async function validateTextDocument(document) {
    let program;
    try {
        program = (0, nasmParser_1.parseNasmDocument)(document);
    }
    catch (error) {
        connection.console.warn(`Parsing failed for ${document.uri}: ${formatError(error)}`);
        connection.sendDiagnostics({
            uri: document.uri,
            diagnostics: [{
                    range: fullDocumentRange(document),
                    message: `Assembly language server could not parse this document: ${formatError(error)}`,
                    severity: node_1.DiagnosticSeverity.Error,
                    source: "nasm-lsp",
                }],
        });
        return;
    }
    parsedDocuments.set(document.uri, program);
    index.update(program);
    let diagnostics;
    try {
        diagnostics = (0, diagnostics_1.collectDiagnostics)(program, index, knownInstructions);
        diagnostics = diagnostics.concat(await collectExternalNasmDiagnostics(document));
    }
    catch (error) {
        connection.console.warn(`Diagnostic collection failed for ${document.uri}: ${formatError(error)}`);
        diagnostics = [{
                range: fullDocumentRange(document),
                message: `Assembly diagnostics failed: ${formatError(error)}`,
                severity: node_1.DiagnosticSeverity.Error,
                source: "nasm-lsp",
            }];
    }
    connection.sendDiagnostics({ uri: document.uri, diagnostics });
}
function collectRegexTokens(document, program, baseOffset, text, regex, type, tokens) {
    regex.lastIndex = 0;
    let match = regex.exec(text);
    while (match) {
        const startOffset = baseOffset + match.index;
        const endOffset = startOffset + match[0].length;
        const start = document.positionAt(startOffset);
        const end = document.positionAt(endOffset);
        if (!overlapsComment(program, start, end)) {
            tokens.push({ line: start.line, char: start.character, length: match[0].length, type, modifiers: 0 /* TokenModifier.None */ });
        }
        match = regex.exec(text);
    }
}
function collectConstantTokens(document, ranges, tokens) {
    for (const range of ranges) {
        if (range.start.line !== range.end.line)
            continue;
        tokens.push({
            line: range.start.line,
            char: range.start.character,
            length: range.end.character - range.start.character,
            type: 3 /* TokenType.Variable */,
            modifiers: 1 /* TokenModifier.Readonly */,
        });
    }
}
function collectDocTagTokens(document, program, tokens) {
    for (const range of program.commentRanges) {
        const line = document.getText({ start: { line: range.start.line, character: 0 }, end: { line: range.start.line + 1, character: 0 } });
        const tagRegex = /@(?:brief|param|returns?|note)\b|note:/gi;
        let match = tagRegex.exec(line);
        while (match) {
            if (match.index >= range.start.character && match.index < range.end.character) {
                tokens.push({ line: range.start.line, char: match.index, length: match[0].length, type: 5 /* TokenType.DocTag */, modifiers: 0 /* TokenModifier.None */ });
            }
            match = tagRegex.exec(line);
        }
    }
}
function overlapsComment(program, start, end) {
    return program.commentRanges.some(range => start.line <= range.end.line &&
        end.line >= range.start.line &&
        positionBefore(start, range.end) &&
        positionBefore(range.start, end));
}
function positionBefore(left, right) {
    return left.line < right.line || (left.line === right.line && left.character < right.character);
}
function removeOverlaps(tokens) {
    const accepted = [];
    for (const token of tokens) {
        const previous = accepted[accepted.length - 1];
        if (previous && previous.line === token.line && token.char < previous.char + previous.length) {
            continue;
        }
        accepted.push(token);
    }
    return accepted;
}
function isCommentPosition(uri, position) {
    let program = parsedDocuments.get(uri);
    const document = documents.get(uri);
    if (!program && document) {
        try {
            program = (0, nasmParser_1.parseNasmDocument)(document);
        }
        catch (error) {
            connection.console.warn(`Comment lookup parsing failed for ${uri}: ${formatError(error)}`);
            return false;
        }
        parsedDocuments.set(uri, program);
    }
    if (!program)
        return false;
    return program.commentRanges.some(range => position.line === range.start.line &&
        position.character >= range.start.character &&
        position.character <= range.end.character);
}
function formatSymbolDocumentation(name, doc) {
    const sections = [`**${name}**`];
    if (doc.brief)
        sections.push(doc.brief);
    if (doc.params.length) {
        sections.push([
            "**Parameters**",
            ...doc.params.map(param => `- ${param.name ? `\`${param.name}\`: ` : ""}${param.description}`),
        ].join("\n"));
    }
    if (doc.returns)
        sections.push(`**Returns**\n\n${doc.returns}`);
    if (doc.notes.length)
        sections.push(["**Notes**", ...doc.notes.map(note => `- ${note}`)].join("\n"));
    return sections.join("\n\n");
}
function loadInstructionData() {
    const dataPath = path.join(extensionRoot, "syntaxes", "x86_instructions.json");
    try {
        if (fs.existsSync(dataPath)) {
            instructionDocs = JSON.parse(fs.readFileSync(dataPath, "utf8"));
        }
    }
    catch (error) {
        instructionDocs = {};
        connection.console.warn(`Instruction documentation could not be loaded: ${formatError(error)}`);
    }
    try {
        for (const name of Object.keys(instructionDocs)) {
            knownInstructions.add(name.toLowerCase());
        }
    }
    catch (error) {
        instructionDocs = {};
        connection.console.warn(`Instruction documentation had an unexpected shape: ${formatError(error)}`);
    }
    loadGrammarInstructionMnemonics();
    for (const jump of ["ja", "jae", "jb", "jbe", "jc", "je", "jg", "jge", "jl", "jle", "jmp", "jne", "jno", "jnp", "jns", "jnz", "jo", "jp", "js", "jz"]) {
        knownInstructions.add(jump);
    }
}
function loadGrammarInstructionMnemonics() {
    const grammarPath = path.join(extensionRoot, "syntaxes", "asm.tmLanguage.json");
    if (!fs.existsSync(grammarPath))
        return;
    let grammar;
    try {
        grammar = JSON.parse(fs.readFileSync(grammarPath, "utf8"));
    }
    catch (error) {
        connection.console.warn(`Grammar instruction list could not be loaded: ${formatError(error)}`);
        return;
    }
    function visit(value) {
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (!value || typeof value !== "object")
            return;
        const pattern = value;
        if (typeof pattern.name === "string" && pattern.name.includes("keyword.control.instruction") && typeof pattern.match === "string") {
            for (const mnemonic of extractAlternationWords(pattern.match)) {
                knownInstructions.add(mnemonic.toLowerCase());
            }
        }
        for (const child of Object.values(value)) {
            visit(child);
        }
    }
    visit(grammar);
}
function extractAlternationWords(pattern) {
    const alternatives = pattern.match(/\(\?:([^)]*)\)/)?.[1];
    if (!alternatives)
        return [];
    return alternatives
        .split("|")
        .filter(word => /^[A-Za-z][A-Za-z0-9]*$/.test(word));
}
async function indexWorkspaceFiles() {
    const folders = await connection.workspace.getWorkspaceFolders();
    for (const folder of folders ?? []) {
        if (!folder.uri.startsWith("file:"))
            continue;
        const root = (0, node_url_1.fileURLToPath)(folder.uri);
        for (const file of walkAssemblyFiles(root)) {
            const uri = (0, node_url_1.pathToFileURL)(file).toString();
            if (documents.get(uri))
                continue;
            try {
                const text = fs.readFileSync(file, "utf8");
                const document = vscode_languageserver_textdocument_1.TextDocument.create(uri, "x86asm", 0, text);
                const program = (0, nasmParser_1.parseNasmDocument)(document);
                parsedDocuments.set(uri, program);
                index.update(program);
            }
            catch (error) {
                connection.console.warn(`Skipping workspace file ${uri}: ${formatError(error)}`);
            }
        }
    }
}
function walkAssemblyFiles(root) {
    const result = [];
    const stack = [root];
    while (stack.length) {
        const current = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.name === "node_modules" || entry.name === ".git")
                continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory())
                stack.push(full);
            if (entry.isFile() && /\.(?:asm|s|S|nasm|inc|gas|att|intel|x86|x86_64|amd64|ia32)$/.test(entry.name)) {
                result.push(full);
            }
        }
    }
    return result;
}
async function collectExternalNasmDiagnostics(document) {
    let settings;
    try {
        settings = await connection.workspace.getConfiguration({
            scopeUri: document.uri,
            section: "assembly.nasm",
        });
    }
    catch (error) {
        connection.console.warn(`Could not read NASM validation settings: ${formatError(error)}`);
        return [];
    }
    if (!settings.enableExternalValidation || !document.uri.startsWith("file:"))
        return [];
    const executable = settings.executablePath || "nasm";
    let tempDir;
    try {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nasm-lsp-"));
        const sourcePath = path.join(tempDir, "input.asm");
        const outputPath = path.join(tempDir, "input.o");
        fs.writeFileSync(sourcePath, document.getText(), "utf8");
        await execFileAsync(executable, ["-f", "elf64", sourcePath, "-o", outputPath]);
        return [];
    }
    catch (error) {
        const stderr = typeof error === "object" && error && "stderr" in error ? String(error.stderr) : "";
        return stderr.split(/\r?\n/).flatMap(line => parseNasmStderr(line, document));
    }
    finally {
        if (tempDir) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
            catch (error) {
                connection.console.warn(`Could not remove NASM temporary directory ${tempDir}: ${formatError(error)}`);
            }
        }
    }
}
function fullDocumentRange(document) {
    const text = document.getText();
    return {
        start: { line: 0, character: 0 },
        end: document.positionAt(text.length),
    };
}
function formatError(error) {
    return error instanceof Error ? error.message : String(error);
}
function parseNasmStderr(line, document) {
    const match = line.match(/input\.asm:(\d+):\s*(?:fatal:\s*)?(error|warning):\s*(.*)$/i);
    if (!match)
        return [];
    const lineNumber = Math.max(0, Number(match[1]) - 1);
    const message = `[NASM] ${match[3]}`;
    const range = {
        start: { line: lineNumber, character: 0 },
        end: { line: lineNumber, character: document.getText({ start: { line: lineNumber, character: 0 }, end: { line: lineNumber + 1, character: 0 } }).length },
    };
    return [{
            range,
            message,
            severity: match[2].toLowerCase() === "warning" ? 2 : 1,
            source: "nasm",
        }];
}
function wordAt(document, position) {
    const text = document.getText({
        start: { line: position.line, character: 0 },
        end: { line: position.line + 1, character: 0 },
    });
    const regex = /%?[A-Za-z_.$?@][A-Za-z0-9_.$?@]*/g;
    let match = regex.exec(text);
    while (match) {
        if (position.character >= match.index && position.character <= match.index + match[0].length) {
            return match[0];
        }
        match = regex.exec(text);
    }
    return undefined;
}
function registerInfo(word) {
    const lower = word.toLowerCase();
    const abi = sysvAbiInfo(lower);
    if (/^(?:al|ah|bl|bh|cl|ch|dl|dh|sil|dil|spl|bpl|r(?:[8-9]|1[0-5])b)$/.test(lower)) {
        return { role: "8-bit general-purpose register", description: "Byte-sized operand register for integer data and address calculations.", ...abi };
    }
    if (/^(?:ax|bx|cx|dx|si|di|sp|bp|r(?:[8-9]|1[0-5])w)$/.test(lower)) {
        return { role: "16-bit general-purpose register", description: "Word-sized operand register commonly used in 16-bit code and partial-width operations.", ...abi };
    }
    if (/^(?:eax|ebx|ecx|edx|esi|edi|esp|ebp|r(?:[8-9]|1[0-5])d)$/.test(lower)) {
        return { role: "32-bit general-purpose register", description: "Doubleword integer register; writes usually zero-extend into the matching 64-bit register in long mode.", ...abi };
    }
    if (/^(?:rax|rbx|rcx|rdx|rsi|rdi|rsp|rbp|r(?:[8-9]|1[0-5]))$/.test(lower)) {
        return { role: "64-bit general-purpose register", description: "Quadword integer register used for arithmetic, pointers, stack state, and calling conventions.", ...abi };
    }
    if (/^xmm(?:[0-9]|[12][0-9]|3[01])$/.test(lower)) {
        return { role: "128-bit SIMD register", description: "SSE/AVX vector register for packed integer and floating-point values." };
    }
    if (/^ymm(?:[0-9]|[12][0-9]|3[01])$/.test(lower)) {
        return { role: "256-bit SIMD register", description: "AVX vector register whose low 128 bits overlap the matching XMM register." };
    }
    if (/^zmm(?:[0-9]|[12][0-9]|3[01])$/.test(lower)) {
        return { role: "512-bit SIMD register", description: "AVX-512 vector register whose low lanes overlap the matching YMM and XMM registers." };
    }
    if (/^k[0-7]$/.test(lower)) {
        return { role: "AVX-512 opmask register", description: "Predicate mask register used to enable, disable, or merge vector lanes." };
    }
    if (/^tmm[0-7]$/.test(lower)) {
        return { role: "AMX tile register", description: "Matrix tile storage register used by Intel AMX tile instructions." };
    }
    if (/^(?:st|st[0-7])$/.test(lower)) {
        return { role: "x87 floating-point stack register", description: "80-bit floating-point stack entry used by legacy x87 instructions." };
    }
    if (/^mm[0-7]$/.test(lower)) {
        return { role: "64-bit MMX register", description: "Packed integer register aliased with the x87 register file." };
    }
    if (/^(?:cs|ds|ss|es|fs|gs)$/.test(lower)) {
        return { role: "segment register", description: "Selects a memory segment base and attributes for segmented addressing." };
    }
    if (/^cr[0-8]$/.test(lower)) {
        return { role: "control register", description: "Privileged CPU control register for paging, protection, and processor state." };
    }
    if (/^dr[0-7]$/.test(lower)) {
        return { role: "debug register", description: "Hardware breakpoint and debug-control register." };
    }
    if (/^(?:rip|eip)$/.test(lower)) {
        return { role: "instruction pointer", description: "Holds the address of the next instruction to execute." };
    }
    if (/^(?:rflags|eflags|flags)$/.test(lower)) {
        return { role: "flags register", description: "Stores condition codes and processor status bits used by branches and arithmetic." };
    }
    return undefined;
}
function sysvAbiInfo(register) {
    const families = {
        rdi: { aliases: ["rdi", "edi", "di", "dil"], abi: "1st integer/pointer argument." },
        rsi: { aliases: ["rsi", "esi", "si", "sil"], abi: "2nd integer/pointer argument." },
        rdx: { aliases: ["rdx", "edx", "dx", "dl", "dh"], abi: "3rd integer/pointer argument; also used for the high half of some integer results." },
        rcx: { aliases: ["rcx", "ecx", "cx", "cl", "ch"], abi: "Caller-saved register; used as the 4th Linux syscall argument after moving from the C ABI's rcx position to r10 for syscall." },
        r8: { aliases: ["r8", "r8d", "r8w", "r8b"], abi: "5th integer/pointer argument." },
        r9: { aliases: ["r9", "r9d", "r9w", "r9b"], abi: "6th integer/pointer argument." },
        rax: { aliases: ["rax", "eax", "ax", "al", "ah"], abi: "Integer/pointer return value; also holds the Linux syscall number." },
        rsp: { aliases: ["rsp", "esp", "sp", "spl"], abi: "Stack pointer; must be preserved as the active stack top." },
        rbp: { aliases: ["rbp", "ebp", "bp", "bpl"], abi: "Callee-saved register; commonly used as an optional frame pointer." },
    };
    for (const family of Object.values(families)) {
        if (family.aliases.includes(register)) {
            return { abi: family.abi, aliases: family.aliases.join(", ") };
        }
    }
    return {};
}
function directiveInfo(word) {
    const lower = word.toLowerCase();
    const normalized = lower.startsWith("%") ? lower : `%${lower}`;
    if (normalized === "%define") {
        return { name: "%define", role: "NASM preprocessor directive", description: "Defines a single-line macro name and replacement text before assembly." };
    }
    if (normalized === "%assign") {
        return { name: "%assign", role: "NASM preprocessor directive", description: "Assigns a numeric preprocessor value that can be redefined later." };
    }
    if (normalized === "%macro" || normalized === "%imacro") {
        return { name: normalized, role: "NASM macro directive", description: "Begins a multi-line macro definition with a name and parameter count." };
    }
    if (normalized === "%include") {
        return { name: "%include", role: "NASM preprocessor directive", description: "Includes another source file before assembling the current file." };
    }
    return undefined;
}
documents.listen(connection);
connection.listen();
//# sourceMappingURL=server.js.map