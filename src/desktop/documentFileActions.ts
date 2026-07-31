import { invoke } from "@tauri-apps/api/core";
import { isDesktopRuntime } from "../persistence/localDocumentStore";
import { writeTextClipboard } from "./clipboard";

export async function revealDocumentInFileManager(
  path: string,
): Promise<void> {
  if (!isDesktopRuntime()) {
    throw new Error("请在桌面应用中使用“在访达中显示”");
  }
  await invoke("reveal_document_in_file_manager", {
    documentPath: path,
  });
}

export async function copyDocumentPath(path: string): Promise<void> {
  if (!(await writeTextClipboard(path))) {
    throw new Error("无法复制文件路径");
  }
}
