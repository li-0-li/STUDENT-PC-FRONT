# itap-web · 智能教学辅助平台前端

Vue 3 + Vite 5 + Vue Router 4 + Pinia + Element Plus + ECharts + Axios。

> 本工程是 **M0 分叉基线**中的「前端骨架」（PRD §6.4 / §7.2 里程碑 M0）。
> 骨架落进 `main` 之后，各端负责人才能从 `main` 切特性分支开发。

---

## ★ 本仓库的定位（2026-10-12 拆分后）

评审后改为「后端统一若依、前端一人一仓库」。**本仓库是 M-D 负责人的前端仓库**，内容是：

| 范围 | 页面 | 说明 |
|---|---|---|
| 学生 PC 端（stu-pc） | `views/student/` 14 页 + `views/shared/` 2 页 | 全量由 M-D 负责 |
| 认证页 | `views/login/` 3 页 | 公共 |
| **M-D 的 AI 学情页** | `views/teacher/` 4 页（学情 / 热力图 / AI 工作台 / 班级成绩）<br>`views/admin/` 2 页（数据看板 / AI 管理） | 接口都是 M-D 后端提供的，放同一仓库避免跨仓库调接口 |
| 其他端的菜单项 | `router/routes/others.js` 里的占位组件 | **仅保证菜单可点、不 404**；正式页面由张栎（教师 PC）/ 孟政凯（管理端）各自的仓库实现 |

后端：`SERVER-main` 的 **`ruoyi-student-pc`** 模块（若依 RuoYi-Vue 3.9.2 多模块工程，包 `com.ruoyi.student.*`）。

> ★ 2026-10-12 二次调整：老师口径澄清为「**在总项目下建一个模块，放自己前端要用的接口**」，
> 于是后端模块由 `ruoyi-md` 改名为 `ruoyi-student-pc` 并重新划界（移出 8 条不属于学生 PC 端的接口）。
> 详见该模块 `README.md` 的 §五、§六。

## ★ 接口口径变化（若依迁移，2026-10-12）

后端从自研框架切到若依。分两块看：

**① 若依自带入口**（登录 / 注册 / 登出 / 图形验证码 / 当前用户信息）—— 全端共用一套 SSO：

| 项 | 原来自研后端 | 现在若依 |
|---|---|---|
| 登录 | `POST /api/v1/auth/login` → `{accessToken, refreshToken}` | `POST /login` → `{code:200, msg, **token**}`（token 在**顶层**） |
| 登出 | `POST /api/v1/auth/logout` | `POST /logout` |
| 注册 | `POST /api/v1/auth/register` | `POST /register` |
| 图形验证码 | 无（纯前端 canvas） | `GET /captchaImage` → `{captchaEnabled, uuid, img}`；关闭时自动退回本地 canvas |
| 成功码 | `code === 0` | `code === 200` |
| 提示字段 | `message` | `msg` |

**② 业务接口**（`ruoyi-student-pc` 模块提供的 46 条）—— 口径**不变**：

- 响应体仍是 `{ code, message, data }`，**成功码仍是 0**
  （全组 2026-09-28 裁决口径；模块内的 `com.ruoyi.student.common.Result` 与管理端
  `com.ruoyi.admin.common.Result` 逐字段一致）
- 分页仍是 `{ list, total, page, pageSize }`
- 调用路径与迁移前完全一致（`/api/v1/courses`、`/api/v1/users/me` …），页面代码一行都不用改

`src/api/request.js` 里的拦截器已**同时兼容两套**（`code 0 或 200`、`msg 或 message`、
以及「若依把数据放顶层、没有 data」的情况），所以：

- `await courseList()` 拿到的仍然是 data
- 曾经 `/api/v1/auth/captcha/send`、`/api/v1/auth/password/reset`（表 2-3 / 2-4）
  **自研后端从未实现、若依也不提供**，属既有缺口，`api/auth.js` 保留占位函数

请求头仍是 `Authorization: Bearer <token>`（若依 `token.header` 默认就是它），token 存 `sessionStorage`。

---

## 快速开始

```bash
npm install
npm run dev        # 学生 PC 端端口 8081（团队约定：后端 8080 / 学生 PC 8081 / 教师 PC 8082 / 管理端 8083）
```

后端未起时也能跑：登录接口会失败并提示，但路由、菜单、布局可正常浏览。

```bash
npm run build      # 产物在 dist/
npm run preview    # 本地预览构建产物
```

## 接口约定

- 统一前缀 `/api/v1/`，实时通道 `/ws/`；开发环境由 Vite 代理转发到 `http://localhost:8080`
- 统一响应体 `{ code, message, data }`，`code === 0` 为成功
- **`axios` 已在 `src/api/request.js` 统一封装**：注入 token、解包 `data`、`code` 非 0 统一提示、401 跳登录
  → 页面里 `await courseList()` 拿到的**直接就是 data**，不要再判断 `code`
- 错误码：`400 / 401 / 403 / 404 / 409 / **422** / 429 / 500 / 503`

## 开发期接口 Mock（后端骨架就绪前先用这个）

后端骨架还没搭，所以内置了一层 Mock，**前端可以完全独立跑通、自测**。

- **开发环境默认开启**（`npm run dev` 直接就能登进去看页面）
- 想连真实后端：建 `.env.development` 写 `VITE_USE_MOCK=0`（`.env*` 不入库，见 `.env.example`）
- 生产环境默认关闭

登录 Mock 账号（密码随便填 ≥ 3 位；账号开头决定角色）：

| 账号 | 角色 | 跳转 |
|---|---|---|
| `stu2200850123` | 学生 | `/student/courses` |
| `t2018003` | 教师 | `/teacher/courses` |
| `admin` | 管理员 | `/admin/dashboard` |

改 Mock 后跑冒烟测试，确认没改坏：

```bash
npm run test:mock     # 26 条断言，覆盖路由匹配、路径参数、响应体形状、错误码
```

> ⚠️ Mock 只是让页面能跑起来的假数据，**不代表接口实现**。后端接通后请尽早关掉。

### 已 Mock 的接口

`auth/login`、`auth/register`、`auth/captcha/send`、`auth/password/reset`、`auth/logout`、
`users/me`（GET/PUT 密码/PUT 资料/POST 头像/PUT 通知偏好/POST 注销）、
`auth/certification`、`auth/devices`（列表/下线）、`auth/phone`、`auth/school-bind-apply`、`reports`、
`courses`（列表/详情/加课/资源）、`assignments`、`notifications`、`conversations`。

**未登记的接口会返回 404 +「Mock 未覆盖该接口」** —— 这是有意的，避免静默返回空数据让人误以为接口通了。

## 目录结构

```
src/
├─ api/                接口层（按端分包）
│   ├─ request.js      axios 统一封装（公共代码）
│   ├─ auth.js         公共域接口 表 2-1 ~ 2-16
│   └─ student/        学生端接口（按模块分文件）
├─ components/
│   ├─ base/           基础层：与业务无关的通用组件
│   ├─ business/       业务层：跨页面复用的业务组件
│   └─ page/           页面层：只服务单个页面
├─ layout/
│   ├─ menus.js        三端菜单定义（移植自原型 shell.js，权威）
│   └─ PcShell.vue     顶栏 + 侧栏 + 内容区
├─ router/
│   ├─ index.js        路由入口
│   ├─ guard.js        登录校验 + 标题
│   └─ routes/         auth.js（认证页）/ student.js（学生 PC 端）/ others.js（教师·管理占位）
├─ store/              Pinia（只放跨页面共享状态）
├─ styles/
│   ├─ tokens.css      设计 Token（移植自原型 theme.css，唯一视觉来源）
│   └─ global.css      全局基础样式与工具类
├─ utils/
└─ views/
    ├─ login/          登录 / 注册 / 找回密码
    ├─ student/        学生 PC 端 15 个页面
    ├─ teacher/        教师 PC 端（占位）
    ├─ admin/          管理端（占位）
    └─ mp/             小程序端（独立工程，仅占位说明）
```

## 三端分工与文件归属

| 端 | 分支前缀 | 负责人 | 目录 |
|---|---|---|---|
| 管理端 | `admin` | 孟政凯 | `views/admin/` |
| 教师 PC 端 | `tch-pc` | 张栎 | `views/teacher/` |
| 教师 App 端 | `tch-mp` | 杨超 | 独立小程序工程 |
| 学生 PC 端 | `stu-pc` | 刘浩艺 | `views/student/` |
| 学生 App 端 | `stu-mp` | 刘潮超 | 独立小程序工程 |

## ⚠️ 开发前必读：两条铁律

1. **公共代码只在 `main` 上改**：`api/request.js`、`layout/`、`router/`、`styles/`、`components/base/`、
   `package.json`、`vite.config.js`。要改就单开 `chore/` 或 `refactor/` 分支先合并。
2. **同一文件不得被两条分支并行修改**。
   `router/routes/others.js` 目前由教师端与管理端**共用**，两位负责人先在 `main` 上把它拆成
   `teacher.js` / `admin.js` 再各自开发。

## 页面与接口对照

学生 PC 端每个页面关联的接口表号，写在文件头注释与 `router/routes/student.js` 的 `meta.apis` 里。
完整对照见仓库 `docs/学生PC端-页面接口表映射.md`；验收标准见 `docs/学生PC端-验收用例.md`。
