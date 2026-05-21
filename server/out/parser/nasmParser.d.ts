import { TextDocument } from "vscode-languageserver-textdocument";
import { ParsedProgram } from "./ast";
export declare function initNasmParser(extensionRoot: string): Promise<void>;
export declare function parseNasmDocument(document: TextDocument): ParsedProgram;
