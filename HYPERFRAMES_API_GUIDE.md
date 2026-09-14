# HyperFrames 渲染服务现状与 API 封装指南

本文档基于 **HyperFrames v0.8.33** 在 Hugging Face Space 的实际部署与验收结果编写，记录了当前已经验证跑通的完整渲染链路、接口调用规范、存储映射机制，以及后续将该能力封装为标准业务 API 的工程设计与操作指引。

---

## 一、当前部署现状与基础架构

### 1.1 基础设施概览

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Hugging Face Space: matitie/hyperframes                              │
│                                                                      │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ 官方 Docker 容器环境 (Dockerfile: packages/gcp-cloud-run)         │ │
│ │                                                                  │ │
│ │ • Runtime: Node.js 22 + Bun 1.3.9                                │ │
│ │ • Browser: Chrome Headless Shell 148.0.7778.167 (BeginFrame)     │ │
│ │ • Video Encoder: FFmpeg 5.1.9 (x264, Noto CJK 全套字体)          │ │
│ │ • Core Engine: HyperFrames Producer Orchestrator v0.8.33         │ │
│ │ • Server: Hono HTTP Server (监听 8080 端口)                      │ │
│ └──────────────────────────────────┬───────────────────────────────┘ │
│                                    │ 自动挂载卷                       │
│                                    ▼                                 │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ 容器挂载目录: /data                                              │ │
│ └──────────────────────────────────┬───────────────────────────────┘ │
└────────────────────────────────────┼─────────────────────────────────┘
                                     │ 实时持久化同步
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Hugging Face Storage Bucket: matitie/hyperframes-storage             │
└──────────────────────────────────────────────────────────────────────┘
```

- **Space 实例**：`matitie/hyperframes` (私有 Space，需带 HF Token 鉴权)
- **HTTP 访问域名**：`https://matitie-hyperframes.hf.space`
- **内部监听端口**：`8080` (通过 Space Frontmatter `app_port: 8080` 反向代理)
- **存储 Bucket**：`matitie/hyperframes-storage`，只读权限 `false`，挂载于容器内 `/data`

### 1.2 极薄适配层设计

保持官方内核不被侵入修改：
在 `packages/gcp-cloud-run/src/server.ts` 中引入官方 `@hyperframes/producer` 原生导出的 `createProducerApp`，将其路由挂载至根路径，同时在服务启动时执行 `primeChrome()` 预热无头浏览器路径。

---

## 二、已经验证跑通的核心接口

以下接口已在 Space 容器内完全验证，并成功输出首个 1080P/30FPS/3秒 MP4 视频到 Storage Bucket。

### 2.1 同步渲染接口：`POST /render`

接收 HTML 动效源码，驱动 Chrome BeginFrame 逐帧截取并交由 FFmpeg 编码，最终写入指定路径。

- **URL**: `https://matitie-hyperframes.hf.space/render`
- **Method**: `POST`
- **Headers**:
  - `Authorization: Bearer <HF_TOKEN>`
  - `Content-Type: application/json`

#### 请求参数 (Request Body)

```json
{
  "html": "<!DOCTYPE html><html>...</html>",
  "outputPath": "/data/20260904/video-001.mp4",
  "fps": 30,
  "quality": "high",
  "format": "mp4"
}
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :---: | :---: | :--- |
| `html` | `string` | 是 | - | 完整可独立渲染的 HTML 网页（包含 GSAP/CSS/DOM 等动效逻辑） |
| `outputPath` | `string` | 否 | 随机生成 | 输出绝对路径。传入 `/data/...` 可直接将产物存入持久化 Bucket |
| `fps` | `number \| string` | 否 | `30` | 帧率，如 `30` 或 `60` |
| `quality` | `string` | 否 | `"high"` | 质量档位：`"draft"` / `"standard"` / `"high"` |
| `format` | `string` | 否 | `"mp4"` | 格式：`"mp4"` / `"webm"` / `"mov"` |
| `outputResolution` | `string` | 否 | 原生尺寸 | 超采样分辨率预设，如 `"landscape-4k"` / `"1080p"` 等 |

#### 响应结果 (Response Body)

```json
{
  "success": true,
  "requestId": "65a2d61f-caeb-4169-ba4a-cb7372bd10b4",
  "outputPath": "/data/20260904/video-001.mp4",
  "outputToken": "7b049d59-bf75-47e9-a417-0941913fb9ef",
  "outputUrl": "/outputs/7b049d59-bf75-47e9-a417-0941913fb9ef",
  "fileSize": 405627,
  "durationMs": 51956
}
```

| 字段 | 说明 |
| :--- | :--- |
| `success` | 渲染是否成功 |
| `outputPath` | 视频在容器/Bucket 内的绝对保存路径 |
| `outputToken` | 下载 Token（15 分钟内有效） |
| `outputUrl` | 临时 HTTP 下载路由，对应 `GET /outputs/:token` |
| `fileSize` | 视频文件大小（字节） |
| `durationMs` | 渲染总耗时（毫秒） |

---

### 2.2 流式进度渲染接口：`POST /render/stream`

使用 Server-Sent Events (SSE) 协议，渲染过程中实时向客户端推送进度百分比与阶段日志。

- **URL**: `https://matitie-hyperframes.hf.space/render/stream`
- **Method**: `POST`
- **Headers**:
  - `Authorization: Bearer <HF_TOKEN>`
  - `Content-Type: application/json`
  - `Accept: text/event-stream`
- **SSE 事件流格式**：
  ```text
  event: progress
  data: {"percent":20,"stage":"Processing audio tracks"}

  event: progress
  data: {"percent":55,"stage":"Capturing frame 60/90 (3 workers)"}

  event: complete
  data: {"success":true,"outputPath":"/data/...","fileSize":405627}
  ```

---

### 2.3 临时产物下载接口：`GET /outputs/:token`

如果不需要直接访问 Bucket，可通过渲染接口返回的 `outputUrl` 直接下载 MP4 文件。

- **URL**: `https://matitie-hyperframes.hf.space/outputs/<token>`
- **Method**: `GET`
- **Headers**: `Authorization: Bearer <HF_TOKEN>`
- **Response**: `video/mp4` 二进制视频流。

---

### 2.4 健康检查与状态接口

- **`GET /health`**：渲染引擎内部健康检测与运行耗时
  ```json
  {"status":"ok","uptime":120,"timestamp":"2026-09-04T12:07:25.959Z"}
  ```
- **`GET /healthz`**：基础探活接口（用于云原生容器探针）
  ```json
  {"status":"ok"}
  ```
- **`GET /render/queue`**：当前并发渲染队列排队状态
  ```json
  {"running":0,"queued":0,"maxConcurrent":2}
  ```

---

## 三、HTML 动效编写规范（Renderer 验收标准）

为了保证 HyperFrames 确定性逐帧捕获（BeginFrame）与音视频合成的准确性，提交给 `/render` 的 HTML 需满足以下约定：

1. **根容器标识**：
   页面必须包含一个包含 `data-*` 声明的容器，用于标明视频时长与画幅：
   ```html
   <div id="root" 
        data-composition-id="root" 
        data-width="1920" 
        data-height="1080" 
        data-duration="3" 
        data-fps="30">
     ...
   </div>
   ```
2. **GSAP 时间轴接管**：
   GSAP 时间轴必须处于暂停状态（`paused: true`），并将时间轴对象注册到 `window.__timelines`：
   ```javascript
   window.__timelines = window.__timelines || {};
   const tl = gsap.timeline({ paused: true });
   tl.to("#target", { opacity: 1, duration: 3 }, 0);
   window.__timelines["root"] = tl;
   ```
3. **确定性渲染原则**：
   - 严禁使用未固定种子的 `Math.random()`。
   - 严禁使用 `Date.now()` 驱动视觉动效。
   - 所有外部资源（字体、CDN 脚本）需允许无头浏览器高速拉取。

---

## 四、Storage Bucket 存储管理指南

由于 Space 容器配置了 Storage Bucket 挂载：
- **挂载点**：`/data`
- **远端 Bucket**：`matitie/hyperframes-storage`

### 4.1 写入与自动持久化
只要在 `/render` 请求中将 `outputPath` 指定为 `/data/xxxx/yyyy.mp4`，渲染完成后该视频文件即持久化保存在 Hugging Face Storage Bucket 中，Space 实例即便休眠或重启，视频数据不会丢失。

### 4.2 本地与 Bucket 交互命令

通过 `hf buckets` CLI 可直接在外部对存储卷进行管理：

```bash
# 1. 递归列出 Bucket 中的所有视频文件
hf buckets list matitie/hyperframes-storage -R

# 2. 从 Bucket 下载指定视频到本地
hf buckets cp hf://buckets/matitie/hyperframes-storage/20260904/video-001.mp4 ./video-001.mp4

# 3. 将本地资源同步到 Bucket
hf buckets cp ./local-asset.png hf://buckets/matitie/hyperframes-storage/assets/logo.png
```

---

## 五、后续封装业务 API 的推荐实现方案 (V0.2 / V1.0)

如果要在现有已跑通的能力之上，对外提供一套更易集成的业务 API（如供前端网页、工作流自动化或移动端调用），建议按以下方案进行封装：

### 方案 A：在当前 Space 内增加轻量路由控制器（推荐）

在 `packages/gcp-cloud-run/src/server.ts` 的 `createApp()` 中扩展业务层端点，例如：

```typescript
// 业务 API：POST /api/v1/generate-video
app.post("/api/v1/generate-video", async (c) => {
  const { title, subtitle, duration = 3, dateStr = getToday() } = await c.req.json();
  
  // 1. 根据模板动态拼装 HTML
  const html = renderTemplate({ title, subtitle, duration });
  
  // 2. 生成规范化的 Bucket 存放路径
  const videoId = crypto.randomUUID();
  const outputPath = `/data/${dateStr}/${videoId}.mp4`;
  
  // 3. 调用底层的渲染器
  const job = createRenderJob(buildRenderJobConfig({
    projectDir: tempDir,
    fps: { num: 30, den: 1 },
    quality: "high"
  }, outputPath, log));
  
  await executeRenderJob(job, tempDir, outputPath);
  
  // 4. 返回业务友好的响应
  return c.json({
    code: 0,
    videoId,
    bucketUrl: `hf://buckets/matitie/hyperframes-storage/${dateStr}/${videoId}.mp4`,
    downloadUrl: `/outputs/${token}`,
    duration
  });
});
```

### 方案 B：独立 API 网关 / 异步任务调度层

当视频渲染时长较长（如 30 秒至 3 分钟的宣传片）时，同步等待 HTTP 请求可能超时，建议构建异步任务架构：

```text
客户端 (Client)
   │ 1. POST /api/v1/jobs (提交 HTML 或脚本)
   ▼
API 网关 (Node / Python / Go)
   │ 2. 创建 Job 记录 (状态: PENDING)
   │ 3. 异步调用 Space: POST /render/stream
   ├───────────────────────────────┐
   │ 监听 SSE 进度推送更新 Job 进度 │
   ▼                               ▼
任务状态数据库                  HF Space (执行渲染)
(Progress: 0% -> 100%)             │ 渲染完成写入 /data
                                   ▼
                             HF Storage Bucket
```

- `POST /api/v1/jobs`：提交渲染任务，立即返回 `job_id`。
- `GET /api/v1/jobs/:id`：轮询任务进度（百分比、当前阶段）。
- 支持配置 `callback_url`：渲染完成后通过 Webhook 自动通知业务系统。

---

## 六、Space 代码同步与维护命令指引

后续如有代码更新，遵循以下标准流程同步至 GitHub 与 Hugging Face Space：

```bash
# 1. 提交本地修改并推送到 GitHub 分支
git add packages/gcp-cloud-run/src/server.ts HYPERFRAMES_API_GUIDE.md
git commit -m "docs: add HYPERFRAMES_API_GUIDE.md"
git push origin hf-space-v0.8.33

# 2. 推送文件到 Hugging Face Space (自动触发增量构建)
hf upload --repo-type space matitie/hyperframes \
  HYPERFRAMES_API_GUIDE.md HYPERFRAMES_API_GUIDE.md \
  --commit-message "docs: add HYPERFRAMES_API_GUIDE.md"

# 3. 监控 Space 状态直到 RUNNING
hf spaces wait matitie/hyperframes --timeout 5m
```
