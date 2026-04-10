# API 文档维护说明

本目录用于维护后端 HTTP 接口的标准文档，推荐作为“内部审查 + 对外暴露”的唯一事实来源。

## 文件说明

- `openapi.yaml`：OpenAPI 3.0.3 标准文档（内部全量）
- `openapi.public.yaml`：对外公开版（精简子集）

## 在线查看（Swagger UI）

- 内部版：`/api-docs`
- 公开版：`/api-docs/public`
- 原始文件：
  - `/api-docs/openapi.yaml`
  - `/api-docs/openapi.public.yaml`

## 推荐使用方式

1. 内部评审
- 评审接口变更时，先改 `server/index.mjs`，再同步更新 `docs/api/openapi.yaml`
- PR 中至少包含：接口路径、请求参数、返回结构、错误语义

2. 对外暴露
- 可直接导入 Apifox / Postman / Insomnia / Swagger UI
- 示例（Swagger UI Docker）：

```bash
docker run --rm -p 8080:8080 \
  -e SWAGGER_JSON=/spec/openapi.yaml \
  -v "$(pwd)/docs/api:/spec" \
  swaggerapi/swagger-ui
```

打开 `http://127.0.0.1:8080`

## 自动一致性校验

已提供校验脚本，检查“后端路由”和“OpenAPI 文档”是否一致：

```bash
npm run docs:api:check
```

校验公开版仅引用有效后端路由：

```bash
npm run docs:api:check:public
```

校验范围：
- 仅对 `server/index.mjs` 中 `/api/*` 的 HTTP 路由进行比对
- 比对维度是 `METHOD + PATH`

## 变更约定（建议）

- 新增接口：
  - 必须在 `openapi.yaml` 增加 path + requestBody + responses
- 变更字段：
  - 对外字段尽量向后兼容
  - 破坏性变更建议增量新接口（如 `/api/v2/...`）
- 废弃接口：
  - 在 OpenAPI 中标记 `deprecated: true`
  - 在 README 或变更日志中说明下线时间
