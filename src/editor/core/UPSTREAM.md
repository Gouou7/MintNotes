# 编辑器核心来源

Mint Notes 实时 Markdown 编辑器核心衍生自[`Yuyz0112/typora-web`](https://github.com/Yuyz0112/typora-web) 的提交`7d2ed21904cbd30923e2b905415b842b5e35b713`（`0.3.1` 发布提交）。

导入的源代码采用 MIT 许可证。原始许可证保存在 `LICENSE.typora-web` 中，其声明也包含在应用随附的第三方声明中。

Mint Notes 将这份源代码作为仓库内的 ProseMirror／Markdown 核心维护。项目特有的核心改动包括规范 Markdown 转义处理、延迟块引用转换、通用扩展契约，以及不暴露底层 ProseMirror 视图的稳定控制器。Callout 和 Math／Mermaid／WikiLink 行为位于 `src/editor/extensions/` 下的同级模块中，并注入核心。后续更改必须遵守根目录 `AGENTS.md` 和 `docs/editor-architecture.md` 中记录的规范 Markdown 与编辑器边界约束。

上游行为规范和测试框架保留在 `specs/` 与 `upstream-tests/` 中，只针对仓库的 Vitest 运行器和本地模块路径进行了适配。Mint 特有的不变量在核心旁及 `src/editor/` 中另有补充测试。

## 合并上游时须保留的改动

合入上游新提交前，先以上述上游提交 `7d2ed219` 建立对照，逐项确认以下改动仍然保留：

- 规范化的 Markdown 转义处理，不生成私有标记，也不把转义写入正文。
- 延迟的块引用转换，避免在输入过程中破坏原始写法。
- 通用扩展契约：核心不导入产品扩展，不接收原始 ProseMirror 视图，扩展只能通过受限声明契约或类型化源码事务接入。
- 控制器层：Callout、Math／Mermaid／WikiLink 行为位于 `src/editor/extensions/` 并注入核心。

`specs/` 与 `upstream-tests/` 只在运行器与本地模块路径上做过适配，不能用上游原样文件整体覆盖，以免丢失上述改动与本地测试。
