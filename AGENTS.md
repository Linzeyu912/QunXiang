# 项目约定

## 语言
- **面向用户的所有 UI 文案、提示、错误信息、日志输出等,一律使用中文。** 不写英文,英文用户也看不懂。
- 代码内部的标识符(变量名、函数名、类名等)保持英文。
- 注释使用中文。

## Git 提交身份

- 本仓库新提交的作者和提交者固定使用 `Linzeyu <Linzeyu912@users.noreply.github.com>`，包括新建的同步提交。
- 提交前检查有效身份（含环境变量和工作树覆盖）。使用仓库本地配置 `user.name=Linzeyu`、`user.email=Linzeyu912@users.noreply.github.com`、`user.useConfigOnly=true`；不要设置全局身份。
- 新克隆或新工作树也须核对身份；`.git/config` 不随克隆分发。GitHub 网页合并不受本地配置控制，需要上述身份时在本地合并并核对后推送。
- 已有历史提交保持原样；未经用户明确要求，不改写已发布历史或强制推送。
