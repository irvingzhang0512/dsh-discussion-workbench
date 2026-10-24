/**
 * 设置层共享常量。
 *
 * 宿主注册的 settings namespace 与客户端设置卡片的 slot key 必须是同一个字面量
 * （设置页「插件配置」按 namespace 派发卡片），集中在此避免两半漂移；
 * 取值与包名一致，见 docs/architecture.md 的「配置契约」。
 *
 * 卡片头部展示的版本号**不在这里**：它由构建期从 `package.json` 注入客户端 bundle
 * （见 tsdown.config.ts 的 `define`），避免手写常量与包版本漂移。注意别在本文件或
 * 客户端源码的注释里写出那个注入标识符——构建产物会保留部分注释，标识符会因此出现在
 * bundle 文本里，触发「产物不出现注入标识符」的断言。
 */
export const SETTINGS_NAMESPACE = 'dsh-discussion-workbench';
