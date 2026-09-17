# v6.0.0 合并后构建差异审查

2026-09-17。只读比较工作树 `E:/学业/mafuyu_sekai-v6` 的长测产物与合并后原目录 `E:/学业/mafuyu_sekai` 的生产产物。本审查没有重新构建、运行浏览器或更改生产代码。两目录检查时的 HEAD 均为 `a65aa1cf35ddeb3dab7577e63a03a573bde76114`。

## 已严格确认

- `git ls-files -z` 列出的 398 个已跟踪文件在两目录全部存在。181 个文件的原始字节不同；仅将 CRLF 转为 LF 后，398 个文件差异为零。包含生产源码、配置、锁文件和原素材；二进制文件没有差异。
- 两目录实际使用同一个 `node_modules`：工作树的目录是 Junction，指向原目录的 `node_modules`。读取到的 Vite 为 8.3.0，Rolldown 为 1.2.8。`package-lock.json` 两份原始字节相同，SHA-256 为 `68fcfb4ca520592fcec7afad8eac5a66a7f31c59f03f1ba3a76da7f8f5ac675b`。
- CSS 文件名及内容相同，SHA-256 为 `b9a7ed773a1ecbdebb3467bab902491658beaa8ed43714003bc0b053f0f1eed7`。
- 两份主入口都是 531103 字节、507897 个 JavaScript 字符。Acorn 以 `sourceType: 'module'`、`ecmaVersion: 'latest'` 分词，各有 227611 个 token；按对应 token 的原始文本线性比较，仅 8 处不同。
- 这 8 处全部是分块引用：首行 `__vite__mapDeps` 数组的 7 个字符串，以及运行时动态导入 renderer 的 1 个字符串。前者除哈希变化外，CanvasPool 从第 6 项变为第 4 项。没有其他 token 差异。
- 将首行依赖映射统一为同一占位行，并将 renderer 文件名统一为 `renderer-HASH.js` 后，两份主入口逐字节完全一致，归一化 SHA-256 为 `65b77bd152556fcd3b3b4331b9998c06f06024723c4222de86ddc7523df36cf3`。这严格证明两份主入口里的游戏、模拟、界面执行代码一致；它不是仅比较文件长度所得的结论。

| 产物 | 长测工作树 | 合并后原目录 |
|---|---|---|
| 主入口 | `index-D-qbO7oo.js` | `index-MsWlHDVJ.js` |
| 主入口 SHA-256 | `7d1256022a84a0b7ed8fe860b65221a1f521b90ee94084782f19fa283a34387f` | `dda90126b7a94892a6a3a73c44705bdfa9c489f5b530efb0c0cd6041fb4c2761` |
| renderer | `renderer-L3-BJonv.js` | `renderer-DzHQ5bJ5.js` |
| renderer SHA-256 | `4c6061bb2cd1f48d92927b1ddfa530f20f727b2d53e5594b8c4f92a0039b940a` | `485256f4039e91b3263151e88bdec46fe5ef3010b540e1b5d118368ab0fb4b39` |
| CSS | `index-Sp0Q9i46.css` | `index-Sp0Q9i46.css` |

## 分块变化与原因边界

renderer 与 Geometry 不能仅去掉文件名哈希后得到完全相同的字节。Acorn 顶层声明检查显示 Pixi 的类和模块发生了重排，导入/导出压缩别名随之改变。例如，工作树 renderer 中以 `setBundleIdentifier`、`prefer`、`basePath` 为方法的资源解析器类出现在约 17159 字符处，原目录对应类出现在约 6293 字符处；Geometry 中的颜色类和点类顺序也不同。因此 renderer 的哈希变化不只是文件名相互引用造成的。

路径差异是合理原因，证据如下：

- 两份 Pixi 入口的 `realpathSync` 结果同为 `E:/学业/mafuyu_sekai/node_modules/pixi.js/lib/index.mjs`。
- 相对于工作树根目录，它是 `../mafuyu_sekai/node_modules/pixi.js/lib/index.mjs`；相对于原目录根目录，它是 `node_modules/pixi.js/lib/index.mjs`。
- 本地 Vite 默认 `resolve.preserveSymlinks: false`，解析文件时通过 `getRealPath` 使用真实路径（`node_modules/vite/dist/node/chunks/node.js` 的 `getRealPath` 及配置默认值）。因此两次构建中依赖位于根目录内还是外部，确实不同。
- 本地 Rolldown 默认分块模块排序为 `ExecOrder`，不是显式 `module-id` 排序（`bindingify-input-options-XQ0947n1.mjs` 的 `chunkModulesOrder` 默认值）。本审查不将“路径直接按字符串排序”当作已证实原因。

**尚未严格证明：**没有重新构建并捕获模块图/执行排序，不能断言 Junction 是重排的唯一原因，也没有形式化证明每个 Pixi 分块的完整语义等价。已证实的是：已跟踪输入归一化后一致、使用同一份依赖、主入口除依赖映射与哈希外完全一致、渲染依赖存在模块重排。换行差异没有改变主入口逻辑；是否参与构建内部排序也未单独隔离。

## 验证证据的使用

30 分钟长测仍归属于 `index-D-qbO7oo.js` / `renderer-L3-BJonv.js`，不能把它改标为原目录产物的逐字节验证。原目录浏览器流程回归、Vercel 提交状态及线上入口 SHA-256 核对由总发布记录另行登记。本说明不预先宣称这些检查通过。

比较采用线性 token/字节扫描，没有对压缩大字符串使用二次复杂度的序列匹配。
