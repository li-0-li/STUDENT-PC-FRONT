/**
 * 媒体资源地址归一化（头像 / 图片 / 附件）
 *
 * ★ 2026-11-12 新增。解决的问题：`sys_user.avatar` 在运行库里存在 4 种格式，
 *   前端直接 `:src` 绑定时，只有其中一种能在浏览器里正常加载：
 *
 *   | 库里的值                                            | 来源                     | 直接绑定结果 |
 *   |-----------------------------------------------------|--------------------------|--------------|
 *   | `/files/AVATAR/2026/11/09/x.jpg`                    | LocalFileStorage（现行） | ✅ 正常       |
 *   | `/profile/avatar/2026/10/29/x.jpg`                  | 若依标准上传             | ❌ 404（vite 与 Nginx 都没代理 /profile） |
 *   | `/2026/10/08/x.png`                                 | 早期脚本写入，缺前缀     | ❌ 404        |
 *   | `http://localhost:9000/zhike/AVATAR/...?X-Amz-...`  | MinIO 预签名（ITAP_STORAGE_MODE=minio） | ❌ 部署后浏览器打不开内网 host，且 7 天过期 |
 *
 * 后端 `/files/**` 映射到 `itap.upload-dir`（默认 `./uploads`），
 * `/profile/**` 映射到 `ruoyi.profile`（默认 `./uploads/profile`），
 * 因此**所有本地存储路径都能通过 `/files/` 前缀访问到**，前端统一收敛到这一种即可，
 * 不需要 Nginx 再加 `/profile` 规则。
 *
 * 预签名 URL 的处理：MinIO 的 AWS4 签名绑定 Host，直接替换 host 会 403
 * （后端 `FileStorageServiceImpl.presign` 注释已写明这一点）。但**头像/图片展示不需要签名**——
 * 只要对象名拿到了，走后端 `/files/` 静态映射即可（local 模式下文件就在 uploads/ 里）。
 * 因此这里只提取 objectName 重拼 `/files/`，丢弃签名参数；若服务器是纯 MinIO 模式
 * 且未挂本地磁盘，需由部署侧把 `/files/` 反代到 MinIO（见 ffl 说明文档）。
 */

/**
 * 判断一个绝对 URL 是否为「对象存储直链」，需要改走同域 /files/。
 *
 * 除了内网 host，还有一类必须改写：MinIO 生成的预签名 URL，形如
 *   http://47.99.17.173:9000/zhike/AVATAR/2026/11/09/x.jpg?X-Amz-Signature=...
 * 它有两个致命问题：
 *   1) 页面是 HTTPS 时，加载 http:// 资源属 Mixed Content，浏览器直接 block；
 *   2) 签名把「当时那个公网 IP」写死在 URL 里，服务器节省停机重启换 IP 后全部失效；
 *      且预签名本身 7 天过期。
 * 所以只要认出是对象存储（9000 端口 / 带 X-Amz 签名 / 路径含 /zhike/），
 * 就剥出 objectName 改走同域 /files/，彻底摆脱 IP 与有效期。
 */
function isObjectStorageUrl(u) {
  if (u.port === '9000' || u.port === '9001') return true
  if (/[?&]X-Amz-(Signature|Credential|Algorithm)/i.test(u.search)) return true
  // 路径首段是已知 bucket 名（minio.bucket 默认 zhike）
  if (/^\/zhike\//.test(u.pathname)) return true
  return false
}

/** 内网/回环主机名：浏览器一定访问不到，必须改写 */
const PRIVATE_HOST_RE = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|minio|host\.docker\.internal)$/i

/** 私有网段：10.x / 172.16-31.x / 192.168.x */
function isPrivateIPv4(host) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false
  const [a, b] = host.split('.').map(Number)
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 127) return true
  return false
}

/**
 * 把 MinIO 预签名 URL 里的对象名抽出来。
 *   http://localhost:9000/zhike/AVATAR/2026/11/09/x.jpg?X-Amz-...  →  AVATAR/2026/11/09/x.jpg
 * bucket 名从第一段剥掉（minio.bucket 默认 zhike）。
 */
function objectNameFromMinioUrl(pathname) {
  // /{bucket}/{objectName...}
  const m = pathname.match(/^\/[^/]+\/(.+)$/)
  return m ? m[1] : ''
}

/**
 * 归一化任何媒体地址为浏览器可直接加载的 URL。
 *
 * @param {string} raw 原始值（可能为 null / '' / 相对路径 / 绝对 URL / data URI）
 * @param {'files'} [prefix] 相对路径补的前缀，默认 files
 * @returns {string} 可直接用于 img:src 的地址；无法识别时返回 ''
 */
export function resolveMediaUrl(raw, prefix = 'files') {
  if (raw == null) return ''
  const s = String(raw).trim()
  if (!s) return ''

  // data:image/... / blob: —— 前端本地预览，原样返回
  if (/^(data:|blob:)/i.test(s)) return s

  // 绝对 URL
  if (/^https?:\/\//i.test(s)) {
    let u
    try {
      u = new URL(s)
    } catch {
      return s
    }
    const host = u.hostname
    const isPrivate = PRIVATE_HOST_RE.test(host) || isPrivateIPv4(host)
    if (!isPrivate && !isObjectStorageUrl(u)) return s // 公网可达的普通外链（CDN / OSS 自定义域），原样使用
    // 内网 host 或对象存储直链：抽取对象名后改走同域 /files/
    const obj = objectNameFromMinioUrl(u.pathname)
    return obj ? `/${prefix}/${obj}` : ''
  }

  // 协议相对 //host/path
  if (s.startsWith('//')) return resolveMediaUrl(`http:${s}`, prefix)

  // 已经是 /files/ 或 files/
  if (/^\/?files\//i.test(s)) return '/' + s.replace(/^\/+/, '')

  /**
   * ★ 2026-11-13 后端 MinIO 只读代理前缀 /api/v1/files/obj/{对象名}
   *
   * 起因：小程序端 / 教师端发来的聊天图片，库里存的是这个前缀
   * （后端 MessageController 会把裸对象键按「文件在哪」归一成 /files/… 或 /api/v1/files/obj/…）。
   * 而本函数此前只认 /files/、/profile/、裸名三种，遇到 /api/v1/files/obj/RESOURCE/...
   * 会落到最后的「其他绝对路径补前缀」分支 —— 拼成 /files//api/v1/files/obj/...，
   * 双斜杠 + 错前缀，必然 404，表现为「别人发过来的图我看不到」。
   *
   * 剥成对象名后走 /files/{obj}：local 模式直接命中；MinIO 模式 404 一次，
   * 再由 mediaFallbackUrl 二跳回 /api/v1/files/obj/{obj}，两种部署都能出图。
   */
  if (/^\/?api\/v1\/files\/obj\//i.test(s)) {
    return `/${prefix}/` + s.replace(/^\/?api\/v1\/files\/obj\//i, '')
  }

  // 若依 /profile/ 前缀 → 后端 ruoyi.profile 就在 uploads/profile 下，走 /files/profile/ 同样可达
  if (/^\/?profile\//i.test(s)) {
    const rest = s.replace(/^\/?profile\//i, '')
    return `/${prefix}/profile/${rest}`
  }

  // 其他绝对路径（如 /2026/10/08/x.png 缺前缀）→ 补前缀
  if (s.startsWith('/')) return `/${prefix}${s}`

  // 纯相对路径（AVATAR/2026/... 或 2026/10/08/x.png）
  return `/${prefix}/${s}`
}

/**
 * 头像专用：拿不到可用地址时返回 ''，调用方据此回退到「首字母」占位。
 * 与 resolveMediaUrl 的差别仅在于**不把无意义的值当路径**（如 '0'、'null'、'undefined'）。
 */
export function resolveAvatarUrl(raw) {
  const s = raw == null ? '' : String(raw).trim()
  if (!s || s === '0' || /^(null|undefined|false)$/i.test(s)) return ''
  return resolveMediaUrl(s)
}

/**
 * ★ 2026-11-12 头像加载失败时的兜底地址：`/files/{对象名}` → `/api/v1/files/obj/{对象名}`。
 *
 * 为什么需要第二跳：`/files/**` 是后端把本机磁盘目录静态暴露出来，只有文件真在服务器
 * 磁盘上时才能命中。而生产是 MinIO 模式 —— 头像对象在桶里、磁盘上没有，`/files/...`
 * 必然 404（用户反馈「部署到服务器后头像显示失败」就是这个）。后端另开了一个 MinIO
 * 只读代理 `/api/v1/files/obj/**`（匿名 GET、按对象名流式返回），正好作为第二跳。
 *
 * 代价只是一次 404 后的重试，却能让「本地磁盘 / MinIO」两种部署形态用同一套前端代码，
 * 不必再依赖运维给 /files/ 加反代规则。仍失败才回退姓名首字。
 *
 * @param {string} url 当前已加载失败的地址
 * @returns {string} 可重试的代理地址；不是 /files/ 形式时返回 ''（表示没有第二跳）
 */
export function avatarFallbackUrl(url) {
  const s = url == null ? '' : String(url).trim()
  const m = s.match(/^\/files\/(.+)$/)
  if (!m) return ''
  // 已经是 /files/profile/... 这类二级前缀也一并代理（对象名就是 profile/...）
  return '/api/v1/files/obj/' + m[1]
}

/**
 * ★ 2026-11-13 附件（聊天图片 / 视频 / 文件）的二跳地址，语义同头像。
 *
 * 聊天附件与头像走同一套存储：local 模式文件在 uploads/ 下（/files/ 可直取），
 * MinIO 模式对象只在桶里（/files/ 必 404）。后端另开的匿名只读代理
 * `/api/v1/files/obj/**` 是唯一两种模式都能读的入口；它在 local 模式下会 404，
 * 所以顺序仍是「先 /files/，失败再 /obj」。
 */
export function mediaFallbackUrl(url) {
  return avatarFallbackUrl(url)
}

/**
 * 从任意形态的附件地址里抽对象名（如 `CHAT/2026/11/13/x.png`）。
 * 用于下载时回填原始文件名、以及判断两份地址是否指向同一对象。
 */
export function objectNameOf(raw) {
  const s = raw == null ? '' : String(raw).trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s)
      return objectNameFromMinioUrl(u.pathname)
    } catch {
      return ''
    }
  }
  // ★ 2026-11-13 也要剥掉后端代理前缀，否则文件名里会带上整条 /api/v1/files/obj/...
  return s
    .replace(/^\/+/, '')
    .replace(/^api\/v1\/files\/obj\//i, '')
    .replace(/^files\//i, '')
}
