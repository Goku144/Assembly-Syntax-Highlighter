import {
  Location,
  Position,
  Range,
  TextEdit,
  WorkspaceEdit,
} from "vscode-languageserver/node";
import { ParsedProgram, ParsedStatement, RawOperand } from "../parser/ast";
import { DocComment } from "../parser/ast";

export type SymbolKind = "label" | "localLabel" | "data" | "macro" | "struc" | "equ" | "define";
export type ReferenceKind = "read" | "write" | "call" | "jump" | "macroExpansion";

export type NasmSymbol = {
  id: string;
  name: string;
  qualifiedName: string;
  kind: SymbolKind;
  uri: string;
  range: Range;
  scopeId: string;
  documentation?: DocComment;
};

export type NasmReference = {
  symbolId?: string;
  rawName: string;
  uri: string;
  range: Range;
  scopeId: string;
  referenceKind: ReferenceKind;
};

type DocumentIndex = {
  program: ParsedProgram;
  symbols: NasmSymbol[];
  references: NasmReference[];
};

export class WorkspaceIndex {
  private documents = new Map<string, DocumentIndex>();
  private symbolsById = new Map<string, NasmSymbol>();
  private symbolsByQualifiedName = new Map<string, NasmSymbol[]>();
  private referencesBySymbolId = new Map<string, NasmReference[]>();

  update(program: ParsedProgram) {
    const documentIndex = buildDocumentIndex(program);
    this.documents.set(program.uri, documentIndex);
    this.rebuildGlobalMaps();
  }

  delete(uri: string) {
    this.documents.delete(uri);
    this.rebuildGlobalMaps();
  }

  macroNames() {
    const names = new Set<string>();
    for (const symbol of this.symbolsById.values()) {
      if (symbol.kind === "macro") names.add(symbol.name.toLowerCase());
    }
    return names;
  }

  definitionAt(uri: string, position: Position): Location | undefined {
    const token = this.tokenAt(uri, position);
    if (!token) return undefined;
    const symbol = this.resolveToken(token, uri);
    return symbol ? Location.create(symbol.uri, symbol.range) : undefined;
  }

  referencesAt(uri: string, position: Position, includeDeclaration: boolean): Location[] {
    const token = this.tokenAt(uri, position);
    if (!token) return [];
    const symbol = this.resolveToken(token, uri);
    if (!symbol) return [];

    const refs = this.referencesBySymbolId.get(symbol.id) ?? [];
    const locations = refs.map(ref => Location.create(ref.uri, ref.range));
    return includeDeclaration ? [Location.create(symbol.uri, symbol.range), ...locations] : locations;
  }

  constantRanges(uri: string): Range[] {
    const document = this.documents.get(uri);
    if (!document) return [];

    const ranges: Range[] = [];
    for (const symbol of document.symbols) {
      if (isConstantSymbol(symbol)) ranges.push(symbol.range);
    }

    for (const reference of document.references) {
      const symbol = this.resolveToken(reference, reference.uri);
      if (symbol && isConstantSymbol(symbol)) ranges.push(reference.range);
    }

    return ranges;
  }

  renameAt(uri: string, position: Position, newName: string): WorkspaceEdit | undefined {
    if (!/^[A-Za-z_.$?@][A-Za-z0-9_.$?@]*$/.test(newName)) return undefined;

    const token = this.tokenAt(uri, position);
    if (!token) return undefined;
    const symbol = this.resolveToken(token, uri);
    if (!symbol) return undefined;

    const changes: Record<string, TextEdit[]> = {};
    const addEdit = (editUri: string, range: Range, text: string) => {
      changes[editUri] ??= [];
      changes[editUri].push(TextEdit.replace(range, text));
    };

    addEdit(symbol.uri, symbol.range, normalizeRenameText(symbol, newName));
    for (const ref of this.referencesBySymbolId.get(symbol.id) ?? []) {
      addEdit(ref.uri, ref.range, normalizeReferenceRename(ref.rawName, symbol, newName));
    }

    return { changes };
  }

  tokenAt(uri: string, position: Position): NasmSymbol | NasmReference | undefined {
    const document = this.documents.get(uri);
    if (!document) return undefined;

    for (const symbol of document.symbols) {
      if (contains(symbol.range, position)) return symbol;
    }
    for (const reference of document.references) {
      if (contains(reference.range, position)) return reference;
    }
    return undefined;
  }

  resolveToken(token: NasmSymbol | NasmReference, uri: string): NasmSymbol | undefined {
    if ("qualifiedName" in token) return token;
    if (token.symbolId) return this.symbolsById.get(token.symbolId);

    const direct = this.lookup(token.rawName);
    if (direct.length === 1) return direct[0];

    if (token.rawName.startsWith(".")) {
      const scoped = this.lookup(`${token.scopeId}${token.rawName}`);
      if (scoped.length === 1) return scoped[0];
    }

    const document = this.documents.get(uri);
    if (!document) return undefined;
    const local = document.symbols.find(symbol => symbol.name === token.rawName);
    return local;
  }

  private rebuildGlobalMaps() {
    this.symbolsById.clear();
    this.symbolsByQualifiedName.clear();
    this.referencesBySymbolId.clear();

    for (const document of this.documents.values()) {
      for (const symbol of document.symbols) {
        this.symbolsById.set(symbol.id, symbol);
        const list = this.symbolsByQualifiedName.get(symbol.qualifiedName) ?? [];
        list.push(symbol);
        this.symbolsByQualifiedName.set(symbol.qualifiedName, list);
      }
    }

    for (const document of this.documents.values()) {
      for (const reference of document.references) {
        const symbol = this.resolveToken(reference, reference.uri);
        if (!symbol) continue;
        reference.symbolId = symbol.id;
        const refs = this.referencesBySymbolId.get(symbol.id) ?? [];
        refs.push(reference);
        this.referencesBySymbolId.set(symbol.id, refs);
      }
    }
  }

  private lookup(name: string) {
    return this.symbolsByQualifiedName.get(name) ?? [];
  }
}

function buildDocumentIndex(program: ParsedProgram): DocumentIndex {
  const symbols: NasmSymbol[] = [];
  const references: NasmReference[] = [];
  let parentScope = "";

  for (const statement of program.statements) {
    if (statement.kind === "label" && statement.label) {
      const isLocal = statement.label.startsWith(".");
      const qualifiedName = isLocal ? `${parentScope}${statement.label}` : statement.label;
      const symbol = createSymbol(statement, isLocal ? "localLabel" : "label", statement.label, qualifiedName, parentScope);
      symbols.push(symbol);
      if (!isLocal) parentScope = statement.label;
      continue;
    }

    if (statement.kind === "data" && statement.label) {
      symbols.push(createSymbol(statement, "data", statement.label, statement.label, parentScope));
    }
    if (statement.kind === "equ" && statement.label) {
      symbols.push(createSymbol(statement, "equ", statement.label, statement.label, parentScope));
    }
    if (statement.kind === "directive") {
      const created = directiveSymbol(statement, parentScope);
      if (created) symbols.push(created);
    }

    references.push(...statementReferences(statement, parentScope));
  }

  return { program, symbols, references };
}

function createSymbol(
  statement: ParsedStatement,
  kind: SymbolKind,
  name: string,
  qualifiedName: string,
  scopeId: string
): NasmSymbol {
  const start = statement.range.start;
  const end = Position.create(start.line, start.character + name.length);
  return {
    id: `${statement.uri}::${qualifiedName}::${kind}`,
    name,
    qualifiedName,
    kind,
    uri: statement.uri,
    range: Range.create(start, end),
    scopeId,
    documentation: statement.documentation,
  };
}

function isConstantSymbol(symbol: NasmSymbol) {
  return symbol.kind === "equ" || symbol.kind === "define";
}

function directiveSymbol(statement: ParsedStatement, scopeId: string): NasmSymbol | undefined {
  const first = statement.operands[0];
  if (!first) return undefined;
  switch (statement.directive) {
    case "%macro":
    case "%imacro":
      return operandSymbol(statement, first, "macro", first.text, scopeId);
    case "%define":
    case "%xdefine":
    case "%ixdefine":
    case "%assign":
    case "%iassign":
      return operandSymbol(statement, first, "define", first.text, scopeId);
    default:
      return undefined;
  }
}

function operandSymbol(statement: ParsedStatement, operand: RawOperand, kind: SymbolKind, name: string, scopeId: string): NasmSymbol {
  return {
    id: `${statement.uri}::${name}::${kind}`,
    name,
    qualifiedName: name,
    kind,
    uri: statement.uri,
    range: operand.range,
    scopeId,
    documentation: statement.documentation,
  };
}

function statementReferences(statement: ParsedStatement, scopeId: string): NasmReference[] {
  if (statement.kind !== "instruction" && statement.kind !== "directive" && statement.kind !== "data" && statement.kind !== "equ") {
    return [];
  }

  const kind = referenceKind(statement);
  const refs: NasmReference[] = [];
  if (statement.kind === "instruction" && statement.mnemonic) {
    const start = statement.range.start;
    const end = Position.create(start.line, start.character + statement.mnemonic.length);
    refs.push({
      rawName: statement.mnemonic,
      uri: statement.uri,
      range: Range.create(start, end),
      scopeId,
      referenceKind: "macroExpansion",
    });
  }
  for (const operand of statement.operands) {
    refs.push(...operandReferences(statement.uri, operand, scopeId, kind));
  }
  return refs;
}

function operandReferences(uri: string, operand: RawOperand, scopeId: string, referenceKind: ReferenceKind): NasmReference[] {
  const refs: NasmReference[] = [];
  const regex = /[A-Za-z_.$?@][A-Za-z0-9_.$?@]*/g;
  let match = regex.exec(operand.text);
  while (match) {
    const rawName = match[0];
    if (!isIgnoredToken(rawName)) {
      const start = Position.create(operand.range.start.line, operand.range.start.character + match.index);
      const end = Position.create(start.line, start.character + rawName.length);
      refs.push({ rawName, uri, range: Range.create(start, end), scopeId, referenceKind });
    }
    match = regex.exec(operand.text);
  }
  return refs;
}

function referenceKind(statement: ParsedStatement): ReferenceKind {
  const mnemonic = statement.mnemonic?.toLowerCase();
  if (mnemonic === "call") return "call";
  if (mnemonic?.startsWith("j")) return "jump";
  if (statement.kind === "directive" && statement.directive?.includes("macro")) return "macroExpansion";
  return "read";
}

function isIgnoredToken(token: string) {
  return /^(?:byte|word|dword|qword|tword|oword|xmmword|ymmword|zmmword|ptr|rel|abs|short|near|far)$/i.test(token)
    || /^(?:r(?:1[0-5]|[8-9])(?:b|w|d)?|[er]?(?:ax|bx|cx|dx|si|di|bp|sp)|[abcd][hl]|[sd]il|[sb]pl|xmm\d+|ymm\d+|zmm\d+)$/i.test(token);
}

function normalizeRenameText(symbol: NasmSymbol, newName: string) {
  if (symbol.kind === "localLabel" && !newName.startsWith(".")) return `.${newName}`;
  return newName;
}

function normalizeReferenceRename(rawName: string, symbol: NasmSymbol, newName: string) {
  const normalized = normalizeRenameText(symbol, newName);
  if (rawName.startsWith(".") && symbol.kind === "localLabel") return normalized;
  return normalized;
}

function contains(range: Range, position: Position) {
  if (position.line < range.start.line || position.line > range.end.line) return false;
  if (position.line === range.start.line && position.character < range.start.character) return false;
  if (position.line === range.end.line && position.character > range.end.character) return false;
  return true;
}
