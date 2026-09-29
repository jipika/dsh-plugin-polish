# dsh-plugin-polish

DeepSeek Harness (dsh) Web UI 的**动效与稳定性层**。纯 DOM/CSS client 插件，
不改任何 bundle、不引入依赖，删掉挂载即完全复原。

目标只有一句话：**让整个界面在切换与开合时稳定、同步、干脆**——
不需要的地方一个动画都没有，需要的地方一条曲线走到底。

> **拥有**：全局动效时长/曲线（`--ds-transition-duration*`、`--ds-ease-in-out`）、
> 全局滚动条（`*{scrollbar-width:none}` + `body{--dsh-scrollbar-width:0}`）、
> save-token / plugin console / antd 面板的表面适配、会话 header 节奏、
> QueueDock 行的视觉拖拽排序、macOS 顶部拖拽区。
> **冲突时**：会话滚动行为让给 DSH 和 `dsh-stream-think`；`--dsh-scrollbar-width` 若有
> 第三方（如 `dsh-ui-harmonizer`）同写，以本插件为准（它的方案带 8px 补偿）。
> **回滚**：`dsh.profile.bundles` 去掉 `dsh-plugin-polish` + 重启应用；只想关掉
> 单个功能见下方「功能开关」。

---

## 动效规范

### 时长只有三档

| 档位 | token | 用途 |
| --- | --- | --- |
| **100ms** | `--ds-transition-duration-fast` | 接触反馈：hover / press / 图标显隐 |
| **160ms** | `--ds-transition-duration` | 状态切换：选中、开关、标签、指示器 |
| **200ms** | `--ds-transition-duration-slow` | 结构变化：面板开合、列表展开、让位 |

### 曲线只有一条

`--ds-ease-in-out` = `cubic-bezier(.32,.72,0,1)`（强 ease-out：起步快、收尾稳）。
`linear` / `steps()` / 显式写死的 `cubic-bezier` 一律尊重原意，不改。

### 三条纪律

1. **只动 `transform` / `opacity`**（其次是颜色、阴影、边框）。`width` /
   `height` / `margin` / `left` 这类会触发重排的属性只在必要场景保留
   （面板让位、进度条），并且优先加 `contain` / `content-visibility` 缩小代价。
2. **常驻组件不许挂 `animation`**。React 每次重建都会让它从头播一遍，
   表现就是「切个会话，输入区上方抖一下」。进入动画只属于**真正新出现**的
   浮层（`polishPop`，160ms 淡入 + 2px 上浮）。
3. **切换时尊重阅读位置**。DSH 按会话恢复滚动位置，本插件不再在切换后的
   600 毫秒内强制滚到底部，也不改写全局 `scrollTo`。

### `motionScale`：把生态里的时长收进三档

官方与十几个第三方插件各自硬编码的 `.1s / .12s / .15s / .16s / .18s / .2s /
.3s` 在运行时被吸附到 **100 / 160 / 200ms**，`ease` 与 `ease-in-out` 折叠到
同一条曲线。改写走 CSSOM 替换原声明（不新增 `!important` 规则），层叠关系
完全不变；只动 transition，**不碰 animation**（spinner / shimmer / 流式的
节奏是状态语义）。已处理过的样式表用「规则条数」做指纹跳过。

实测（本机 0.1.7 界面，8515 条规则）：**37 种时长 → 3 档**，全量扫描 **7.9ms**。

```js
// 关掉（不改任何时长，其余功能照旧）
document.documentElement.dataset.polishMotion = "native";
```

---

## 功能开关

八个功能都能单独关掉，不必卸载插件——在**插件启动前**把对应属性设成 `"native"`
即可（host 启动时把 client bundle 读进内存，插件只在启动时读一次；DevTools 里
改完刷新页面重读）。取值不等于 `"native"` 的任何值都视为开启。

| 开关 | 关掉后 |
| --- | --- |
| `polishMotion` | 不做动效三档归一（CSS token 覆盖 + `motionScale` 扫描都不跑） |
| `polishScrollbar` | 恢复原生滚动条（`--dsh-scrollbar-width` 也不再置 0） |
| `polishSurfaces` | 不做 save-token / plugin console / antd / header 的表面适配 |
| `polishDrag` | QueueDock 行不可拖拽排序（不注册监听器） |
| `polishDragzone` | macOS 顶部条不再是窗口拖拽区 |
| `polishTimeLabel` | 会话行时间标签恢复自适应宽度（不再等宽数字） |
| `polishPerf` | 不做离屏渲染跳过与子树 `contain` 隔离 |
| `polishImageZoom` | 图片灯箱恢复官方原样（不能缩放 / 平移 / 旋转） |

另有 `polishHas`（`:has()` 替换引擎），由 `parentState` 自己读取。

```js
// 例：只想要动效统一，不想要滚动条被隐藏、也不要拖拽排序
document.documentElement.dataset.polishScrollbar = "native";
document.documentElement.dataset.polishDrag = "native";
```

回归测试：`node tests/switch-test.mjs` 检查开关和启动守卫。

---

## 功能

### 1. 动效与稳定性

- **会话切换**：滚动位置由 DSH 的会话记忆恢复，本插件不再强行贴底。
- **进入动画纪律**：常驻组件（save-token 条、armor 药丸、插件卡片…）不再
  重播进场动画；只有浮层保留 160ms 的 `polishPop`。
- **全 app 时长/曲线统一**（`motionScale`），含运行时新插入的第三方样式表。
- **会话行时间标签**：固定最小宽度 + 等宽数字，「1分钟 → 刚刚」不再挤动左邻。
- **`prefers-reduced-motion` / `prefers-reduced-transparency`** 完整回退。

### 2. 滚动与渲染

- **滚动条隐藏但保留原生滚动**（`scrollbar-width:none` +
  `::-webkit-scrollbar`），并把 shell 的 `--dsh-scrollbar-width` 补偿量置 0，
  避免隐藏后留下 8px 布局缺口。
- **屏外渲染跳过**：长代码块 `content-visibility:auto` +
  `contain-intrinsic-size:auto 480px`（刻意不碰 think 行，那是 dsh-think-ux
  的地盘）。
- **布局隔离**：composer 卡片 `contain:style`；滚动链用
  `overscroll-behavior:contain` 隔断。

### 3. 主题与材料对齐

- 第三方插件面统一到 `--dsw-alias-*` token（深浅主题自动跟随）：
  save-token 的 `.st-*`、infinite-gen-4 的 `.dsh-armor-*`、插件控制台 /
  automation 面板的 `.pc-*` 与 antd 默认蓝。
- **排队面板底色**不赌 token：JS 读页面实际背景色写进 `--polish-surface`，
  与页面同源（官方主题规则会把它压回默认值，赌 token 必输）。
- 圆角统一到 shell 的 12px 卡片语言，浮层材质加 blur + 深阴影。
- 选区色品牌化（`::selection`）。

### 4. 交互增强

- **排队拖拽排序**：「N 条排队消息」面板里的行支持按住左侧图标调整视觉顺序，
  React 重渲染后用 CSS 顺序恢复。**只改显示顺序**：host 的队列动作
  只有 `steer` / `remove` / `edit`，没有 reorder 通道，真实发送顺序仍由
  host 决定。
- **顶部条 = 窗口拖拽区（仅 macOS）**：DSH 用 `titleBarStyle:"hiddenInset"`
  建窗，网页一直画到窗口顶，所以双击顶部原本命中的是普通网页。给会话头部与
  侧边栏 brand 行标上 `-webkit-app-region:drag` 后，它就等同于系统标题栏
  （可拖动移窗，双击走 macOS 原生的「双击窗口标题栏」动作）。行内可交互元素
  一律退回 `no-drag`。
- **图片灯箱增强**（`imageZoom`，`polishImageZoom=native` 关）：官方点开聊天里的
  图片只有四张样式在管（`._backdrop_*` 全屏容器 / `._mask_*` 遮罩 / `._image_*`
  居中大图 / `._close_*` 右上关闭）——没有缩放、没有旋转、也拖不动。
  交互对齐 **QQ 看图**（滚轮只滚动、缩放只走按钮）：

  | 操作 | 行为 |
  | --- | --- |
  | **滚轮** | **滚动平移**（Shift+滚轮转横向）——只挪位置，不改缩放 |
  | **按住拖动** | 平移（位移 >3px 才算拖动，避免误触）；**双击** 1× ⇄ 2× |
  | **工具栏** | 缩小 / 放大 / 百分比 / 左转 90° / 右转 90° / 复位（40px 按钮 + 20px 内联 SVG） |
  | **键盘** | `+` `-` 缩放、方向键平移、`0` 复位、`R` 旋转（Esc 关闭仍走官方） |

  四个实现约束：① 变换走 CSS 变量 `--polish-lb-scale/-rot/-x/-y`，不写
  `img.style.transform`，免得和 React 争同一份内联样式；② 识别**不赌 hash 类名**
  （`_1hos8_` 会随版本变）——先看父容器类名里的 `backdrop` 词根，再用计算样式兜底
  （`position:fixed` 且铺满视口宽）；③ **必须设 `img.draggable = false`**：原生图片
  默认可拖拽，按住一拖就变成浏览器原生 drag、`pointermove` 随即断掉（这正是第一版
  「放大后拖不动」的根因）；④ 状态挂在元素自身的 `__polishLb` 上，灯箱被 React
  卸载时一起消失，不需要任何清理钩子。平移带边界（`clampPan`）：放大后只允许露出
  多余的余量，比视口小的方向一律居中，免得图被拖到看不见。

### 5. 运行时性能（不只是动画）

- **`:has()` 替换引擎**（`parentState`）。`:has()` 的代价不在匹配本身，而在
  **失效范围**：宿主后代里任何节点增删，浏览器都要为宿主重新求值一次，而宿主
  往往是整棵会话滚动容器（几千个后代）。实测（向会话容器插入一个节点，取中位）：
  完整 CSS **4.7ms** → 停用单条
  `body.dsx-stats-active [data-conversation-scroll]:has([data-conversation-composer-overlay])`
  后 **0.6ms** —— 一条规则占了 **87%** 的样式成本。polish 把「宿主后代里有没有 X」
  交给 JS 判定一次、写成宿主上的类名（`.polish-has-*`），CSS 侧把 `:has(X)` 换成
  类选择器（走类名哈希索引）。**实测插入成本 4.7ms → 0.6ms，p90 7.1ms → 2.3ms**；
  正反向都有回归（塞入 / 移除假节点 → 类名出现 / 消失）。
  关掉：`document.documentElement.dataset.polishHas = "native"`。
- **动效时长归一**（`motionScale`）：见上。
- **自查接口**：`__dshPolishStats()` 返回 CSS 规则数、`:has()` 与后缀选择器余量、
  已替换条数、DOM 节点数、三档 token 实际取值、两个开关状态与 JS 堆占用。

#### 本机加载画像（记录用，非插件自身开销）

| 项 | 实测 |
| --- | --- |
| client 插件 JS 总量 | **5.9MB**（未压缩；单个 `/plugins/??…` 请求 6.95MB / 1.5s） |
| 体积前三 | dsh-config-manager 1.2MB、archive-manager 946KB、better-sidebar 823KB |
| 页面样式规模 | 215 张样式表 / 8515 条规则 / 72 条后缀属性选择器 / 56 条 `:has()` |
| DOM | 约 4.1k 节点（长会话的滚动容器内约 3k） |
| 滚动 | p50 16.7ms、p90 17.5ms、0 帧 >20ms（60fps 稳定） |
| JS 堆 | 140MB 量级（随会话长度增长） |

结论：滚动与动效路径已达标；剩下的加载成本主要来自**装了多少插件**
（禁用不用的 bundle 直接省时间），而不是渲染路径。

---

## 安装

```bash
# 1) 放进 profile 的依赖（link 本地目录或从 npm 装）
#    ~/.dsh/profiles/<profile>/package.json
#    "dsh-plugin-polish": "link:../../plugins/dsh-plugin-polish"

# 2) 让 bundle patch 生效：把包名加进 dsh.profile.bundles
#    （包自带 cordis.patch.yml，无需手写 insert）
```

也可以只写 `cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-plugin-polish
      name: dsh-plugin-polish
```

改完 **⌘Q 退出再打开应用**（client 插件在页面加载时拉取；这一版 Electron 没有
View → Reload，⌘R 未绑定）。

## 回滚

删掉 `cordis.patch.yml` 里的 insert（或 `dsh.profile.bundles` 里的包名）并重启
即完全失效；再删 `package.json` 的依赖行即可卸载。

## 调参

- 三档时长与曲线：`lib/client.js` 顶部 `:root` 段（`--ds-transition-duration*`
  / `--ds-ease-in-out` / `--polish-dur-*` / `--polish-ease-*`）。
- 时长吸附档位与曲线：`motionScale` 段的 `BANDS` / `CURVE`。

## 已知边界

- 拖拽排序只改 QueueDock 的显示顺序（host 权威队列无 reorder 通道），
  不再给对话流里的 React 气泡插入把手或移动消息节点。
- antd 行内色（图表色板 `#1677FF` 等）不在 CSS 可达范围，未映射。
- `motionScale` 只改**过渡**；动画时长（spinner / shimmer / 打字机）属于状态
  语义，插件不介入——那是 `dsh-web-low-motion` 一类插件的职责。

## License

MIT
