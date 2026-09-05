# Laniakea Agent 工具模型

## 用户与任务

- 使用者希望把一份可持续维护的思考结构交给 Agent 整理，同时仍能在普通
  Markdown 编辑器或 Laniakea 画布中阅读和继续编辑。
- Agent 写操作仍只操作根思维图的标题、节点文字和父子顺序，不操作缩放、坐标、
  选中态或视觉样式。读取与搜索会在锚点节点上返回 Map 或 Flow 子空间的类型、
  有界内容预览和截断状态，让 Agent 能理解人类下钻后的思考；当前版本不宣称
  Agent 可修改子 Space。
- 顶层列表项对应主根与浮动分支；Agent 可以新增顶层分支，也可以把现有子树提升为浮动分支。
- 第一版面向本地 Markdown 文件，不连接账号、云数据库或远程同步服务。
- 人类创建的 Map Space 与 Flow Space 都是持久内容，写入版本化 Markdown 区块并
  出现在 Agent 读取结果中；Space 类型是创建时确定的不可变属性。
- 父画布中的 Space 概要子节点只是人类操作代理；它不进入普通大纲、不获得 `node:` ref，
  Agent 仍通过锚点节点上的只读 `subspace` 字段读取真实内容。

## 共享内容边界

- 一级标题、顶层列表、嵌套列表与有效的版本化 `laniakea` 区块共同构成内容来源。
- 画布位置、折叠和视口继续属于应用本地状态，不写入 Agent 工具的 Markdown。
- 工具读取丰富 Markdown，但只允许原位修改 Laniakea 可无损往返的纯大纲子集。
- 节点引用只在某一个文件版本内有效；修改必须携带读取时得到的版本摘要。

## 工具面

1. `read_mind_map`：读取一个明确路径的 Markdown，返回层级、锚点上的 Map/Flow 摘要、
   revision-bound 节点引用和版本。
2. `search_mind_map`：搜索根思维图节点；匹配锚点时同时返回其 Map/Flow 摘要。
   子 Space 内容的独立搜索和写入是后续明确扩展，不由当前 `space:` ref 语义暗示。
3. `create_mind_map`：只创建不存在的新 Markdown，不覆盖已有内容。
4. `update_mind_map`：按预期版本原子提交一组结构操作；冲突或丰富 Markdown
   保护触发时不写入文件。

读取与搜索没有副作用。创建与更新由插件声明为写操作；更新可能删除内容，必须
保持可见的工具调用和宿主审批。插件不扫描目录，也不自动选择文件，只处理调用方
明确给出的绝对 `.md` 或 `.markdown` 路径。

## 结果、错误与上下文预算

- 所有结构化结果都用 `status: "ok" | "error"` 区分分支。成功结果继续在
  `structuredContent` 顶层返回可操作的 revision、ref 和节点；文本载体
  只保留最多 12 个节点的短预览，不再复制整份结构化大纲。
- 每个工具结果声明 `responseLimitBytes: 262144`。实现把工具结果控制在 240 KiB
  以内，为 MCP/JSON-RPC 包装预留 16 KiB；超出时只在节点边界缩短返回内容，并以
  `truncated: true` 与 `truncationReasons: ["response_bytes"]` 明确说明。标题、节点
  文字或 breadcrumb 单项若过大也会带对应的 `*Truncated` 标记，不能把前缀当作全文。
- 结构读取还会用 `max_depth`、`max_nodes` 或 `max_results` 说明调用方上限造成的截断。
  Agent 应优先通过 `rootRef`、更小深度、搜索或更窄的节点数继续读取。
- 每个 Space 摘要最多内联 32 个节点；`subspace.truncated` 明确说明是否只返回前缀。
  Map 返回层级、文字与子节点数，Flow 返回类型化步骤与边；每个 Flow 节点最多内联
  64 条出边并以 `outgoingTruncated` 说明是否截断。文字、边标签各自带
  `*Truncated`。这些 `space:` ref 当前只表达只读关系身份，
  不能传给现有思维树更新操作。
- 可预期的工具失败返回 `isError: true`，同时在 `structuredContent.error` 提供稳定
  `code` 与有界 `message`。当前 code 集合为 `already_exists`、`busy`、`conflict`、
  `file_too_large`、`invalid_path`、`not_found`、`invalid_ref`、`invalid_operation`、
  `protected_source`、`too_deep`、`too_large`、`permission_denied`、`io_error` 与
  `request_too_large`。
  MCP 输入 schema 拒绝仍使用协议标准的 invalid-params 错误。输入对象与操作对象拒绝
  未知字段，递归创建节点也只接受 `text` 和 `children`；不能把拼错的 `dryRun`
  或插入位置静默丢弃后提交写入。
- 完整工具请求上限是 524,288 UTF-8 JSON bytes；这个累计预算覆盖整棵创建输入或
  全部 update operations，超限返回 `request_too_large`，并且在任何文件副作用前停止。

## 复用清单

- `src/model/markdown.ts`：Markdown 解析、丰富内容保护和规范化输出。
- `src/model/document.ts`：树结构完整性检查和顶层根顺序。
- `src/model/tree.ts`：节点 ID 与文字规范化规则。
- `src/model/spaces.ts`：Map/Flow 的创建、删除、持久作用域和锚定关系。
- `src/types/mindmap.ts`：应用与 Agent 共用的文档、思维节点、Map、Flow 与视口类型。

MCP、Skill 和插件只包装这些现有能力，不建立第二套思维导图数据模型。
