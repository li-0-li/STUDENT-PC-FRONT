# page 层（页面级组件）

按 PRD §6.6 的组件三层规范：

| 层 | 目录 | 放什么 | 例子 |
|---|---|---|---|
| 基础层 | `components/base/` | 与业务无关的通用组件 | PageHeader、StatCard、EmptyState |
| 业务层 | `components/business/` | 跨页面复用的业务组件 | CourseCard、HomeworkItem、QuestionPanel |
| 页面层 | `components/page/` | 只服务某一个页面的组件，不可跨页复用 | 本目录 |

**规则**：页面层组件只允许被它所属的那个页面引用；一旦第二个页面要用，就上移到业务层。
页面层组件建议按端建子目录：`page/student/`、`page/teacher/`、`page/admin/`。
