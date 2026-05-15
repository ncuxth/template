# CLAUDE.md

此文件为 Claude Code（claude.ai/code）在该仓库中工作时提供指导。

## 开发命令

- **本地运行（README 记录的方式）：** 直接在浏览器中打开 `index.html`。
- **为保证完整功能的推荐浏览器：** 最新版 Chrome 或 Edge，因为文件读写自动同步依赖 File System Access API。

当前仓库**未配置构建系统、包管理器脚本、lint 命令或测试命令**。

## 项目架构（高层）

这是一个**单页静态简历渲染/编辑器**：

- `index.html` 定义左右双栏布局：
  - 左侧：A4 简历预览（`#resumePreview`）
  - 右侧：控制面板 + Markdown 编辑器（`#markdownInput`）+ 文件选择器
- `app.js` 包含全部应用逻辑（状态管理、Markdown 渲染、设置持久化、文件双向同步、预览缩放适配）。
- `styles.css` 定义全部视觉行为（A4 页面样式、控件样式、响应式布局、打印样式、基于 CSS 变量的缩放适配）。

项目不使用后端、打包器或框架。

## 运行流程

1. `init()` 从 `localStorage`（`resume-template-settings`）读取已保存的 UI 设置，并应用为 CSS 自定义属性。
2. 应用以空 Markdown 初始化，并提示用户选择文件。
3. 用户通过 `showOpenFilePicker` 选择 Markdown 文件。
4. 应用请求 `readwrite` 权限，读取文件内容，并绑定该文件句柄以启用双向同步。
5. 当编辑器或控制项变化时：
   - 重新渲染预览（`renderPreview()`）；
   - 将设置写入 `localStorage`；
   - 使用防抖自动保存到磁盘（`writeMarkdownFile`，500ms）。
6. 通过 1 秒轮询（`pollMarkdownFile`）检测外部文件修改，并刷新编辑器与预览。

## Markdown 渲染模型

渲染由 `renderMarkdown()` 中的自定义解析实现（不是完整 Markdown 引擎）。当前支持的关键语义：

- `# ...` => 简历姓名标题（`h1`）
- 姓名后的第一段非空内容 => 头部联系方式行
- `## ...` => 分区块
- 行尾日期区间（如 `（2024.09-2028.07）`）会被拆分并在 `.entry-row` 右对齐
- 被 `**...**` 包裹的整行会渲染为标题样式条目（根据关键词匹配为 `h3`/`h4`）
- 行内 `` `...` `` 渲染为标签样式（`.tag`）
- `---` 渲染为分隔线
- 支持有序/无序列表

修改解析器行为时，请保持与 `resume.md` 和 README 示例中现有中文简历内容模式的兼容性。

## 布局与打印行为

- 常规模式下预览固定为 A4 尺寸（`210mm x 297mm`）。
- `fitToOnePage()` 会计算缩放比例，使内容按高度收缩到单页。
- 打印模式会隐藏右侧控制面板，并保持 A4 输出（`@page size: A4; margin: 0`）。

如调整排版或页边距逻辑，请同时验证屏幕预览与浏览器“打印为 PDF”输出。