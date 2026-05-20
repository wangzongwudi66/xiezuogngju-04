# AIGC 视频协作工具

当前进度：M1 工作台已完成并可验收；M2 已接入交稿中心、交稿确认、发布/驳回、集工作台当前生效剧本、修订记录入口、diff 摘要占位与 docx 导出占位。Word 自动切段、剧本 diff、docx 导出工具已在领域层实现并有测试。M3 资产审核仍未开始。

## 技术选型

- Monorepo：使用 npm workspaces，`apps/web` 和 `packages/domain` 分离。前端原型可跑通业务路径，后续接 PostgreSQL 时可以复用领域类型与状态函数。
- Web：Next.js App Router + React + TypeScript。后续 M2/M3 会需要文件上传、导出任务、权限过滤和服务端路由，App Router 适合逐步接入。
- 领域层：`packages/domain` 保存 M1/M2 类型、seed 数据、权限、交稿包、集修订、当前生效剧本、Word 切段、diff 和 docx 导出工具。UI 不直接重写业务规则。
- 测试：Vitest 覆盖 M1 领域行为、M2 交稿主流程、Word 切段、diff、docx 导出和 Web 今日任务回归。
- UI：纯 CSS + lucide-react 图标。当前是工作台型产品原型，优先清晰的身份入口、权限边界、状态灯和交稿协作流程。

## 角色权限

- 项目所有者：最高权限，等同最高级统筹。
- 统筹：可管理项目、成员、权限、集分配；可查看全项目；M2 可发布或驳回交稿包。
- 主编剧：可查看项目总览与所有集状态；M2 可创建交稿包、确认实际变更集、提交给统筹待发布；不可发布/驳回。
- 编剧：可查看编剧相关项目上下文；可被分配“编剧负责”的集；当前不默认开放交稿发布。
- 创作者：只看自己负责的集、未读通知、当前剧本状态和关键变更；不显示项目管理、成员管理、集分配和交稿发布入口。

M1 已拆开三个概念：

- 成员与角色：这个人是否属于项目，以及在项目中是什么岗位。
- 权限分配：可对项目成员单独勾选管理项目、管理成员、分配集数、查看总览等权限。
- 集分配：这个成员负责哪几集，以及以什么分工负责。

## 目录结构

```text
.
├── apps/
│   └── web/
│       └── app/
│           ├── globals.css
│           ├── layout.tsx
│           ├── page.tsx
│           └── ui/
│               ├── dashboard-tasks.ts
│               ├── m1-dashboard.test.ts
│               └── m1-dashboard.tsx
├── packages/
│   └── domain/
│       └── src/
│           ├── index.ts
│           ├── script-diff.ts
│           ├── script-docx.ts
│           ├── seed.ts
│           ├── store.ts
│           ├── store.test.ts
│           ├── types.ts
│           └── word-delivery.ts
├── package.json
└── tsconfig.base.json
```

## 本地启动

```bash
npm install
npm run dev
```

通常打开：

```text
http://localhost:3000
```

如需固定监听地址和端口：

```bash
npm run dev -- --hostname 127.0.0.1 --port 3000
```

## 验证命令

```bash
npm run typecheck
npm run test
npm run build
```

一次性验证：

```bash
npm run verify
```

## M1 验收步骤

1. 打开首页，先看到登录/注册页，而不是直接进入工作台。
2. 选择“陈统筹 · 统筹”，点击“进入我的工作台”。
3. 统筹能看到项目总览、成员与角色、权限分配、集数分配、通知和状态灯。
4. 退出后选择“沈制作 A · 创作人”登录。
5. 创作者只看到自己的集、自己的负责集状态、通知和提示，不显示项目管理、成员与角色、集数分配和数据报表入口。
6. 注册新创作者 `linyu` 后，今日任务和我的集为空，并提示等待统筹分配，不出现伪造任务。
7. 统筹创建/编辑项目、保存成员角色、保存权限、分配集数后，页面状态会同步更新。
8. 搜索项目名，例如“潮汐”，点击结果会切换当前项目。
9. 点击未读通知的勾选按钮，未读数量会减少。

## M2 当前能力

领域层主干：

- `DeliveryPackage`：一次交稿包，状态为 `draft / pending_review / published / rejected`。
- `DeliveryPackageEpisode`：交稿包内解析出的单集内容，可在确认页标记是否为实际变更集。
- `EpisodeRevision`：发布后生成的单集剧本快照。
- `EpisodeCurrent`：每集当前生效剧本，始终指向最新影响该集的修订。
- `createDeliveryPackageDraft`：主编剧/统筹/项目所有者创建待确认交稿包，不生成修订。
- `updateDeliveryPackageConfirmation`：确认实际变更集。
- `submitDeliveryPackageForReview`：主编剧/统筹/项目所有者提交待发布。
- `rejectDeliveryPackage`：统筹/项目所有者驳回，不生成集修订。
- `publishDeliveryPackage`：统筹/项目所有者发布，只为确认变更集生成修订并更新当前生效剧本。
- `selectEpisodeScriptTimeline`：查询某集当前生效剧本与历史修订。

页面原型：

- 交稿中心：展示交稿包列表、状态、声明范围、实际变更集数量。
- 交稿确认：草稿状态下可勾选实际变更集，未勾选时给明确提示。
- 提交流程：主编剧可提交给统筹待发布。
- 审阅流程：统筹可发布或驳回，驳回不会生成快照。
- 集工作台：展示当前生效剧本、修订记录、diff 摘要入口，并可导出当前集生效剧本 docx。
- 创作者视图：不显示交稿中心，只能看到自己负责集的当前剧本状态和关键变更通知。

当前仍是本地 mock 数据原型：页面里保留预置交稿包演示流程，同时交稿中心已经接入 .docx 文件解析和粘贴文本解析，成功后会生成交稿包草稿并进入确认页。交稿解析已抽到 `/api/delivery-import-jobs`，返回切段任务状态、warning/error 数量和可创建草稿的 draft；API 也提供按任务 id 或项目查询的轮询入口。切段任务结果会暂存到本地 `.local-data/delivery-import-jobs.json`。前端会记录任务和关联草稿。本地浏览器会暂存工作台状态，用户菜单可重置原型数据。真实后端文件存储、异步队列和数据库持久化仍是后续工作。

## M2 测试覆盖

- range 交稿确认与提交。
- 非项目成员不能创建交稿包。
- 创作者不能创建、提交、发布或驳回交稿包。
- 主编剧可提交，但不能发布/驳回。
- 统筹驳回不生成快照。
- 1-10 后再 1-20 的 retroactive 修改，只更新确认变更集。
- single_replace 单集整集替换。
- 发布后给该集已分配创作者生成关键变更通知。
- Word 切段、剧本 diff、当前集 docx 导出工具函数。
- 新创作者没有分配集时，今日任务不出现伪造任务。

## 当前边界

- 登录/注册是 mock；浏览器端会用 localStorage 暂存当前原型状态，可从用户菜单重置为默认 seed 演示数据。
- 权限是前端原型和领域层函数校验，尚未接真实鉴权服务。
- M2 页面已接入 `/api/delivery-import-jobs` 交稿解析接口、浏览器端 .docx 解析、粘贴文本解析、切段任务记录和 localStorage 原型暂存；尚未接真实文件存储、异步切段队列和数据库持久化。
- docx 导出工具已实现，集工作台可从当前生效剧本触发下载。
- 不做 PDF。
- M3 资产位、候选、缩略图、定稿下载尚未开始。
