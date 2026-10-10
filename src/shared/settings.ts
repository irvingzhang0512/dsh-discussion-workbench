/**
 * 设置层共享常量。
 *
 * 宿主注册的 settings namespace 与客户端设置卡片的 slot key 必须是同一个字面量
 * （设置页「插件配置」按 namespace 派发卡片），集中在此避免两半漂移；
 * 取值与包名一致，见 docs/architecture.md 的「配置契约」。
 */
export const SETTINGS_NAMESPACE = 'dsh-discussion-workbench'
