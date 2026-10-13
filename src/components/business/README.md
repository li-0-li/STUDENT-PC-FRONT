# business 层（业务组件）

跨页面复用的业务组件。约定：
- 只依赖 `api/` 与 `components/base/`，不直接依赖某个页面
- 通过 props 传入数据，不在组件内部发请求（除非是自包含的小组件，如 CourseCard）
- 命名用业务名词，不用 `XxxBox` / `XxxWrap` 这类无意义后缀
