import { Diagnostic } from "vscode-languageserver/node";
import { ParsedProgram } from "../parser/ast";
import { WorkspaceIndex } from "./symbolTable";
export declare function collectDiagnostics(program: ParsedProgram, index: WorkspaceIndex, knownInstructions: Set<string>): Diagnostic[];
