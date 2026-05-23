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
exports.activate = activate;
exports.deactivate = deactivate;
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const node_1 = require("vscode-languageclient/node");
let client;
function activate(context) {
    const debugAsmCommand = vscode.commands.registerCommand("assembly.debugAsm", async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage("Open a workspace folder before debugging ASM.");
            return;
        }
        const started = await vscode.debug.startDebugging(workspaceFolder, "Debug asm");
        if (!started) {
            vscode.window.showErrorMessage("Could not start the Debug asm configuration.");
        }
    });
    context.subscriptions.push(debugAsmCommand);
    const serverModule = context.asAbsolutePath(path.join("server", "out", "server.js"));
    const serverOptions = {
        run: { module: serverModule, transport: node_1.TransportKind.ipc },
        debug: { module: serverModule, transport: node_1.TransportKind.ipc },
    };
    const clientOptions = {
        documentSelector: [{ scheme: "file", language: "x86asm" }],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{asm,s,S,nasm,inc,gas,att,intel,x86,x86_64,amd64,ia32}"),
        },
    };
    client = new node_1.LanguageClient("nasmLanguageServer", "NASM Language Server", serverOptions, clientOptions);
    client.start();
    context.subscriptions.push(client);
}
function deactivate() {
    return client?.stop();
}
//# sourceMappingURL=extension.js.map