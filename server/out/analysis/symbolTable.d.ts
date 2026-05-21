import { Location, Position, Range, WorkspaceEdit } from "vscode-languageserver/node";
import { ParsedProgram } from "../parser/ast";
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
export declare class WorkspaceIndex {
    private documents;
    private symbolsById;
    private symbolsByQualifiedName;
    private referencesBySymbolId;
    update(program: ParsedProgram): void;
    delete(uri: string): void;
    macroNames(): Set<string>;
    definitionAt(uri: string, position: Position): Location | undefined;
    referencesAt(uri: string, position: Position, includeDeclaration: boolean): Location[];
    constantRanges(uri: string): Range[];
    renameAt(uri: string, position: Position, newName: string): WorkspaceEdit | undefined;
    tokenAt(uri: string, position: Position): NasmSymbol | NasmReference | undefined;
    resolveToken(token: NasmSymbol | NasmReference, uri: string): NasmSymbol | undefined;
    private rebuildGlobalMaps;
    private lookup;
}
