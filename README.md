<div align="center">
  <img src="assets/icon.svg" width="72" alt="dsh-plugin-polish icon">
</div>

# dsh-plugin-polish

DeepSeek Harness (dsh) Web UI 的**动效与稳定性层**。纯 DOM/CSS client 插件，
不改任何 bundle、不引入依赖，删掉挂载即完全复原。

目标只有一句话：**让整个界面在切换与开合时稳定、同步、干脆**——
不需要的地方一个动画都没有，需要的地方一条曲线走到底。

> **拥有**：全局动效时长/曲线（`--ds-transition-duration*`、`--ds-ease-in-out`）、
> 全局滚动条（`*{scrollbar-width:none}` + `body{--dsh-scrollbar-width:0}`）、
> antd 面板的表面适配、会话 header 节奏、
> QueueDock 行的视觉拖拽排序、macOS 顶部拖拽区。
> **冲突时**：会话滚动行为让给 DSH 和 `dsh-stream-think`；`--dsh-scrollbar-width` 若有
> 第三方同写（其方案常带 8px 补偿），以本插件为准。
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
   浮层——唯一例外是 MenuPop（0.5 段）：菜单卡片由 React 按开合挂载/卸载，
   `@keyframes` 只在节点创建时播一次，重渲染不重播。
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

每个功能都能单独关掉，不必卸载插件——在**插件启动前**把对应属性设成 `"native"`
即可（host 启动时把 client bundle 读进内存，插件只在启动时读一次；DevTools 里
改完刷新页面重读）。取值不等于 `"native"` 的任何值都视为开启。

> 唯一例外是 `polishTabTip`：它是**反语义**开关，默认就是关（气泡被压制），
> 只有显式写成 `"show"` 才恢复官方气泡。理由见下表末行与 1.8 段注释。

| 开关 | 关掉后 |
| --- | --- |
| `polishMotion` | 不做动效三档归一（CSS token 覆盖 + `motionScale` 扫描都不跑） |
| `polishScrollbar` | 恢复原生滚动条（`--dsh-scrollbar-width` 也不再置 0） |
| `polishSurfaces` | 不做 antd / header 的表面适配 |
| `polishDrag` | QueueDock 行不可拖拽排序（不注册监听器） |
| `polishDragzone` | macOS 顶部条不再是窗口拖拽区 |
| `polishTimeLabel` | 会话行时间标签恢复自适应宽度（不再等宽数字） |
| `polishPerf` | 不做离屏渲染跳过与子树 `contain` 隔离 |
| `polishImageZoom` | 图片灯箱恢复官方原样（不能缩放 / 平移 / 旋转） |
| `polishMenuPop` | 菜单卡片恢复官方原样（无入场动画） |
| `polishPress` | 按钮恢复官方原样（hover 硬变色、无按压反馈） |
| `polishLightbox` | 图片灯箱恢复官方原样（打开硬切、无入场） |
| `polishTabMenu` | 右侧栏 tab 右键菜单恢复官方单个「关闭」（不注册关闭其他/左侧/右侧/全部） |
| `polishFailMark` | 侧栏会话行不画失败红点（宿主半也不再维护失败表） |
| `polishNotify` | 窗口失焦/不可见时不发完成/失败系统通知 |
| `polishTabTip` | **反语义，默认已关**：会话 tab 的 hover 气泡平时不显示；写 `polishTabTip="show"` 才恢复官方气泡 |

另有 `polishHas`（`:has()` 替换引擎），由 `parentState` 自己读取。

```js
// 例：只想要动效统一，不想要滚动条被隐藏、也不要拖拽排序
document.documentElement.dataset.polishScrollbar = "native";
document.documentElement.dataset.polishDrag = "native";
```

回归测试：

```bash
node tests/switch-test.mjs            # 功能开关与启动守卫（89 条）
node tests/queue-order-test.mjs       # host 半边队列重排路由（35 条）
node tests/queue-order-client-test.mjs # 浏览器侧拖拽上报与回退（12 条）
node tests/session-activity-test.mjs  # host 半会话健康：失败表/事件中继/门禁（28 条）
node tests/session-notify-client-test.mjs # 通知点击跳转会话（26 条）
```

---

## 功能

### 1. 动效与稳定性

- **会话切换**：滚动位置由 DSH 的会话记忆恢复，本插件不再强行贴底。
- **进入动画纪律**：常驻组件（armor 药丸、插件卡片…）不再
  重播进场动画（React 重建会让它从头播一遍）。
- **全 app 时长/曲线统一**（`motionScale`），含运行时新插入的第三方样式表。
- **MenuPop（0.5 段）**：官方菜单家族（模型选择器、右键菜单、子菜单、
  TabMenu、命令面板、jobs 菜单——全部经 `MenuSurface` 渲染）获得统一入场：
  卡片 scale .985 → 1（transform-only，不破坏毛玻璃的 backdrop 采样），
  macOS 衬底 opacity 淡入承担「材质凝固」。`prefers-reduced-motion` 关停。
  这个动的出处就是你觉得很舒服的那个模型选择器菜单——它是整个家族的
  材质基准，其他菜单此前缺的只是这一下开合。
- **Press（0.6 段）**：全 app 按钮（Button primitive 及同 token 形态的
  三个官方按钮）补上 hover 过渡（110ms）与按压反馈（`:active` 独立
  `scale:.97`，与既有 transform 定位合成不覆盖）。触摸设备不产生假
  hover，`prefers-reduced-motion` 关停。
- **Lightbox（0.7 段）**：图片灯箱打开时大图 scale .97→1 淡入、关闭钮
  淡入（160ms）。遮罩变暗保持官方瞬时值——mask 带 backdrop-filter，
  动 opacity 会破坏毛玻璃采样（MenuPop 同款纪律）。
- **会话行时间标签**：固定最小宽度 + 等宽数字，「1分钟 → 刚刚」不再挤动左邻。
- **`prefers-reduced-motion` / `prefers-reduced-transparency`** 完整回退。

### 1.5 会话健康（0.9 段：失败红点 + 完成通知）

DSH 侧边栏的状态模型只有「待审批 / 运行中 / 已完成 / 空闲」四态，**没有
失败态**：一轮 429/配额/网络失败后，正在看的会话回落成灰色「空闲」，
后台会话甚至被标成绿色「已完成」（`completionUnread` 不区分成败）。
DSH 也从不调系统通知。本段补上这两块，全程零补丁（宿主半事件 + 官方槽位）：

- **宿主半**（`lib/index.js`）：监听 `session/event` ——
  `turn/end` 且 `reason.kind === 'error'` 记入每会话失败表（LlmFailure 的
  `code`/`message` 原样保留），`turn/start` 清失败（新一轮开始即翻篇），
  `session/title` 维护标题表；completed/error 结果进增量事件流（aborted /
  blocked / max-tokens 不打扰）。经
  `GET /plugins/dsh-plugin-polish/session-activity`（loopback-only）暴露，
  失败表全量 + `?since=cursor` 增量事件，环形上限 200 条。
- **失败红点**（client 半）：注册官方槽位 `sidebar.session.row.leading`——
  该槽位只在行主状态**空闲**时渲染，恰好是「跑完但失败」的形态；会话跑
  起来红点自动让位官方 spinner，红点几何复刻官方 StateDot（10px 槽位 +
  6px 核心点），颜色走 `--dsw-alias-state-error-primary` 跟随深浅主题。
  悬停提示带错误码；排在 schedule 时钟 mark（order 10）之前。
- **系统通知**（client 半）：增量事件里 completed/failed **一律弹**系统
  `Notification`（前台也弹——2026-10-26 用户决策，初版只失焦弹；同会话
  tag 覆盖不堆积）；标题取宿主记录的
  `session/title`，DOM 行标题兜底；失败正文带错误码 + 消息；权限
  `granted` 直接发、`default` 只请求一次；`tag` 按会话去重。
- **点通知跳到那条会话**：三条路按可靠性递减，命中即停 ——
  ① `uiWorkspace.openSession(sessionId)`（官方唯一的「选中会话 + 切主视图」
  动作，侧栏行点击走的也是它；服务用 `ctx.get` 软取，取不到就往下走，
  不抛），归档中的会话先 `unarchiveSession` 落定再打开；
  ② 点侧栏行 `[data-row-key="session:<id>"]` 本身（行的 `onClick` 即
  `onOpen(node.id)`，等价于用户手点），仅在该行已渲染时可用；
  ③ `window.focus()` 兜底。整段 fail soft —— 点击回调里抛异常会让通知变
  哑弹，比只聚焦更差，所以 `focus` 一定执行。
- **已知边界**：失败表是进程内存态，DSH 重启后红点不回放（通知不受影响，
  重启后新失败照常）；红点只在行「空闲」时出现——后台会话失败若被官方
  标成绿色「已完成」，红点槽位不存在，这是官方状态机占地所致，本插件
  不越位接管。已归档会话取回要等 Host 应答，跳转在取回落定后才发生。

### 2. 滚动与渲染

- **滚动条隐藏但保留原生滚动**（`scrollbar-width:none` +
  `::-webkit-scrollbar`），并把 shell 的 `--dsh-scrollbar-width` 补偿量置 0，
  避免隐藏后留下 8px 布局缺口。
- **布局隔离**：composer 卡片 `contain:style`（**只用 `style`** —— `layout` /
  `paint` 会把卡片变成其内部 fixed 浮层的 containing block，「推理等级」面板
  曾因此飞到左上角）。
- **刻意不做**：长代码块的 `content-visibility` 懒渲染、会话滚动器的
  `overscroll-behavior` 隔断 —— 二者都会让对话区偏离官方观感（`b0eb98f` 撤回）。
  思考行也不碰：它的渲染与测量归官方 `@deepseek-ai/dsh-client-ui-chat`
  （slot `conversation.chat.reasoning.content`）。

### 3. 主题与材料对齐

- 第三方插件面统一到 `--dsw-alias-*` token（深浅主题自动跟随）：
  宿主里 antd 组件的默认蓝（本机宿主 = `@michengai/dsh-archive-manager`）。
- ~~config-manager 的用户消息气泡字号/行高拉回宿主档~~（2026-10-18 退役：
  该插件已从双 profile 卸载，且官方 `ui-chat` 的 `.bubble` 已原生实现
  `var(--dsh-content-font-size,14px)` / `calc(22px + var(--dsh-content-font-delta,0px))`，
  两条规则随之删除，见 `lib/client.js`「1.7 已退役」注）。
- **排队面板底色**不赌 token：JS 读页面实际背景色写进 `--polish-surface`，
  与页面同源（官方主题规则会把它压回默认值，赌 token 必输）。
- **回退插件（`dsh-rewind-plugin`）的两块自绘浮层**（`7d`，`polishSurfaces` 管）：
  它把面板底写成 `var(--dsw-specific-menu)` 却不写 `backdrop-filter`，而 macOS 上
  `--dsw-specific-menu` 是**无衬底浮层**的保守档（`rgba(248,249,250,.94)` ≈ 实心），
  于是「回退」点开的那块确认面板是一块实心板。这里分两步补上官方三件套
  （`polishSurfaces` 管）：
  **两处浮层都补** `backdrop-filter:var(--dsw-menu-backdrop-filter)`
  （= `blur(40px) saturate(150%)`，官方写法里缺的那条）；
  **只给面板**再换 `background:var(--dsw-menu-surface-fill,…)` ——
  即官方 MenuSurface `.material` 那一档，与自家 dsh-card-summon / dsh-todo-float
  同源；`.dsh-rewind-guard-hint`（输入区上方 3.2s 自动消失的纯文字提示）**不动底色**，
  保持无衬底保守档 + blur，正好等于官方 QueueDock / TodoPanel / HoverCard.media
  那一族的逐字配方，透到 .58 反而让字压在正文上读不清。
  面板内部各行都是 `transparent` / hover 才起底，不会有一层实心子节点把 blur 挡掉。
  **只改这几个类名怎么取 token，不定义、不覆盖任何 `--dsw-menu-*`**
  （菜单 token 保持官方原样，见 `dsh-official-ui-spec` 的纪律）。
  已知代价：面板没有官方那层 `.backing` 不透明衬底，所以 macOS 下比官方菜单略透
  （官方正是因此把 `--dsw-specific-menu` 保守地提到 .94）；嫌太透就删掉那条
  「只给面板换底色」的规则，退回 `.94 + blur`。**影响面只在 macOS**：非 darwin 上
  `--dsw-specific-menu` 逐字 `= var(--dsw-menu-surface-fill)`，属等价改写。
- 圆角统一到 shell 的 12px 卡片语言，浮层材质加 blur + 深阴影。
- 选区色品牌化（`::selection`）。

### 4. 交互增强

- **排队拖拽排序（真实重排）**：「N 条排队消息」面板里的行支持按住左侧图标
  调整顺序，落手后插件把新的 id 序列 `POST` 给 host 半边
  （`/plugins/dsh-plugin-polish/queue-order`），host 侧
  `inbox.splice('next-turn', 0, n, ordered)` 整体替换 agent 的待发队列——
  **显示顺序与真实发送顺序从此是同一个数组**。队列顺序走
  `agent/inbox/spliced` 落进会话日志，所以重排和追加一样能跨重启存活。

  host 侧只在能 1:1 对上号时才动手：队列里有 in-flight 回显行、行数与 inbox
  条数不符、或队首已被 agent 消费（陈旧视图）时一律拒绝并回传真实顺序，
  浏览器侧随即把视觉顺序回退到 React 自己那份。非普通用户消息（goal 轮次、
  问答回复）也拒绝——替换它们会触发这些 owner 读作「取消」的 `discarded`。
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

- **右侧栏 tab 右键菜单**（tabMenu，polishTabMenu=native 关）：官方只有一个「关闭」，这里在 sidebar.right.tab.menu.item 槽追加四个：关闭其他 / 关闭左侧 / 关闭右侧 / 关闭全部。批量关闭走 sidebarRight.closeIn/tabsIn，左右顺序走 [data-dockkit-strip-tabs] > [data-dockkit-tab] 的 DOM 顺序；拿不到顺序时左右两项自动隐藏，只留其他/全部。点菜单项先 dismiss() 再批量关。

- **会话 tab 的 hover 气泡**（`tabTip`，**默认已抑制**，`polishTabTip="show"` 恢复）：
  官方 tag 行的每个 tab 都包了一层 `ui-primitives` 的 Tooltip
  （`ConversationSession.tsx:208`），悬停弹出的气泡内容就是 tab 自己的名字，
  纯重复，还盖住相邻 tab。气泡被 `createPortal` 送到 `document.body`
  （`Tooltip.tsx:270`），与 tab 没有祖先关系，且节点只带
  `role="tooltip"` / `data-portal` 这些通用属性——所以既不能从 tab 反选，
  也不能全局压制（会连 StatsPills 的 reading 长气泡一起干掉）。
  做法是指针标记：`pointerover`/`pointerout`（capture）判断落点是否在
  `[data-conversation-tabs]` 里的 `[role="tab"]` 上，是则给 `<html>` 打
  `data-polish-tip-off`，1.8 段的单条规则据此压掉 portal 气泡；离开 tab
  立刻撤销，其它 tooltip 完全不受影响。

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

#### 本机加载画像（2026-09 快照，记录用，非插件自身开销）

| 项 | 实测 |
| --- | --- |
| client 插件 JS 总量 | **5.9MB**（未压缩；单个 `/plugins/??…` 请求 6.95MB / 1.5s） |
| 体积前三 | dsh-config-manager 1.2MB、archive-manager 946KB（当时第三名 823KB 的插件现已不在本机） |
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

- 拖拽排序改的是 `next-turn` 队列本体，但**不加**对话流里 React 气泡的把手，
  也不搬动已发出的消息节点。
- 重排事件在会话日志里带 `outcome:"canceled"` 标签——inbox 只有这一种「移除」
  语义，没有 `moved` 变体。行为上无害（置换永远重新插入，`consumed-work`
  只在 `inserted` 为空时才算「工作被丢弃」，客户端回执按位置重算后不变），
  只是回看日志时会看到一次写着 `canceled` 的替换。
- host 半边的路由需要**重启应用**才挂上；未重启时浏览器侧会检测到该路由不存在
  （SPA 回落返回 HTML），自动退回纯视觉排序，不会报错。
- antd 行内色（图表色板 `#1677FF` 等）不在 CSS 可达范围，未映射。
- `motionScale` 只改**过渡**；动画时长（spinner / shimmer / 打字机）属于状态
  语义，插件不介入——那是 `dsh-web-low-motion` 一类插件的职责。

## License

MIT

---

## ☕ 赞赏支持

如果 dsh-plugin-polish 对你的研究与测试有所帮助，欢迎请作者喝杯咖啡 ☕

<p align="center">
  <img src="assets/sponsor.jpg" width="260" alt="微信赞赏码" />
  <img src="assets/afdian_reward.jpg" width="200" alt="爱发电赞助码" />
</p>

<p align="center">
  <b>给项目点个 Star ⭐</b> 同样是对开发者最大的鼓励！
</p>
