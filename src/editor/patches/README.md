# Typora-web 来源与补丁维护

原始上游：[Yuyz0112/typora-web](https://github.com/Yuyz0112/typora-web)，MIT 许可，v0.3.1，提交 `317fdb0f89a38cfc98a0bba753deec979c6722e6`。快照来自该提交的 GitHub 归档；保留 `src/`、`tests/`、`specs/`、LICENSE、README 和 package.json，不保留上游锁文件。

[逐文件 SHA-256 清单](../typora-web/upstream.json)验证基准；[完整上游许可](../typora-web/LICENSE)与[发布许可声明](../../../public/THIRD_PARTY_NOTICES.txt)保留版权。旧编辑器实现由 Git 历史保留。

## 补丁清单

`series.json` 是应用顺序、用途、依赖及验收测试的唯一清单。每个功能使用不带序号的语义目录，`upstream.patch` 描述对上游文件的必要改动，同目录的新增模块按 `additions` 映射复制到生成树，不修改原始上游。目录名不参与排序；清单中的现有补丁 ID 保持稳定，供依赖引用。

例如公式功能在 `math/` 内维护共用语法、行内装饰、块解析、键盘行为与预览生命周期，`upstream.patch` 接入功能注册及选区展示；公共控制器和展示上下文位于 `integration/`，共享语法保护、转义判断和通用块预览接入位于 `syntax/`。运行引擎仍生成在仓库根目录的 `.generated/typora-web/`，`src/editor/product/` 中的产品代码通过 `src/editor/engine.ts` 引用。

| 补丁 | 上游缺口／用途 | 主要验收 |
| --- | --- | --- |
| [01-integration](integration/upstream.patch) | Mint 控制器、渲染上下文、只读与代码区域保护 | engine.test.ts |
| [02-data-integrity](data-integrity/upstream.patch) | 解析会消费引用定义；保留所有定义并阻止可执行链接 | engine.test.ts、往返测试 |
| [03-safe-images](safe-images/upstream.patch) | 禁用上游正文 Blob 插入与额外网络探测；只读任务保护 | engine.test.ts、浏览器 |
| [04-mint-syntax](syntax/upstream.patch) | 保护产品字面语法，提供受限块预览接入 | features.test.ts |
| [05-math](math/upstream.patch) | 共用美元分隔符语法；行内源码与预览、单行／多行独行公式、创建和边界导航，依赖本地 KaTeX | math.test.ts、features.test.ts、math.spec.ts |
| [06-wikilink](wikilink/upstream.patch) | 目标、别名、标题导航及嵌入入口 | features.test.ts、浏览器 |
| [07-comments](comments/upstream.patch) | 注释显隐与跨段注释保存 | features.test.ts |
| [08-footnotes](footnotes/upstream.patch) | 引用、行内脚注、编号、回链与定义预览 | features.test.ts、浏览器 |
| [09-callouts](callouts/upstream.patch) | 类型、折叠、嵌套、创建与正文回车；上下导航经过名称与正文，已创建块保持标题显示，空块保留正文空位 | callout-interaction.test.ts、features.test.ts、浏览器 |
| [10-code](code/upstream.patch) | 代码复制及本地 highlight.js 装饰 | features.test.ts、浏览器 |
| [11-mermaid](mermaid/upstream.patch) | Mermaid 安全预览，普通代码继续使用上游 NodeView | features.test.ts、浏览器 |
| [12-product-controls](product-controls/upstream.patch) | AppIcon、可访问名称、三语表格控件与只读工具栏 | 浏览器 |
| [13-upstream-test-expectations](upstream-test-expectations/upstream.patch) | 仅改变图片 specs 的安全预期，全部检查点继续运行 | 补丁后的上游测试 |
| [14-blockquote-input](blockquote/upstream.patch) | 停止自动转义 `>`，保留手写引用转义；补齐浏览器合并输入的引用触发，沿用上游嵌套、延续与退出行为 | blockquote.test.ts、浏览器 |
| [15-block-controls](block-controls/upstream.patch) | 代码语言与 Callout 标题直接编辑，回车／失焦提交；代码上下键按头部在正文之前的顺序导航；原生类型选单、右侧折叠与编辑状态 | block-controls.test.ts、calloutMarker.test.ts、浏览器 |
| [16-block-controls-tests](block-controls/test-expectations.patch) | 类型编辑框移到顶部后调整代码上下键导航预期，保留检查点并补齐从上方进入的检查 | 补丁后的上游测试 |

图片测试差异补丁移除直接文件选择占位，阻止 `u`／`url` 这类相对图片 URL 出现在预览 src；图片源码与说明文字不变。Mint 只允许 HTTPS 或经附件解析器取得的 Blob URL。代码测试差异补丁调整类型编辑框所在位置对应的上下键路径，其余上游预期继续原样验证。

## 准备与验证

```bash
pnpm prepare:editor
node scripts/prepare-typora-web.mjs --check
pnpm typecheck
pnpm test:upstream
pnpm test:patched-upstream
pnpm test
pnpm build
pnpm test:editor-browser
```

原始和生成测试的运行配置仅把上游测试工具入口映射到 Vitest；原始源码与测试文件不改写。两份素材目录从 Mint 常规测试收集与 TypeScript 根文件中排除，运行引擎通过生成代码接受类型检查。测试、构建和浏览器检查顺序执行，统一使用一个工作进程；浏览器夹具先构建，再由临时服务提供。

首次运行浏览器检查需用 `pnpm exec playwright install` 安装测试浏览器，夹具使用本机端口 `5181`。如系统环境导致测试 Firefox 无法启动，可用 `MINT_EDITOR_FIREFOX_EXECUTABLE` 指定独立测试启动器，不修改用户浏览器配置或隐私权限。

## 升级或移除补丁

1. 明确新的上游提交，从对应归档重新获取同样的文件范围；核对来源、版本与许可证，重新生成逐文件校验清单，不复制锁文件。
2. 运行原始上游测试，检查上游新增功能及行为变化；更新 `series.json` 的基准提交。
3. 逐项应用补丁。上下文失败时人工检查差异并重做该补丁，不采用模糊合并，不直接编辑生成树。
4. 上游已有等价能力时，删除对应功能目录、清单项和重复依赖，更新剩余补丁的上下文与依赖。共享模块在全部使用方移除后才删除。数据正确性、安全和产品接入要求仍需验收。
5. 重新运行全部检查，核对主题、许可、文档及实际行为。记录有解释的上游测试差异；构建只消费已提交的快照和补丁，不在线获取上游。
