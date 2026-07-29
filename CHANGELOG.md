# 更新日志

**日期**: 2026-07-29
**说明**: 合同匹配新增公司代码校验与任务限期字段，完成挂单与任务系统解耦（listings 模块上线 + 旧 task 接取接口下线），补充 008 数据库迁移脚本与离线迁移工具

### ✨ Features

- **`contract-match`**：合同匹配新增公司代码校验与任务限期字段 —— 为 listing 任务添加 7 天合同签订限期到 `contractJson`；新增合同匹配时的公司代码校验逻辑；扩展 `ContractFingerprint` 类型以支持 `partnerName` 和 `partnerCode`；补充 `partnerName` 空值校验逻辑。
- **`listings`**：挂单与任务系统解耦 —— 新增 `listings` 表与相关服务、路由，支持单商品挂单发布 / 浏览 / 接取 / 取消；废弃 partial claim 父子任务逻辑，移除相关代码与工具函数；限制 `tasks` 接口仅支持单物品任务，多物品场景迁移至 `listings` 端点；添加数据库迁移脚本，新增 `listing_id` / `claim_seq` 字段并清理 `parent_task_id`；更新类型定义与校验规则，适配新的任务-挂单分离架构。
- **`tasks`**：新架构任务释放逻辑 —— 新增 `releaseListingClaim` 服务处理带 `listing_id` 的任务释放：恢复挂单剩余额度并物理删除任务，兼容老无 `listing_id` 任务的回退逻辑；新增 `restoreListingAmount` 仓库函数处理挂单额度恢复和状态修复。
- **`task`**：多物品任务批量创建与数据迁移 —— 重构任务创建逻辑，支持将单条多物品任务拆分为多条单物品子任务；新增批量创建任务接口，通过 `db.batch` 实现原子提交；新增数据迁移脚本，将存量多物品任务拆解为单物品子任务并标记旧任务为已取消；每条子任务生成独立审计日志，支持追溯拆分关系。
- **`task`**：任务部分接取 —— 新增数据库迁移脚本添加 `parent_task_id` 字段，支持关联子任务与原任务；新增任务接取校验 schema，支持传入 `amount` 参数指定接取量；重构 `claimTask` 和 `releaseTask` 逻辑，拆分出部分接取专用方法：部分接取时原任务保留发布状态并缩量，创建反向子任务承载接取量；支持释放部分接取的子任务，自动恢复原任务的接取额度；适配不同任务类型的反向合同逻辑。
- **`extension-users`**：扩展用户上报与组织统计 —— 新增 `extension_users` 表与相关服务，实现扩展用户上报接口；扩展用户列表与统计，新增非组织用户计数；调整用户角色类型定义，新增 `NON_ORG` 角色。
- **`tasks`**：发布者删除任务端点 —— 新增 `DELETE /tasks/:id` 路由，仅 publisher 可删自己发布的任务（`NOT_PUBLISHER` 403），BOARD 不允许代删；先写审计日志 `task.delete`（含 type/status/had_contract/had_claimer 元数据），再物理删除并返回删除前快照；`task_notes` 通过 FK CASCADE 自动清理。
- **`tasks`**：重新发布任务 —— 新增 API 接口，支持将 `CANCELLED` 状态任务恢复为 `PUBLISHED`；允许发布者在取消任务后修改内容重新发布，保留原有 `contractJson` 和 `expiresAt`；调整 `patchTask` 权限，允许编辑 `CANCELLED` 状态的任务。
- **`contract-match`**：权威匹配端点 —— 实现 `AUTO_LINK_CONTRACT.md` "方案 B（后端权威匹配）"，新增 `POST /tasks/:id/match-contract` 路由；`utils/contract-match.ts` 新增 `matchContractFingerprint`，以 `task.contractJson` 为 source of truth，应用反转规则后与前端上报 fingerprint 严格比对（price 容差 ±0.5%，items 集合等）；`services/match-contract-service.ts` 按 autoLink 选择直接 linkContract 或仅返回比对结果，写审计日志；`tests/contract-match.test.ts` 新增 21 个单测覆盖反转规则 / 价格容差 / items 集合等 / 缺字段 / location 不匹配 / SHIP 例外等。
- **`contract-json`**：`contractJson` 新增可选 `shipping` 字段（与 RUNCN 对齐）。

### 🔧 Improvements

- **`rprun-org-worker`**：008 数据库迁移脚本完善 —— 调整 008 迁移脚本顺序，适配 SQLite 删列前需先移除索引的限制，新增未终态孤儿任务兜底取消逻辑；新增离线批量迁移脚本，将已发布的老任务数据迁移至 `listings` 表以兼容市场展示；新增自动化迁移工具脚本，支持从生产数据快照生成标准插入 SQL。
- **`task, user`**：反向合同创建逻辑简化 —— 统一反向合同创建方为 publisher，删除旧的条件判断逻辑；为 `ExtendedOrgUser` 新增 `lastSeenAt` 字段，统一展示注册/未注册用户的最后活跃时间。

### 🐛 Bug Fixes

- **`tasks`**：释放任务时清空 `contract_id` 而非仅 `contract_creator` —— 旧合同关联随任务重新发布被彻底清除。
- **`auth`**：子任务权限校验逻辑 —— 新增 `findEffectivePublisherId` 方法获取任务实际发布者；在 `contract-sync-service`、`match-contract-service` 和 `task-service` 中替换原有 `publisher_id` 校验；优化列表查询"我的发布"的 SQL 逻辑，包含子任务的原始发布者场景。
- **`task-service`**：调整子任务删除校验逻辑 —— 允许已完成或已取消的反向子任务被物理删除，仅拦截进行中的子任务直接删除操作。
- **`contract-match`**：价格比对容错 —— 当顶层价格字段缺失时，通过商品条目计算总价来进行比对。
- **`task-service`**：待签约任务的状态流转 —— 补充待签约任务可直接流转至已完成状态的合法流转项。
- **`org`**：合同自动关联优先匹配发布者视角（不反转），`claimer` 作为 fallback。
- **`task`**：排除 SHIP/LOAN 类型任务的多物品拆解 —— 运输类任务（SHIP/LOAN）的 `items` 字段表示多段路线/多地点而非独立商品；SQL 脚本同步加对应类型过滤条件。
- **`task`**：修复 partial claim 子任务的列表和权限校验逻辑 —— 调整 published 任务列表过滤条件排除反向子任务；修复 claimed 任务列表的匹配逻辑包含反向子任务；新增取消和删除子任务的权限拦截。
- **`db`**：修复 SQLite/D1 的 `display_name` 默认值脏数据 —— 移除 `users` 表的 `display_name` 默认值；新增迁移脚本修正已写入的脏数据（将 `display_name` 为 `'prun_username'` 的行修正为实际用户名）；注册接口显式绑定 `display_name` 值；清理 `extension_users` 里的冗余脏数据。

### 📝 Docs

- **`config`**：替换原有 `workers.dev` 域名为自定义域名 `prun.kilmer.cn`；在 `wrangler.toml` 中添加自定义域名路由配置，备注 DNS 绑定要求。

---

## 26.7.21

### ✨ Features

- **`rprun-org-worker`**：initial commit —— 邀请制组织内的任务发布 / 接取 / 合同联动 / 董事会管理 REST API，部署在 Cloudflare Workers（D1 + Hono + Cron Triggers）；含完整的本地开发、D1 schema 迁移、引导 BOARD 用户、CORS / host_permissions 调试记录。