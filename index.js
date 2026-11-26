/**
 * Host 半区：V1 故意保持空壳。
 * 快照与站点表只存在 Client（dsh-app 页面 localStorage），Host 不注册服务、不碰文件系统。
 * 后续若需要 Host 能力（例如跨 profile 的凭据保管），在此导出 apply(ctx, config)。
 */
export function apply() {}
