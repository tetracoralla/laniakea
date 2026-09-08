import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// Send pre-serialized JSON so the test client's JSON.stringify stack does
// not limit the malformed/deep requests that the actual server must reject.
export async function checkRawMcpRequest(pluginRoot, serializedParams) {
  const child = spawn(process.execPath, ["./server/index.mjs"], {
    cwd: pluginRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Raw MCP request timed out: ${stderr}`)), 15_000);
      child.once("error", reject);
      child.stdin.once("error", reject);
      child.once("exit", (code) => reject(new Error(`Raw MCP server exited ${code}: ${stderr}`)));
      lines.on("line", (line) => {
        try {
          const response = JSON.parse(line);
          if (response.error) throw new Error(JSON.stringify(response.error));
          if (response.id === 1) {
            child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
            child.stdin.write(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":${serializedParams}}\n`);
          } else if (response.id === 2) {
            resolve(response.result);
          }
        } catch (error) { reject(error); }
      });
      child.stdin.write(`${JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "laniakea-raw-check", version: "1" } },
      })}\n`);
    });
  } finally {
    clearTimeout(timer);
    lines.close();
    child.stdin.end();
    child.kill();
  }
}
