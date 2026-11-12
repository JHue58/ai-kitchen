# AI Kitchen

一个 Go + React 的私人厨房助手。支持多用户账号、厨房与饮食档案、OpenAI Compatible 模型、DeepSeek Search / Fetch、异步生成、菜谱保存与版本、烹饪计时、购物清单、价格与营养计算，以及浅色 / 深色主题。无密钥时厨房、账号与库存仍可使用，生成入口会明确提示未配置。

## 本地启动

需要 Go 1.24+、C 编译器（SQLite 的 CGO 驱动使用 GCC；Windows 可使用 MinGW/TDM-GCC）、Node.js 22+。

Windows CMD：

```bat
start.cmd -host 127.0.0.1 -port 8080
```

Linux / macOS：

```sh
sh start.sh -host 127.0.0.1 -port 8080
```

脚本首次复制 `config.example.yaml` 为本地 `config.yaml`，安装前端依赖、构建并启动 Go。访问 http://127.0.0.1:8080 。监听局域网可传 `-host 0.0.0.0`。默认数据库位于 `backend/data/kitchen.db`。不含演示账号或预设密码。

开发时开两个终端：

```sh
cd backend
go run ./cmd/server -config ../config.yaml
```

```sh
cd frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

Vite 将 `/api` 代理到 8080。如果修改后端端口，同时修改 `frontend/vite.config.ts` 的代理地址。正式部署使用 Go 同源托管构建结果，不需要 Vite。

## 配置 AI

生成一道菜和一桌菜单时，「更多偏好」中的「优先复用我的历史菜品与菜单」默认开启。开启后 Agent 会先调用 `search_existing_dishes`，在当前用户的独立菜品及历史菜单中按名称、食材、排除食材、标签、人数、费用和时长组合筛选，支持分页；命中后通过 `reuse_from` 引用加载原始菜谱，无需模型重新输出食材和步骤。可以混合历史菜品与新菜，全部复用时无需联网查询做法，已有配图和来源会保留。复用仍按当前库存、价格、过敏忌口、设备和时间线重新核算与校验；目前仅直接复用人数一致的版本，需更改用量、食材或设备时重新生成。API 请求字段 `reuse_existing` 省略或为 `true` 时开启，设为 `false` 时不注入历史搜索工具与复用提示词。复用结果保存为独立快照，删除原食谱不会影响已交付结果。

编辑服务器上的 `config.yaml`：

```yaml
llm:
  enabled: true
  base_url: "https://api.deepseek.com"
  api_key: "在此填写服务器密钥"
  model: "填写供应商提供的模型 ID"
  timeout_seconds: 120
  temperature: 0.7
  max_tokens: 8000
  vision_enabled: false
images:
  timeout_seconds: 60
deepseek_search:
  enabled: true
  base_url: "https://api.deepseek.com"
  api_key: "填写搜索密钥"
  result_count: 5
  need_content: true
  max_fetch_pages: 2
  cache_ttl_minutes: 1440
```

修改后重启。Compatible API 的 `base_url` 应包含供应商要求的版本前缀；后端在其后追加 `/chat/completions`。视觉识别使用同一个模型，仅在模型确实支持图片时开启。图片最多 4 张，总大小默认 10 MB，识别后必须在界面确认；上传内容仅在请求期间处理，不永久保存照片。

所有配置均支持 `KITCHEN_` 前缀的环境变量覆盖，例如 `KITCHEN_LLM_API_KEY`、`KITCHEN_LLM_BASE_URL`、`KITCHEN_AUTH_ALLOW_REGISTRATION`、`KITCHEN_DEEPSEEK_SEARCH_API_KEY`。环境变量使用 YAML 字段名并转大写。密钥不会传到前端，也不记录到应用日志。`config.yaml` 已被 Git 忽略。

Search / Fetch 协议依据 [Search 官方文档](https://api-docs.deepseek.com/zh-cn/api/search/) 与 [Fetch 官方文档](https://api-docs.deepseek.com/zh-cn/api/fetch/)。Agent 自主规划搜索词并调用 Search，正文不足时可对任意公开 HTTP(S) 链接调用 Fetch（不要求事先搜索），不提供任意 URL 代理接口。菜谱生成阶段只查询做法，image 填 null；完整菜单保存并标记完成后立即交付。联网开启且视觉模型可用时，独立后台任务按已确定的菜品搜索成品图，由配图 Agent 提取候选并通过 view_image 核验，逐张补写。配图总超时由 images.timeout_seconds 独立配置，默认 60 秒（环境变量 KITCHEN_IMAGES_TIMEOUT_SECONDS），不占用菜谱生成时限；失败或超时保留菜单与已获得的图片，页面自动刷新补图，其他菜品使用默认示意图。服务重启会结束未完成的配图，不影响已交付菜单。最终菜单使用 JSON 模式，后端检查必填字段、类型和业务约束，不合规时有限重试修正，仍不合规则任务失败，不保存不完整结果。缓存持久保存在数据库。任务记录 Search / Fetch 逻辑调用次数（不包含同一次逻辑调用的重试次数）。408、429、5xx 最多重试两次；401 和 402 返回脱敏配置 / 余额提示。联网失败会保留提示并回退模型生成。

## 注册与管理员

默认开放注册，密码至少 10 字节。可在配置里关闭注册或设置邀请码。首次管理员仅通过命令初始化，不提供网页自我提权。

PowerShell：

```powershell
$env:KITCHEN_ADMIN_PASSWORD = Read-Host '输入管理员密码' -MaskInput
cd backend
go run ./cmd/server -config ../config.yaml -init-admin admin
Remove-Item Env:KITCHEN_ADMIN_PASSWORD
```

Linux shell：

```sh
read -rs KITCHEN_ADMIN_PASSWORD
export KITCHEN_ADMIN_PASSWORD
cd backend
go run ./cmd/server -config ../config.yaml -init-admin admin
unset KITCHEN_ADMIN_PASSWORD
```

存在管理员时命令拒绝再次初始化。登录后管理员可管理用户、全局额外标签、注册开关。管理员在界面修改注册开关后，数据库值优先于配置；删除 `settings` 表中 `registration` 记录可恢复配置控制。普通用户不能看到其他用户的档案、任务和菜谱。分享链接为随机不可预测的公开链接，拥有链接的人可读取菜谱；删除菜谱后链接失效。

## Docker Compose

```sh
cp config.example.yaml config.yaml
# 填写模型配置；公网 HTTPS 部署设置 auth.secure_cookie: true
docker compose up -d --build
```

默认 8080 端口，环境变量 `PORT` 可修改映射端口。SQLite 已嵌入 Go 服务，无需单独数据库容器。`kitchen-data` 卷持久保存数据库及 uploads 目录，配置以只读方式挂载。容器以非 root 用户运行并带健康检查。不要执行 `docker compose down -v`，它会删除数据卷。

容器初始化管理员（先安全地在当前 shell 设置 `KITCHEN_ADMIN_PASSWORD`）：

```sh
docker compose exec -e KITCHEN_ADMIN_PASSWORD kitchen /app/kitchen -config /app/config.yaml -init-admin admin
```

上线时建议由 HTTPS 反向代理转发到服务，保留 Host 头；使用 HTTPS 时设置 `secure_cookie: true`。应用使用 HttpOnly、SameSite=Strict 会话 Cookie，写请求校验 CSRF Token 与 Origin，bcrypt 密码哈希、认证限流、生成频率限制和用户归属校验。

## 数据与备份

数据库默认 SQLite，也支持 `database.driver: postgres` 与相应 DSN。切换驱动不会自动复制已有数据；应备份后执行受控的数据迁移。迁移版本由 `migrations` 表记录，在事务中执行。结构采用用户归属的聚合文档：炊具、库存、价格、偏好、菜谱及其菜品/食材/步骤/来源、购物清单、反馈和烹饪历史保存在 `documents` 中；账号、会话、任务、缓存、全局设置独立建表。菜谱详情和计算结果作为完整快照保存，新版本记录 `parent_id`。

本地备份：先停止服务，再复制整个 `backend/data/`（包含数据库、WAL 等伴随文件）；恢复时停止服务并还原该目录。不要只复制运行中的 `.db` 文件。

容器备份示例：

```sh
docker compose stop kitchen
docker compose cp kitchen:/app/data ./backup-data
docker compose start kitchen
```

恢复时先停止服务，用 `docker compose cp ./backup-data/. kitchen:/app/data/` 还原完整目录并确保 UID 10001 可读写，再启动。恢复会替换现有数据，应先另存当前备份。

## Agent 与独立资料库

- 生成模型需要支持 Chat Completions 的 `tools` / `tool_calls`。Agent 保留多轮对话和工具结果，每次规划最多 12 轮、24 次工具调用，最终校验失败最多重试一次规划，每个任务最多搜索 4 次，网页读取上限由 `max_fetch_pages` 控制。
- 工具包括 `search_web`（统一搜索网页、菜谱和图片候选）、`view_image`（仅在菜单交付后的后台配图阶段提供，检查菜品匹配度和清晰度）、`fetch_page`（读取已发现网页）和 `check_menu`（费用、营养、食材、设备及时间约束检查）。联网配置可用时默认开启，用户可关闭；旧 `default_enabled` 配置保留兼容，但不再决定默认状态。
- 灵感、混合、限制模式写入 system prompt。灵感模式隐藏指定食材及照片识别输入，并忽略此前指定的食材；混合模式优先使用指定食材；限制模式仅允许指定食材及库存调料。最终约束仍未满足的结果不会保存为成功任务。
- 个人设置可保存仅对当前账号生效的全局提示词；管理员设置可保存对所有用户生效的系统全局提示词。两者均支持最多 10000 字和清空，在任务开始执行时读取，自动带入菜单、单菜、工具调用及自动修正的 prompt。优先级为内置安全与输出约束 > 系统全局提示词 > 个人全局提示词。设置保存在数据库，无需修改配置文件或重启服务；已执行中的任务沿用开始时的设置。
- “灵感厨房”统一提供“一桌菜单 / 一道好菜”切换，“我的食谱”统一提供“我的菜单 / 我的菜品”切换。原 `/inspire-dish`、`/recipes`、`/dishes` 及详情链接继续有效。菜单详情可将任意一道菜独立保存；两者的保存、收藏、删除互不影响。
- `/documents/recipes` 保留旧菜单接口名称，独立菜品使用 `/documents/dishes`。两者均支持 `q`、重复 `tag`（全部匹配）、`servings`、`min_cost`、`max_cost`、`saved=true`、`favorite=true` 筛选。`POST /recipes/:id/dishes/:index` 从本人菜单保存菜品快照（index 从 0 开始）。
- `POST /generate` 新增 `target: "menu" | "dish"`（省略为菜单）；`search` 省略时按联网配置自动开启。任务的 `result_kind` 指明结果资料库，`recipe_id` 保留为兼容的结果 ID。
- 首次升级自动在事务中把旧菜单中的菜品复制到独立资料库，继承保存和收藏状态；迁移只执行一次，不修改或删除旧菜单。

## 生成和计算规则

- 单进程后台 Worker 从数据库领取任务，前端每 1.5 秒轮询真实阶段。工作记录包含规划轮次、实际搜索词、读取站点、工具完成/失败、候选方案约束检查及最终保存；不展示模型内部推理。事件持久化，刷新可恢复；非流式供应商请求期间展示等待状态，不伪造百分比。重启时待处理任务保留，中断的运行任务标记失败，可重新生成。适合单实例的小规模部署。
- 模型输出经类型和范围校验；后端重算食材成本、营养和时间线，校验人数、食材模式、禁忌、设备、时间冲突与预算。失败时要求一次修正，仍不满足则报告具体约束问题，任务标记失败。
- 成本以个人单价优先，缺失时使用 AI 单项估价；质量与体积不会直接互换，“个”只有可食重量估算时才计算质量营养。未知价格不当作免费，而在详情标记缺失。营养采用个人数据、内置参考数据、AI 估算的顺序。
- 库存按名称区分已有与待购，当前不自动扣减库存，也不判断库存余量是否足够。购物清单按名称和兼容单位合并；新购成本是食材消耗金额，不是整包购买价。
- 每个步骤包含相对开始时间，以最晚完成时间估计整餐耗时；同一设备时间重叠会警告。电费只计算已知功率电器的实际计划加热时长，展示满功率理论值和可选占空比估算。
- 食品安全和设备容量还依赖模型判断及用户核对，系统不具备完整过敏原同义词库、设备厂商参数库或医学级营养数据库。内置常见食材数值仅为参考，所有营养结果均为估算。

## 测试

```sh
cd backend
go test ./...
go vet ./...
cd ../frontend
npm run build
```

测试覆盖会话与 CSRF、跨用户写入 / 删除隔离、管理员权限、持久化、JSON 结构、单位换算、价格优先级、营养、电费与未知值，以及模拟供应商 Agent → Search → Agent → Fetch → Agent → check_menu → 最终计算 → 独立保存的端到端流程和缓存复用。测试上游为本地 HTTP 服务，不需要付费密钥，不会将测试数据注入实际数据库。

真实供应商验收：注册 → 添加炊具和库存 → 设置偏好 → 填写生成条件 → 开启联网 → 生成 → 查看来源和计算 → 收藏 / 保存 → 做饭模式 → 退出再登录检查数据。真实模型调用需要配置有效密钥，自动测试不能替代供应商实测。

## 界面与动效

前端采用奶油白、柔和青绿与暖橙的厨房视觉，支持浅色、深色及跟随系统，可在工具栏直接切换。进入页包含三组可切换的本地食物摄影场景，页面也保留随时重新查看的入口。桌面侧栏、平板收拢侧栏和手机玻璃底栏按屏幕宽度自适应；菜谱以大幅照片、紧凑食材与步骤、四色营养卡组织内容。

AI 制作时展示彩色跑马边缘、呼吸渐变、液态形变和真实阶段记录，完成后逐段呈现菜谱。界面以第一人称表达，遵循系统 `prefers-reduced-motion` 设置。食物摄影和厨房图标均来自本地资源；默认示意图有明确标识，不代表对应菜品实拍。后端接口和计算逻辑保持原样。
