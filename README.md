# Lunar-Acceleration

一个更简单、现代的 CDN 加速控制面板。React + NestJS + Prisma，使用 MySQL 8 与 Redis。设计文档位于 `rede/`，不是 `/md/`。

## 本地开发

需要 Node.js 20+、pnpm 10、MySQL 8、Redis 7。证书回归测试还需要 `openssl`。

```bash
pnpm install --frozen-lockfile
cp apps/server/.env.example apps/server/.env
# 配置 MySQL、Redis、JWT、ENCRYPTION_KEY。
pnpm build:shared
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm dev
```

生产环境必须设置独立高强度 `JWT_SECRET`、`JWT_REFRESH_SECRET`、`ENCRYPTION_KEY` 与初始管理员密码。不要使用示例密钥。已有数据库升级前先备份，使用 `db:deploy`，不要用 `db push` 或重置数据库。

## 套餐与订单（M2）

支付仍是**模拟支付**，不会真实收款，不是支付渠道集成。数量表示购买期数，范围 1–120；同套餐续费延长有效期并保留用量。更换套餐采用全价即时切换，不折抵旧套餐。退款只允许能够安全回滚权益的订单，不能只标记退款却保留已支付权益。

公开站点配置采用分组和字段白名单；邮件、短信和其他凭据不能通过公开接口读取。管理端秘密值脱敏，编辑时未修改则保留原值。重复初始化不会覆盖管理员已经保存的站点、系统或厂商配置。配置保存不等于功能已上线。

## 域名与加速配置（M3）

M3 的控制面、证书自动化和安全探测已实现，包括：

- 域名创建、有效套餐及并发配额校验、标签和筛选、管理员审核、批量操作、CNAME 检测；域名创建可同时保存源站组。
- 缓存规则排序、路径/扩展名/状态码/请求头/查询参数等匹配类型、匹配模式、动作、TTL、自定义缓存键和查询参数策略。
- 源站组及 round-robin、加权、主备策略、单个源站状态与编辑，以及只探测已保存源站的健康检查。
- 证书上传、链结构/签名关系、公私钥匹配、有效期和域名覆盖校验；HTTPS、跳转、HSTS、TLS 配置和证书绑定。解绑会关闭依赖该证书的 HTTPS 设置。
- ACME DNS-01 手动签发、Cloudflare 自动 DNS 验证、签发任务查询/完成、续期及 Redis 持久队列扫描。签发资格复查、证书入库和任务完成在同一事务内提交。

所有用户资源按租户隔离；证书私钥和 ACME 临时私钥只加密存储，任务完成/失败/过期会清理临时密钥。证书 API 和审计不返回私钥。

主备配置采用 `primary_backup` 与源站的 `isBackup` 标记，要求一主及至少一备；编辑、删除、启停及策略转换都需要保持这一约束。这是可持久化的控制面配置，不代表自建节点或厂商已执行流量故障转移。

**保存配置、审核通过或 DNS 匹配都不代表已经加速。** 自建边缘节点和厂商配置下发尚未完成，启用请求仍明确拒绝，不会伪造上线。`CNAME_SUFFIX=example.invalid` 仅是开发占位；正式接入必须改成受控的调度域名。

健康探测只发出有界的 HEAD 请求，拒绝内网、环回、链路本地和非全球单播地址，检查全部 DNS 结果并固定连接地址，禁止重定向，设置 DNS 与 socket 的绝对超时。它不是内网探测功能，也不能替代生产出站防火墙。只传入明确选中的 `originIds`，不要发送无目标探测请求。

证书结构和链签名校验不等于验证到受信任根 CA；自签证书可用于开发。对外 HTTPS 仍需要受信任证书并实际部署到节点。

### 启用 ACME

默认不联系 CA。先配置 `ACME_EMAIL`、`ACME_ACCOUNT_KEY`、`ACME_DIRECTORY`，并明确设置 `ACME_ACCEPT_TOS=true`。账户私钥为 PEM 内容，支持实际换行或字面 `\n`，不是文件路径。支持的目录为 Let's Encrypt staging 和 production；优先使用示例中的 staging，staging 证书不受浏览器信任。

手动模式：通过 `POST /user/certificates/apply`（兼容 `/apply-acme`）申请，按返回任务显示的 TXT 记录配置 DNS，再调用 `POST /user/certificate-jobs/:id/complete`；可用 `GET /user/certificate-jobs/:id` 查询，或通过分页的 `GET /user/certificate-jobs` 找回自己的任务。证书页面提供恢复入口，刷新或重新进入页面不必重新申请。任务只允许本人操作，域名必须属于当前用户、审核通过且仍有有效套餐。TXT 分段只在同一条 DNS 答案内合并。

无人值守续期必须配置 `ACME_DNS_PROVIDER=cloudflare`、`ACME_CF_API_TOKEN`、`ACME_CF_ZONE_ID`，并在申请时选择 `autoRenew`。手动 DNS 不会被误标成可自动续期。此 token 需要对应 zone 的 DNS 编辑权限；服务只清理自己创建的挑战记录，不覆盖原有同名 TXT。清理受上游可用性影响，失败后应检查 DNS 是否遗留挑战记录。

设置 `ACME_WORKER_ENABLED=true` 后，由应用自己的 BullMQ worker 持续运行，使用 Redis 持久计划每天 UTC 03:00 扫描 30 天内到期的自动续期证书；失败按有界退避重试，重启后保留计划。必须长期运行应用 worker 和持久化的 Redis，不能依赖开发聊天或一次性命令。默认 worker 关闭，避免普通本地测试隐式联系 CA。

自动续期保持原证书 ID 和绑定关系。签发过程中发生域名删除、审核撤销、套餐失效或任务冲突时，不会把失效资格写成成功证书。

## 第三方厂商（M4：只读接入与受控注册任务）

管理端 `/admin/vendors` 提供厂商、凭据账号、连接测试、只读资源同步、日志及独立的云端注册/删除任务。只读能力默认可用，云写入默认关闭。不接受自定义 API endpoint，也不通过用户配置动态加载驱动。

Cloudflare 账号填写 API Token 和 Zone ID：连接测试读取 zone，自定义域名清单使用 Custom Hostnames API。账号需要相应只读权限，且所属套餐/zone 必须支持该功能。阿里云使用独立 RAM AccessKey ID/Secret 和 `cdn:DescribeUserDomains` 最小权限，固定官方 CDN endpoint，不读取运行环境的默认身份链。

凭据使用 AES-256-GCM 加密；列表与编辑只显示掩码，省略密钥则保留原值。管理员身份和 `vendor:read/create/update/delete/test/sync/deploy` 权限分别检查，普通用户即使误获厂商权限也不能调用管理端接口。只读权限不能授权云写入。

同步只拉取远端清单，给已存在的本地域名保存白名单观察快照，未知域名会忽略。不会创建域名、改变 CNAME/审核/启用状态、下发缓存或源站、上传证书、改动云资源或删除远端域名。分页失败不会保存部分结果，空清单也不会自动清除旧映射。同账号操作有过期租约和版本检查，避免测试、同步及密钥编辑互相覆盖。

### 显式启用云注册/删除

先应用数据库迁移并更新权限种子；使用管理员的 `vendor:deploy` 权限，在管理端选择账号及本地域名 ID，核对确认框后提交任务。`VENDOR_WRITES_ENABLED=true` 允许提交/执行云写入；`VENDOR_WRITE_WORKER_ENABLED=true` 才启动本应用的后台执行器。两者默认都是 `false`，普通测试不会隐式改动云资源。长期执行需要持续运行应用和数据库，不依赖聊天会话。

任务持久化到数据库，具有幂等键、同域名互斥、账号租约、凭据版本复查和脱敏结果。限流等确定未写入的失败可有限退避；超时、结果不明或执行器中断后的过期运行任务进入 `needs_review`，不得盲目重新创建。必须先到厂商侧核对实际资源，再由受控流程处理；不能通过换幂等键绕过待核查任务。

首批注册仅支持能力校验通过的基础单源配置，要求有效套餐、审核通过、套餐 `vendorId` 与所选账号厂商一致。管理端套餐页可以配置映射；未映射的旧套餐不会被自动猜测归属。不支持的缓存、回源策略或 HTTPS 配置会被明确拒绝，不能静默忽略。源站必须是公开地址，执行前重新检查；这不能约束云厂商以后自行解析 DNS，仍需生产出站策略和源站访问控制。

当前阿里云基础注册接受 HTTP:80 或 HTTPS:443 的单源配置，域名自然资源标识限 128 字符；Cloudflare 接受 HTTPS:443 的域名源站，不接受 IP 源站。域名回源协议必须与所选源站一致。以上是注册前能力校验，不证明厂商已按全部本地配置执行回源。Cloudflare 需要固定 Zone 的 Custom Hostnames 写权限及对应产品支持；阿里云写账号除清单读取外，需要显式授权 `cdn:AddCdnDomain` 和 `cdn:DeleteCdnDomain`。不要向只读账号追加全局管理员权限。

只有本面板成功注册并保存归属的资源才允许通过写入任务删除；只读同步发现的资源绝不自动认领。同步也不会覆盖已管理资源的注册标识。仍有已管理资源或未解决任务的账号不能删除凭据，避免留下无人管理的云资源。仅删除本地账号不会删除云资源。

清理自有云资源不要求用户仍启用、套餐仍有效或域名仍审核通过，因而软删除及撤审后仍可由管理员明确发起清理。已取得的安全远端 ID 会作为任务回执保留，包括后续本地落库失败或返回域名不符的情况。前端只显示后端标记为可安全重试的失败；显式重试会重新检查当前配置与凭据，不会自动重试不确定结果。

**注册成功仍不是部署上线。M4 尚待完成：** 完整缓存/回源策略、证书上传和绑定、刷新、地域调度及配置生效核验；本轮不自动启用本地域名，也不宣称 TLS 已部署。Cloudflare/阿里云的产品限制和写权限须分别核验，连接测试成功只证明当前只读接口可访问。需使用受控测试域名、最小权限账号及 ACME staging 完成真实联调后，才能作为生产接入能力验收。

M4 凭据账号与 ACME 的 DNS 编辑凭据是两条独立配置路径，不会互相自动复用。

写入请求契约依据：[Cloudflare Custom Hostnames 创建](https://developers.cloudflare.com/api/resources/custom_hostnames/methods/create/)、[删除](https://developers.cloudflare.com/api/resources/custom_hostnames/methods/delete/)；[阿里云 AddCdnDomain](https://www.alibabacloud.com/help/en/cdn/developer-reference/api-cdn-2018-05-10-addcdndomain)、[DeleteCdnDomain](https://www.alibabacloud.com/help/en/cdn/developer-reference/api-cdn-2018-05-10-deletecdndomain)。驱动回归覆盖实际生成 SDK 的请求序列化，但传输全部由本地假实现替代。

## 自动验收

```bash
pnpm build
pnpm typecheck
pnpm test
```

单元测试使用 Node 内置 `node:test`。真实数据库/HTTP 验收必须使用**专用、可丢弃且库名以 `_test` 结尾**的 MySQL 数据库；不要指向生产数据库。测试创建带唯一前缀的夹具，不会清空数据库。

```bash
export DATABASE_URL='mysql://test_user:test_password@127.0.0.1:3306/lunar_test'
export REDIS_HOST=127.0.0.1
export REDIS_PORT=6379
export ACME_WORKER_ENABLED=false
export VENDOR_WRITES_ENABLED=false
export VENDOR_WRITE_WORKER_ENABLED=false
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm test:integration
```

未提供测试库时集成测试会跳过；跳过不代表通过。回归覆盖 M2 配置安全、并发支付/退款和余额一致性，M3 租户隔离、并发域名配额、前后端载荷契约、缓存/源站、证书与 ACME 原子落库及任务恢复，以及 M4 凭据加密、权限、只读同步、同域名并发幂等、双工作器领取、凭据轮换、失败隔离、限流退避、过期租约及受控删除。

ACME 测试用假客户端与 SDK 的纯本地计算；M4 测试用假厂商传输。测试不会向真实 CA 提交申请，不会读写真实云账号。因此，本地验收不代替使用实际域名和最小权限账号的最终联调。

## React 19、shadcn/ui 与黑白玻璃界面

前端使用 React / React DOM 19.3.1、对应的 19.x 类型定义和 `liquid-glass-react@1.1.1`。Recharts 2 的 `react-is` 通过 `pnpm-workspace.yaml` 对齐至 19.3.1，避免升级后图表元素无法识别。升级 React 时应同步检查 React DOM、react-is 和锁文件；使用 `pnpm install --frozen-lockfile` 验证可复现安装。

全站日/夜配色均为黑白灰，包括状态、通知和原生控件。网站配置中的品牌色仅映射为对比度安全的中性色阶，不再把彩色 primary / ring 注入页面。状态仍保留文字、边框和填充区分，不依赖色相。导航和带文字的操作不再重复堆叠装饰图标；菜单、关闭、复制等必要操作保留可访问名称。本次不新增统计图表业务。

组件采用官方 [shadcn/ui](https://ui.shadcn.com/) New York 源码，并保留现有 Tailwind 3.4 和 React 19。`apps/web/components.json` 配置组件路径、主题和别名；具体来源与兼容调整记录在 UI 目录说明中。新增组件可使用 `pnpm dlx shadcn@latest add <component> -c apps/web`，升级或覆盖现有组件前先检查差异，保留已验证的业务接口和无障碍行为。

普通卡片、输入框、下拉框、弹窗和浮层只在组件自身使用 CSS `backdrop-filter` 毛玻璃，不再注入额外背景组件、SVG、高光层或纹理。页面背景是纯色；空状态、分页和说明区主要依靠留白、文字层级和对齐组织，不重复套卡片。面板采用大圆角，小控件使用一致的圆角与高度；主要操作保留高对比黑白填充。

液态折射仅由顶部栏和侧栏通过 `GlassSurface variant="liquid"` 显式启用，普通 `GlassSurface` 默认也是 CSS 毛玻璃。表格、表单和可选文本保持正常布局，不直接塞入库的绝对定位胶囊容器。导航尺寸变化时才重新测量液态背景，避免给内容区附加大量滤镜。

Safari / Firefox 对库的折射支持有限，仍保留统一的磨砂表面。减少动态效果、减少透明度、强制颜色或粗指针设备会使用轻量 CSS 后备；不支持 backdrop-filter 时回退到可读的实色面板。库不使用 WebGL shader 模式，也不为每个表面注册鼠标跟踪。玻璃层不接收点击、焦点或屏幕阅读器导航。

所有弹窗通过 portal 离开带滤镜的祖先容器，避免 fixed 遮罩被局部面板裁剪，并支持 Escape、焦点约束和关闭后焦点恢复。

shadcn/ui 的基础交互由 Radix UI 提供：Dialog、AlertDialog、Select、Switch、Checkbox、Tabs、DropdownMenu、Avatar、Label、Separator、ScrollArea。项目维护官方组件源码、黑白毛玻璃样式和现有业务接口的少量兼容，不自行实现焦点陷阱、列表框键盘导航或菜单状态机。破坏性操作统一使用官方 AlertDialog 组合的 `ConfirmAction`，打开、取消及 Escape 都不执行原操作，默认焦点在取消按钮。

页面主滚动保持浏览器原生行为，滚动条支持 Chromium/WebKit 与 Firefox 的中性色适配；侧栏和宽表格采用 Radix ScrollArea，保留可聚焦视口与原生滚动。正文采用流式字号，移动端表单控件保持 16px 以避免 iOS 聚焦缩放，弹窗使用动态视口高度与独立滚动。触屏滚动条加宽，强制颜色和减少动态效果均有后备。文件、日期等浏览器专有输入仍保留原生语义，只调整外观。

`pnpm test` 包含 JSDOM / Testing Library 的实际组件交互回归；可用 `pnpm --filter @lunar/web test:ui` 单独运行。覆盖下拉选择、禁用态、嵌套弹窗、Escape 和焦点恢复、危险操作确认、键盘切换、表单数据及可聚焦滚动视口。
