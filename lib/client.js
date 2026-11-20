/**
 * dsh-plugin-polish — theme & motion polish layer for the dsh Web UI.
 *
 * Pure DOM/CSS client plugin (no services, no bundle changes). Loaded via
 * `window.__ModuleLoader__.load({ id, factory })`, same as every client half.
 *
 * What it does
 * ------------
 *  1. Scrollbars hidden everywhere, scrolling stays native
 *     (`scrollbar-width:none` + `::-webkit-scrollbar`, and
 *     `--dsh-scrollbar-width:0` so the shell's own 8px layout
 *     compensations collapse too).
 *  2. Third-party plugin surfaces normalized onto the `--dsw-alias-*`
 *     design tokens: antd surfaces. Hardcoded rgba colors the plugins
 *     ship are mapped to tokens so dark mode stops leaking.
 *     （输入框工具栏上的 armor 药丸挂在 `conversation.input.left`，
 *     样式与位置都由它自己管，polish 不参与。）
 *  3. Header corner widgets pushed flush right.
 *  4. QueueDock drag-sort: press the leading icon of a queued message
 *     and drag to reorder it visually through CSS order. React keeps
 *     ownership of the DOM and the host still owns sending order.
 *  5. Motion system — one scale for the whole app:
 *     - the shell's own tokens (`--ds-transition-duration{,-fast,-slow}`,
 *       `--ds-ease-in-out`) are re-pointed to 100 / 160 / 200 ms and a
 *       single ease-out curve, so every rule that goes through a token
 *       moves in step;
 *     - `motionScale` snaps the *hardcoded* durations the rest of the
 *       ecosystem ships (.1s / .12s / .16s / .18s / .2s / .3s …) into the
 *       same three bands through CSSOM, and folds `ease` / `ease-in-out`
 *       onto that curve. Transitions only — animations keep their own
 *       cadence (spinners, shimmers, streaming);
 *     - entrance animations belong to surfaces that genuinely appear;
 *       persistent chrome never carries an `animation`, because a
 *       React remount would replay it on every navigation — that is the
 *       "why did the composer flinch" bug.
 *  6. Transform/opacity first, with full prefers-reduced-motion /
 *     prefers-reduced-transparency fallbacks and an escape hatch
 *     (`html[data-polish-motion="native"]`) that turns the motion scale
 *     off without unloading the plugin.
 *
 * Everything is idempotent and fails soft: missing hooks mean a feature
 * simply stays inert.
 */
window.__ModuleLoader__.load({
	id: "dsh-plugin-polish",
	factory: (require) => {
		const module = { exports: {} };

		/* ================================================================
		 * Feature switches — 每个功能都能单独关掉，不必卸载插件
		 * ----------------------------------------------------------------
		 * 用法：`document.documentElement.dataset.polish<Name> = "native"`
		 * 在插件启动前设置（host 启动时把 client bundle 读进内存，属性由宿主
		 * 页面持有、插件读一次）；DevTools 里改完刷新页面即可重读。
		 *
		 *   polishMotion        动效三档归一（CSS token 覆盖 + motionScale 扫描）
		 *   polishScrollbar     全局隐藏滚动条（滚动本身保持原生）
		 *   polishSurfaces      antd / header 等表面适配
		 *   polishDrag          QueueDock 行的视觉拖拽排序
		 *   polishDragzone      macOS 顶部条 = 窗口拖拽区
		 *   polishTimeLabel     会话行时间标签固定宽度 + 等宽数字
		 *   polishPerf          离屏渲染跳过与子树隔离
		 *   polishImageZoom     图片灯箱增强（滚轮缩放 / 拖拽平移 / 旋转 / 复位）
		 *   polishSidebarPanels 侧边栏顶部全局面板菜单两列排布（0.8 段）
		 *   polishMenuPop       官方菜单家族入场动画（卡片 transform 缩放 +
		 *                       macOS backing opacity 淡入，见 0.5 段）
		 *   polishPress         全 app 按钮按压反馈（hover 过渡 + :active
		 *                       独立 scale，见 0.6 段）
		 *   polishLightbox      图片灯箱入场动画（图 scale/淡入 + 关闭钮
		 *                       淡入，见 0.7 段）
		 *   polishFailMark      侧栏会话行失败红点（宿主半 turn/end 失败表）
		 *   polishNotify        窗口失焦时的完成/失败系统原生通知
		 *
		 * 另有 polishHas（:has() 替换引擎，由 parentState.enabled() 自己读）。
		 * 默认全开：取值不等于 "native" 的任何值都视为开启。
		 *
		 * 唯一的反语义开关是 polishTabTip：会话 tab 的 hover 气泡默认**不显示**，
		 * 要恢复官方气泡才写 `polishTabTip="show"`。理由：气泡内容就是 tab 自己
		 * 的名字，纯重复，还会盖住相邻 tab。
		 * ================================================================ */
		const SW = (function () {
			const root = (typeof document !== "undefined") ? document.documentElement : null;
			const ds = (root && root.dataset) ? root.dataset : {};
			const on = (name) => ds["polish" + name] !== "native";
			return {
				/* 反语义：默认 false（气泡压制生效），只有显式 "show" 才恢复官方气泡。 */
				tabTip: ds.polishTabTip === "show",
				motion: on("Motion"),
				scrollbar: on("Scrollbar"),
				surfaces: on("Surfaces"),
				drag: on("Drag"),
				dragzone: on("Dragzone"),
				timeLabel: on("TimeLabel"),
				perf: on("Perf"),
				imageZoom: on("ImageZoom"),
				sidebarPanels: on("SidebarPanels"),
				tabMenu: on("TabMenu"),
				menuPop: on("MenuPop"),
				press: on("Press"),
				lightbox: on("Lightbox"),
				failMark: on("FailMark"),
				notify: on("Notify")
			};
		})();

		/* ================================================================
		 * Stylesheet
		 * ================================================================ */
		const CSS = [
			...(SW.motion ? [
			/* ---- 0. Motion tokens ------------------------------------- */
			":root{"
			+ "--polish-ease-out:cubic-bezier(.25,1,.3,1);"
			+ "--polish-ease-spring:cubic-bezier(.34,1.3,.64,1);"
			/* 官方动效 token 收编：整个 shell 的过渡时长都从这里取，覆盖一次
			 * 就让官方 + 第三方插件同频（0.3s 的慢速布局过渡就是「点一下、
			 * 界面慢半拍」的来源）。 */
			+ "--ds-transition-duration-fast:100ms!important;"
			+ "--ds-transition-duration:160ms!important;"
			+ "--ds-transition-duration-slow:200ms!important;"
			+ "--ds-ease-in-out:cubic-bezier(.32,.72,0,1)!important;"
			+ "--polish-dur-fast:110ms;"
			+ "--polish-dur-in:160ms;"
			+ "}",
			] : []),

			...(SW.menuPop ? [
			/* ---- 0.5 MenuPop: 官方菜单家族的统一入场 -----------------------
			 * 官方所有浮层菜单（模型选择器 / 右键菜单 / 子菜单 / TabMenu /
			 * 命令面板 / jobs 菜单）都经 ui-primitives 的 MenuSurface 渲染：
			 * 卡片带 [data-menu-material="translucent"]，macOS 毛玻璃之下的
			 * 不透明衬底带 [data-menu-backing]，均 portal 到 body。官方源码里
			 * 这张卡片没有入场动画；这里按官方 Modal/Toast/Tooltip 的 "X-in"
			 * keyframes 范式补上：
			 *
			 *  · 卡片只动 transform（scale .985 → 1），绝不动 opacity ——
			 *    卡片的 .material 子层带 backdrop-filter，祖先 opacity < 1 会
			 *    形成 backdrop root，毛玻璃在动画期间采样失效、结束时"啪"
			 *    地弹回；transform 不破坏 backdrop 采样，毛玻璃全程 live。
			 *  · 衬底是纯色不透明层（无 blur），opacity 淡入安全；它负责
			 *    "材质凝固"的观感，也避免 darwin 上衬底先于卡片硬闪。
			 *  · 定位安全已核：菜单卡片全部用 inset / 内联 left/top 定位，
			 *    无 transform 定位，动画不会覆盖坐标；placement 在首帧绘制
			 *    前完成（Menu.tsx "first painted frame is already at the
			 *    final position"），动画不会播在隐形测量阶段。
			 *  · 不做退场：React 卸载即消失，与官方现状一致（exit-faster）。
			 */
			"@keyframes polishMenuIn{from{transform:scale(.985)}}",
			"@keyframes polishMenuBackingIn{from{opacity:0}}",
			'[data-menu-material="translucent"]{animation:polishMenuIn var(--polish-dur-in,160ms) cubic-bezier(.32,.72,0,1)}',
			'[data-menu-backing]{animation:polishMenuBackingIn var(--polish-dur-in,160ms) cubic-bezier(.32,.72,0,1)}',
			'@media (prefers-reduced-motion:reduce){[data-menu-material="translucent"],[data-menu-backing]{animation:none}}',
			] : []),

			...(SW.press ? [
			/* ---- 0.6 Press: 全 app 按钮的按压反馈 -------------------------
			 * 官方 Button primitive（Button.module.css）全文件没有一条
			 * transition：hover 是硬变色，:active 只有 ghost 换个背景——
			 * 全 app 点得最多的控件「啪、啪」两态切换。这里按 Emil 的
			 * 反馈规范补齐（audit #1，HIGH）：
			 *
			 *  · 选择器锚 `[class*="_button_"]` —— asar 编译产物已探明
			 *    （qI="_button_1rv3m_2"）：Button primitive 的类 token 形态
			 *    是 `_button_<hash>`，而按钮元素的 class 属性以 variant
			 *    token 结尾（`_ghost_1rv3m_45 …`），所以必须包含匹配而非
			 *    后缀匹配（后缀形态命中数为 0，第一版已据此修正）。复合
			 *    token（copyButton/imageButton/zoomButton…）压缩后是大写
			 *    B 的 `_copyButton_` 等，不含小写 `_button_`，不误伤。
			 *  · hover 背景过渡 110ms（fast 档，接触反馈），只在
			 *    hover-capable 指针下生效，触摸不产生假 hover。
			 *  · 按压用**独立 scale 属性**（Chromium 104+；本机内核早已
			 *    用上 corner-shape，版本无虞），且只在 :active 声明——
			 *    基态不写 scale:1（advisor 提醒：非 none 的 scale 会让
			 *    fixed/absolute 后代改定位基准、创建层叠上下文）。过渡
			 *    声明在基态，none → .97 的插值同样成立；官方按钮内无
			 *    fixed 后代，:active 期间的临时层叠上下文无害。
			 *  · 官方发送键（composer `_primary_`）自带 hover 过渡与
			 *    translateY(-2px) 定位，类名不含 `_button_`，保持原样。
			 */
			'@media (hover:hover) and (pointer:fine){[class*="_button_"]{transition:background var(--polish-dur-fast,110ms) var(--polish-ease-out,cubic-bezier(.25,1,.3,1)),border-color var(--polish-dur-fast,110ms) var(--polish-ease-out,cubic-bezier(.25,1,.3,1)),box-shadow var(--polish-dur-fast,110ms) var(--polish-ease-out,cubic-bezier(.25,1,.3,1)),color var(--polish-dur-fast,110ms) var(--polish-ease-out,cubic-bezier(.25,1,.3,1))}}',
			'[class*="_button_"]{transition:scale var(--polish-dur-fast,110ms) var(--polish-ease-out,cubic-bezier(.25,1,.3,1))}',
			'[class*="_button_"]:active:not(:disabled){scale:.97}',
			'@media (prefers-reduced-motion:reduce){[class*="_button_"]{transition:none}}',
			] : []),

			...(SW.lightbox ? [
			/* ---- 0.7 Lightbox: 图片灯箱入场 -------------------------------
			 * 官方 ImageLightbox.module.css 0 动画：点开聊天图片，遮罩、
			 * 大图、关闭钮同帧砸出来（audit #2，HIGH）。灯箱属 modal 类，
			 * 中心 origin 正确。@keyframes 只在 React 挂载时播一次，
			 * 无重播面。
			 *
			 *  · 只动 .image（scale .97→1 + 淡入）和 .close（淡入）；
			 *    **不碰 .mask**——它带 backdrop-filter，祖先 opacity<1 会
			 *    形成 backdrop root 破坏采样（menuPop 段已立的纪律），
			 *    遮罩变暗保持官方瞬时值，观感上是「图凝出来」，暗化
			 *    不需要动画也不产生突兀（menuPop 同款手法）。
			 *  · 作用域包在唯一的 `.backdrop`（token `_backdrop_`，全库
			 *    仅此一处，已扫）下，不影响任何其他浮层。
			 */
			"@keyframes polishLightboxIn{from{opacity:0;transform:scale(.97)}}",
			"@keyframes polishLightboxFadeIn{from{opacity:0}}",
			'[class*="_backdrop_"] [class*="_image_"]{animation:polishLightboxIn var(--polish-dur-in,160ms) cubic-bezier(.32,.72,0,1)}',
			'[class*="_backdrop_"] [class*="_close_"]{animation:polishLightboxFadeIn var(--polish-dur-in,160ms) cubic-bezier(.32,.72,0,1)}',
			'@media (prefers-reduced-motion:reduce){[class*="_backdrop_"] [class*="_image_"],[class*="_backdrop_"] [class*="_close_"]{animation:none}}',
			] : []),

			...(SW.sidebarPanels ? [
			/* ---- 0.8 SidebarPanels: 侧边栏顶部全局面板菜单两列 --------------
			 * 用户要求顶部菜单（插件/临时会话/自动化任务/更多）与底部 footer
			 * 入口的排布一致 —— 底部是 dsh-pocket-footer-entry 对 _footerActions
			 * 的 row+wrap（两入口并排各占一半），顶部照做：菜单项两两并排。
			 *
			 *  · 依据（2026-10-24，/tmp/dsh-src 源码 + app.asar 产物核对）：
			 *    ui-sidebar/SidebarRoot 的类 token = `kB3qhq_panelList` /
			 *    `kB3qhq_panelRow`（hash 前缀 + `_local` 后缀）；元素是
			 *    `<nav className={css.panelList}>`，每项 `<button>`；
			 *    官方 .panelList 为 flex-direction:column 单列、gap 4px。
			 *  · **类匹配一律 `*=` 包含匹配，不用 `$=` 后缀、不用 `>` 子代**：
			 *    PanelRow 的 class 是 `clsx(panelRow, active && panelActive)`
			 *    拼接，激活态下属性值以 `_panelActive` 结尾，`$="_panelRow"`
			 *    必然失配 —— 第一版 `> button[class$=…]` 就因此整条失效，
			 *    四项退化成内容宽流式、宽度参差（真机截图已复现，panelList
			 *    是单类 nav 才幸存）。panelList/panelRow 同出 clsx 来源，
			 *    将来官方加修饰类同样会破 `$=`，两条统一 `*=`；去 `>` 防将来
			 *    插 wrapper（Tooltip 是 cloneElement 无 wrapper，属官方内部
			 *    实现，不作依赖）。`_panelList`/`_panelRow` 子串经产物 grep
			 *    确认全库唯一，无误伤。
			 *  · **等宽用 grid 不用 flex（两次真机返工的教训，2026-10-24）**：
			 *    panelList 的第 4 项「更多」是 AXPopUpButton（Cua AX 树
			 *    实证），不是 PanelRow 渲染的普通 button —— 任何
			 *    button[class*=…] 规则都管不到它，flex-basis 等宽对它无
			 *    控制权，结果就是「插件|临时会话等宽、自动化任务|更多
			 *    参差」。grid 对任意子项鲁棒：每个子项进一个格子，
			 *    repeat(2,minmax(0,1fr)) 强制两列等宽，不再依赖猜测子项的
			 *    组件类型与类名。panelRow 清 flex 防残留；官方
			 *    `margin:0 2px` 保留（每项左右各 2px，对称 inset，hover 块
			 *    离边观感与「新会话」一致）。
			 *  · 折叠态整体恢复官方 display:flex column（锚
			 *    [data-sidebar-collapsed]，AppFrame.tsx:268
			 *    `sidebarCollapsed || undefined`，展开时属性不存在；
			 *    pocket-footer-entry 的图标化规则用同一锚点）。恢复规则
			 *    0,2,1+!important 压官方 .collapsed .panelList(0,2,0)；官方
			 *    折叠 .panelRow 的 width:36px/margin:0/justify-content 不碰。
			 *    .railIn 只挂入场 animation，不冲突。
			 *  · 「新会话」大按钮（_newSession）不在改动范围；奇数个 panel
			 *    时末项独占半宽，可接受。
			 *  · 关闭：polishSidebarPanels=native。
			 */
			'nav[class*="_panelList"]{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:4px;align-items:stretch}', // 2026-11-06：0.2.2 的 SidebarRoot 自己写死了三列网格，这里列数必须带 !important 才压得住。
			'nav[class*="_panelList"] button[class*="_panelRow"]{flex:none}',
			'[data-sidebar-collapsed] nav[class*="_panelList"]{display:flex!important;flex-direction:column;flex-wrap:nowrap;gap:12px}',
			'[data-sidebar-collapsed] nav[class*="_panelList"] button[class*="_panelRow"]{flex:0 1 auto}',
			] : []),

			...(SW.scrollbar ? [
			/* ---- 1. Scrollbars: hidden but scrollable ------------------ */
			"body{--dsh-scrollbar-width:0px!important}",
			"*{scrollbar-width:none!important}",
			"*::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}",
			] : []),

			...(SW.surfaces ? [
			/* ---- 1.5 会话正文里的图片：块级独占一行 + 放开到列宽 -------------
			 * 两个叠在一起的原因，都不是官方 bug、但观感确实是「图不占位、正文从
			 * 旁边穿过去」：
			 *  ① 官方 primitives 的 MarkdownText 把正文图包在 `.imageButton` 里，
			 *     而它是 `display:inline-block` → 图片按行内元素排版，可与文字同行；
			 *  ② `.imageButton .image{max-width:min(100%,640px);max-height:360px}`
			 *     把图限成小图。
			 * 这里在 markdown 作用域内把按钮改成 block（独占一行）、图放开到列宽。
			 * 灯箱 portal 到 body（不在 markdown 容器内）不受影响；缩略图/图标/头像
			 * 各有自己的尺寸规则，也不受影响。
			 * （这套规则原在 dsh-ui-fixes「修复 5」，2026-10-05 随该插件卸载搬到这里。） */
			"img[class*=image i]{max-width:100%}",
			'[class*="_markdown"] [class*="_imageButton"]{display:block!important;max-width:100%!important}',
			'[class*="_markdown"] img[class*="_image"]{display:block!important;position:static!important;float:none!important;max-width:100%!important;height:auto!important}',

			/* ---- 1.6 设置 → 插件 的 tab 行：不折行 + 横向滚动 ------------------
			 * 官方 `PluginsSettingsSection` 的 tab 行（结构 = `_section` 的
			 * `_heading` + `_intro` + `_tabs`）只写了 `display:flex;gap:22px`：
			 * 既没有 `white-space:nowrap` 也没有 `overflow-x`，于是 tab 一多
			 * （本机 8 个插件 tab）或窗口一窄，flex 就压缩子项 —— 中文标题被逐字
			 * 折成两行、整行溢出且无处可滚。这里补成标准横滚条：tab 不压缩、
			 * 不折行，放不下就横着滚（滚动条已由 scrollbar 那组统一隐藏）。
			 * 作用域 = 「section 的直接子 tabs」∪「intro 的相邻 tabs」，会话头那份
			 * `_tabs` 两者都不沾；`padding-bottom:1px` 是给选中下划线
			 * （官方 `::after{bottom:-1px}`）留出不被 overflow 裁掉的空间。 */
			'[class$="_section"]>[class$="_tabs"],[class$="_intro"]+[class$="_tabs"]{'
			+ "flex-wrap:nowrap!important;"
			+ "overflow-x:auto!important;"
			+ "overflow-y:hidden!important;"
			+ "overscroll-behavior-x:contain;"
			+ "padding-bottom:1px;"
			+ "}",
			'[class$="_section"]>[class$="_tabs"]>[class$="_tab"],[class$="_intro"]+[class$="_tabs"]>[class$="_tab"]{'
			+ "flex:0 0 auto!important;"
			+ "white-space:nowrap!important;"
			+ "}",

			/* ---- 1.7 已退役（2026-10-18）：原 dsh-config-manager 接管 user key 时
			 * 的字号/行高校正（.chatEntryScope/.chatBubble）。该插件已从双 profile
			 * 卸载，且官方 ui-chat 的 .bubble 已原生实现同等变量，规则不再需要。 */
			] : []),

			...(!SW.tabTip ? [
			/* ---- 1.8 会话 tab 的 hover 气泡：抑制（polishTabTip="show" 恢复）----
			 * 官方 tag 行每个 tab 都包了一层 ui-primitives Tooltip
			 *（ConversationSession.tsx:208），气泡文本 = tab 自己的名字，
			 * 悬停时弹在相邻 tab 上方，纯重复 + 遮挡。
			 *
			 * 为什么不能只用 CSS 选中「tab 的气泡」：Tooltip 拿走 porting 后
			 * 渲染到 document.body（Tooltip.tsx:270 `createPortal(content,
			 * document.body)`），气泡与 tab 之间没有祖先关系，CSS 无法从 tab
			 * 逆向选到它；而气泡节点只带 role="tooltip" / data-portal /
			 * data-side / data-align（Tooltip.tsx:219-228），没有调用方身份。
			 * 若直接压 `[role="tooltip"][data-portal]`，会连 StatsPills 的
			 * reading 长气泡（StatsPills.tsx:179 portal:true）等一并干掉。
			 *
			 * 所以用「指针标记」把作用域交出到 root：tabTipSuppress 在
			 * pointerover/pointerout（capture）里判断目标是否落在
			 * `[data-conversation-tabs]` 的 tab 按钮上，是则给 <html> 打
			 * `data-polish-tip-off`；气泡只在悬停 tab 期间出现，因此这条
			 * 窗口足够覆盖它，且离开 tab 立刻撤销，其它 tooltip 不受影响。
			 * :has() 不需要 —— 标记在 root 上，选择器是单一属性。 */
			"html[data-polish-tip-off] [role='tooltip'][data-portal]{display:none!important}",
			] : []),

			...(SW.surfaces ? [
			/* 输入框工具栏上的 armor 状态药丸（`conversation.input.left` slot）：
			 * 样式与位置都由它自己的插件管 —— polish 侧不对它做任何定位/材质干预。 */

			/* ---- 7b. 输入行模型选择器：左右边距收窄 ----------------------
			 * 原生 .row / .trailing / .standardControls 三层 gap 都是 12px，
			 * 模型左右各吃一道，看着两边都空。注意 slot 容器本身是
			 * display:contents（无盒，margin 打上去无效），所以直接打
			 * 触发器按钮（ModelSelect 根 div 下的 button，带
			 * aria-haspopup="menu"；菜单 portal 挂在卡片层不在 slot 子树内，
			 * 不会误伤）。触发器自己的 padding 只有 `0 4px 0 8px` 不动，
			 * 这里左右各收 6px（视觉 gap 12→6）。
			 * 关闭：polishSurfaces=native。回滚：删掉本条 + 重启应用。 */
			"[data-composer-card] [data-slot=\"conversation.input.model\"] button[aria-haspopup=\"menu\"]{margin-inline:-6px}",

			/* ---- 7c. 空 dock 常驻占位（对冲上游 9df1b6033a）----------------
			 * 上游 9 月改动后空 dock 直接塌掉（hero 下 display:none，其他情况
			 * 只剩 4px padding-top）。这两条让它永远留一行的高度：原生 pill
			 * 总高约 22px（padding 1px 上下 + 继承行高，见 StatsPills .pill）
			 * + dock 自身 padding-top 4px = 26px；有内容时内容本身更高，
			 * 规则自动无事发生。不用 :empty（JSX 换行空白文本节点会让它误判）。
			 * 第二条的 !important 用来压过上游 `.hero .dock:empty{display:none}`
			 *（那条没带 !important）。queue 用的是 data-queue-dock，不在内。
			 * 关闭：polishSurfaces=native。回滚：删掉下面两条。 */
			"[data-composer-dock]{min-height:26px}",
			"html .hero [data-composer-dock]{display:flex!important}",

			/* ---- 8. 排队消息面板（QueueDock）：底色回到主题 ----------------
			 * 官方排队面板的 ::before = --dsw-specific-menu + 菜单毛玻璃
			 * （类名 hash 随构建变化，这里按 class$='_panel' 后缀匹配，并限定在
			 * [data-queue-dock] 内，避免撞上别处的同名后缀）。
			 * 两层问题：① 半透明毛玻璃会把下层（白色消息卡片）透出来；
			 * ② 改主题的插件同样用 `body:not(...)` 级特异性去写这个 token，
			 * 与官方主题规则同权，谁后加载谁赢 —— 面板实际拿到的是官方冷白
			 * (#F7F8F9)，跟 body 的暖米色 (#FAF9F5) 一眼就能看出不统一。
			 * 所以底色不赌 token：用 JS 读 body 的计算背景色写到
			 * --polish-surface，与页面同源，深浅主题自动跟随。
			 * 圆角与 .5px 描边（::after）保持官方不动。 */
			"[data-queue-dock] [class$='_panel']:before{"
			+ "background:var(--polish-surface,var(--dsw-alias-bg-base,var(--dsw-specific-menu)))!important;"
			+ "backdrop-filter:none!important;"
			+ "-webkit-backdrop-filter:none!important;"
			+ "}",
			/* ---- 7d-2. 菜单毛玻璃：回落 0.2.2 的不透明度调整 -------------------
			 * 0.2.2 把 --dsw-menu-surface-fill 从 .58/.45 提到 .70/.64，模糊还在，
			 * 但被更实的底色盖住，观感上等于「全局没有模糊了」。这里只回落这一条
			 * token 到 0.2.1 的值；--dsw-menu-backdrop-filter（blur 40 saturate 150%）
			 * 不动，MenuSurface 的 .material 自己会用它。
			 * 作用域限定 body / body[data-ds-dark-theme]（与官方同特异性、后注入者赢）。
			 * 嫌太透就删掉本条；整段关掉用 polishSurfaces=native。 */
			"body{--dsw-menu-surface-fill:rgba(248,249,250,.45)}",
			"body[data-ds-dark-theme]{--dsw-menu-surface-fill:rgba(67,69,74,.45)}",

			/* ---- 7d-3. 浮层统一「真毛玻璃」（2026-11-09，写死版）-----------
			 * 报障：「工作区筛选」那种面板看着是实心板，不是玻璃。
			 *
			 * 直接写死一套数值，不做任何运行时检测。上一版试过
			 * MutationObserver + getComputedStyle 动态判「该不该补模糊」，
			 * 结果把毛玻璃整体搞没了 —— 教训记在这里，别再重走：
			 *
			 * ⚠️ **绝不能让 `[data-menu-backing]` 变透明**。上一版加过
			 * `html[data-platform='darwin'] [data-menu-backing]{background:
			 * transparent}`，理由是「不透明衬底让模糊采样到纯色，玻璃面向
			 * 一堵墙」。这个推理是错的、且后果严重：MenuSurface 的 .material
			 * 是 `backdrop-filter` 层，它采样的是**它下面的东西**；在 darwin
			 * 上窗口是 native vibrancy（真透明窗体），.material 下面什么都
			 * 没有，`.backing` 正是官方垫给它的「可采样内容」（MenuSurface.
			 * module.css 的注释写得很明白：Chromium needs opaque pixels
			 * behind the page content to blur it over native vibrancy）。
			 * 把 backing 让成透明 = 模糊层下面彻底空的 → 整块菜单位的模糊
			 * 直接消失，看起来就是「毛玻璃没了」。
			 * **结论：backing 保持官方不透明，一个字都别改。**
			 *
			 * 真正要改的只有填充 token（那条 darwin .94 的兜底把填充抬到近
			 * 实心，压住了 blur 的结果）。这里三档全写死：
			 *   浅色 rgba(248,249,250,.42) / 深色 rgba(67,69,74,.45)
			 *   模糊写死 blur(44px) saturate(180%)，不再跟着 token 走
			 *   （官方是 blur(40)/saturate(150%)，这里加一档让磨砂感更实）。
			 *
			 * 为什么全都 !important + 逐档重复：官方 darwin 那条与 body 那条同
			 * 权且写在后面，不压就输；主题层会在运行时重建 style，靠顺序不保险。
			 *
			 * 回滚：删掉 7d-3 这一整段（回落到 7d-2 的 .45 菜单填充 + 官方
			 * blur 40/150%，即本次修改前的状态）。 */
			"body{--dsw-menu-surface-fill:rgba(248,249,250,.42)!important}",
			"body[data-ds-dark-theme]{--dsw-menu-surface-fill:rgba(67,69,74,.45)!important}",
			"html[data-platform='darwin'] body{--dsw-specific-menu:rgba(248,249,250,.42)!important}",
			"html[data-platform='darwin'] body[data-ds-dark-theme]{--dsw-specific-menu:rgba(67,69,74,.45)!important}",
			"body{--dsw-menu-backdrop-filter:blur(44px) saturate(180%)!important}",
			/* 分组标题条官方是 .94 实心，压在玻璃面上会糊出一道横杠。 */
			"body{--dsw-alias-menu-group-header-fill:transparent!important}",
			/* 直接落到组件上，不靠 token 传递：菜单的 .material（模糊层）与
			 * 取 --dsw-specific-menu 的那批面板，都按同一套写死值铺。
			 * 用属性/后缀锚，不用构建 hash 前缀。 */
			'[data-menu-material]{'
			+ "background:rgba(248,249,250,.42)!important;"
			+ "-webkit-backdrop-filter:blur(44px) saturate(180%)!important;"
			+ "backdrop-filter:blur(44px) saturate(180%)!important;"
			+ "}",
			'body[data-ds-dark-theme] [data-menu-material]{background:rgba(67,69,74,.45)!important}',
			] : []),

			...(SW.dragzone ? [
			/* ---- 9. 顶部条 = 窗口拖拽区（仅 macOS）------------------------
			 * DSH 在 darwin 上建窗用的是 titleBarStyle:"hiddenInset"（main.js），
			 * 也就是没有原生标题栏、网页一直画到窗口顶、红绿灯浮在网页上 ——
			 * 所以双击顶部命中的是普通网页内容，系统不会做任何事。
			 * 把顶部条标成 -webkit-app-region:drag 后，它就等同于系统标题栏：
			 * 拖动可移窗、双击走 macOS 的「双击窗口标题栏以：缩放/最小化」
			 * （具体动作由系统设置 AppleActionOnDoubleClick 决定，插件不越权模拟）。
			 * 只给行自身加 drag，行内可交互元素一律退回 no-drag，按钮照常可点。
			 * 平台判断用 preload 已经标好的 html[data-platform]。
			 *
			 * ⚠️ no-drag 白名单只列「真正可交互」的角色：no-drag **会顺着子树往下传**，
			 * 一个 0×0 的容器被标中，它下面**整块**都拖不动。宽白名单（`[role]` /
			 * `[tabindex]` / `[data-slot]`）就吃过这个亏 —— 实测 `_logoRow`（256×60）
			 * 的 38 个后代 computed 全是 no-drag，而直接命中的只是
			 * `[data-slot="sidebar.brand.mark"]` / `sidebar.brand.name` 这类纯容器；
			 * 会话头同理，只剩会话标题行（class$='_titleRow'）自己还是 drag。
			 * 收窄成具体角色后：logoRow 命中 4→2、header 3→1，释放的都是 0×0 容器，
			 * 真正的按钮仍被 `button` / `[role=button]` / `[tabindex]` 兜住。 */
			"html[data-platform='darwin'] [data-polish-dragzone]{-webkit-app-region:drag;-webkit-user-select:none;user-select:none}",
			"html[data-platform='darwin'] [data-polish-dragzone] "
			+ ":is(button,a,input,textarea,select,summary,label,[contenteditable='true'],"
			+ "[role='button'],[role='link'],[role='tab'],[role='menuitem'],[role='switch'],[role='checkbox'],[role='radio'],"
			+ "[tabindex]:not([tabindex='-1']))"
			+ "{-webkit-app-region:no-drag}",

			/* ---- 9c. 应用级标题栏拖拽带（darwin）------------------------------
			 * 上面两条只管 `conversation.session.header` 与 `_logoRow`，**够不到窗口
			 * 最顶那一条**（红绿灯所在行 + 会话 tab + 右上角按钮）—— 而它恰恰是最
			 * 自然的拖拽手势落点（用户报「这一块拖不动」）。
			 * 官方在 darwin 上一个 drag 区都没铺：主窗口里唯一那处 `app-region:drag`
			 * 写在 `[data-windows-titlebar]` 下 AppFrame 容器的 `::before{…inset:0 0 auto}`
			 * 上，是 **Windows 专属**。这里照抄同构做法给 darwin 铺一条，高度 38px
			 * （盖住 tab 行、不侵入下面的会话标题行）。
			 * `::before` 是 frame 的伪元素、`position:absolute` 脱离 grid，按 DOM 顺序
			 * 排在三个 col 之前；而 Electron 的 drag 判定是「命中矩形集合」而非
			 * 「最顶层元素」，所以下层这条带子照样能拖 —— 也正是官方 Windows 版
			 * 能拖的原理。第二条给带内交互元素挖洞（`[role=tab]` 保证 tab 仍可点、
			 * 右上角那两个 button 同理）。 */
			"html[data-platform='darwin'] [class$='_frame']::before{"
			+ "content:'';"
			+ "position:absolute;"
			+ "inset:0 0 auto;"
			+ "height:38px;"
			+ "-webkit-app-region:drag;"
			+ "}",
			"html[data-platform='darwin'] [class$='_frame'] "
			+ ":is(button,a,input,textarea,select,summary,label,[contenteditable='true'],"
			+ "[role='button'],[role='link'],[role='tab'],[role='menuitem'],[role='switch'],[role='checkbox'],[role='radio'],"
			+ "[tabindex]:not([tabindex='-1']))"
			+ "{-webkit-app-region:no-drag}",
			] : []),

			...(SW.surfaces ? [
			/* ---- 7b. antd 面板 (Ant Design): brand realignment ------------
			 * 宿主 = 任何把 antd 打进 UI 的插件（本机 = @michengai/dsh-archive-manager，
			 * antd 6.x）。这类宿主一般已给自己的类名上 token，真正漏的是 antd 运行时
			 * CSS-in-JS 的默认值（primary blue / 焦点环 / hover 态）。antd 产出的是低
			 * 特异性的 `:where(.css-*).ant-*`，所以 `[class*=ant-] .ant-*` + 定点
			 * !important 就能压过，且不碰布局规则。
			 * 作用域：前缀由 `body` 换成 `[class*=ant-]`（antd 渲染子树的通用锚）
			 * —— 只有祖先带 ant- 类名的 antd 组件会被改色，页面上任何孤立的
			 * 同名元素不再被误伤。特异性 (0,2,0) 仍压过 antd 自己的 (0,1,0)。 */
			"[class*=ant-] .ant-btn-primary{"
			+ "background:var(--dsw-alias-brand-primary)!important;"
			+ "border-color:var(--dsw-alias-brand-primary)!important;"
			+ "color:var(--dsw-alias-label-primary-foreground,#fff)!important;"
			+ "transition:background var(--polish-dur-fast) var(--polish-ease-out),box-shadow var(--polish-dur-fast) var(--polish-ease-out),transform var(--polish-dur-fast) var(--polish-ease-out)!important;"
			+ "}",
			"[class*=ant-] .ant-btn-primary:not(:disabled):hover{"
			+ "background:color-mix(in srgb,var(--dsw-alias-brand-primary) 88%,#000)!important;"
			+ "border-color:transparent!important;"
			+ "}",
			"[class*=ant-] .ant-btn-primary:not(:disabled):active{transform:scale(.97)!important}",
			"[class*=ant-] .ant-btn-default{"
			+ "border-color:var(--dsw-alias-border-l2)!important;"
			+ "color:var(--dsw-alias-label-primary)!important;"
			+ "background:transparent!important;"
			+ "transition:border-color var(--polish-dur-fast) var(--polish-ease-out),background var(--polish-dur-fast) var(--polish-ease-out)!important;"
			+ "}",
			"[class*=ant-] .ant-btn-default:not(:disabled):hover{"
			+ "border-color:var(--dsw-alias-border-l3)!important;"
			+ "background:var(--dsw-alias-interactive-bg-hover)!important;"
			+ "color:var(--dsw-alias-label-primary)!important;"
			+ "}",
			"[class*=ant-] .ant-select-focused:not(.ant-select-disabled) .ant-select-selector,"
			+ "[class*=ant-] .ant-input:focus,[class*=ant-] .ant-input-focused,"
			+ "[class*=ant-] .ant-input-textarea:focus-within,"
			+ "[class*=ant-] .ant-input-affix-wrapper-focused{"
			+ "border-color:var(--dsw-alias-brand-primary)!important;"
			+ "box-shadow:none!important;"
			+ "}",
			"[class*=ant-] .ant-tabs-tab:hover .ant-tabs-tab-btn{color:var(--dsw-alias-label-primary)!important}",
			"[class*=ant-] .ant-tabs-tab.ant-tabs-tab-active .ant-tabs-tab-btn{color:var(--dsw-alias-label-primary)!important}",
			"[class*=ant-] .ant-switch-checked{background:var(--dsw-alias-brand-primary)!important}",
			"[class*=ant-] .ant-checkbox-checked .ant-checkbox-inner{background:var(--dsw-alias-brand-primary)!important;border-color:var(--dsw-alias-brand-primary)!important}",
			"[class*=ant-] .ant-radio-checked .ant-radio-inner{border-color:var(--dsw-alias-brand-primary)!important}",
			"[class*=ant-] .ant-radio-checked .ant-radio-inner:after{background:var(--dsw-alias-brand-primary)!important}",

			/* ---- 7d. 回退插件（dsh-rewind-plugin）的弹层：补上菜单毛玻璃 -------
			 * 报障：「回退」点开的那块面板是实心板，跟官方菜单不是一个材质。
			 *
			 * 病因 = 两处浮层（.dsh-rewind-popover = 回退/撤回面板，
			 * .dsh-rewind-guard-hint = 输入区上方那条瞬时提示）只有半透明底
			 * （background:var(--dsw-specific-menu,…)）没有模糊：整个包体里
			 * backdrop-filter 出现 0 次。而且它们取的 token 也不对 ——
			 * --dsw-specific-menu 是**无衬底浮层**的保守档（实测本机安装
			 * app.asar 字节：darwin 上被提到 rgba(248,249,250,.94) ≈ 实心），
			 * 官方菜单真正那层玻璃是 MenuSurface.module.css 的 .material =
			 * --dsw-menu-surface-fill(.58 亮 / .45 暗) + --dsw-menu-backdrop-filter
			 * (blur(40px) saturate(150%))。所以 blur 两处都补，底色只给**面板**换到
			 * .58 那一档（guard-hint 那条纯文字提示保持它自己的保守档，理由见下）：
			 *   background: var(--dsw-menu-surface-fill);   ← 仅 .dsh-rewind-popover
			 *   backdrop-filter: var(--dsw-menu-backdrop-filter);
			 * 这正是我们自家面板（dsh-card-summon 的 .dcs-panel/.dcs-detail、
			 * dsh-todo-float 的 card）一直在用的同一组 token，深浅主题自动跟随。
			 *
			 * 只在这两个类名上换**消费关系**，不定义、不覆盖任何菜单 token ——
			 * --dsw-menu-* 属于官方菜单面，主题与调色盘都刻意不碰（见
			 * dsh-official-ui-spec L5 与 theme-manager v0.6.0「菜单保持官方
			 * 原样」的教训）。fallback 链保留 rewind 原值，宿主若没有这两个
			 * token 就退回它自己原来的底色，不会出现透明面板。
			 *
			 * 影响面只在 macOS：非 darwin 上 --dsw-specific-menu 逐字就等于
			 * var(--dsw-menu-surface-fill)（实测 ui-theme design-platform.css
			 * body / body[data-ds-dark-theme] 两处），所以这次换 token 在
			 * Windows/Linux 上是等价改写、无视觉差异；真正变化的只有 darwin
			 * 那一档 .94 → .58。
			 *
			 * ⚠️ 已知未实测项（advisor 复核提出，如实记录）：官方给 darwin .94 的
			 * 理由是「没有 MenuSurface .backing 不透明衬底的浮层，在 native
			 * vibrancy 上模糊不可靠」。我们刻意没复刻 .backing（那要 JS portal +
			 * CSS anchor，超出 CSS 补丁面），所以 darwin 上这块面板可能比官方
			 * 略透；若面板贴近窗口边缘、blur 采样到 vibrancy 透明区，理论上会
			 * 发灰或带脏边。**结论尚未取得像素级证据**（本机 dsh://host inspector
			 * 只有主进程 target，无 DOM，取不到 getComputedStyle/截图）。
			 * 判据与退路：肉眼若嫌太透 → 删掉下面那条**只给面板换底色**的规则，
			 * 就恢复官方保守档（.94 + blur，即与 QueueDock / TodoPanel 同档）；
			 * 要整段关掉本段三条 → polishSurfaces=native。
			 *
			 * !important 是必需的，不是顺手：rewind 自己的 <style> 同样 append
			 * 到 head，单类选择器与我们同特异性，谁赢取决于插件加载顺序，不能赌。
			 * 代价写在明处 —— 若上游哪天自己修好了这两条，这条会压住它，届时删掉
			 * 本段即可（polishSurfaces=native 也能整段关）。 */
			/* 两处都补 blur（官方三件套里缺的那条）。 */
			".dsh-rewind-popover,.dsh-rewind-guard-hint{"
			+ "backdrop-filter:var(--dsw-menu-backdrop-filter)!important;"
			+ "-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter)!important;"
			+ "}",
			/* 底色**只给面板**换到官方菜单面那一档。guard-hint 不跟着换：它是
			 * 一条 role="status" 的纯文字提示（3.2s 自动消失、无内部衬底），
			 * 透到 .58 会让字压在正文上读不清；保持它自己那份无衬底保守档
			 * （darwin .94）+ blur，正好等于官方 QueueDock / TodoPanel /
			 * HoverCard.media 那一族的逐字配方。
			 * 面板内部的行都是 transparent / hover 才起底，不会有一层实心子
			 * 节点把 blur 挡掉（已逐条核对 rewind 的 STYLE 表）。 */
			".dsh-rewind-popover{"
			+ "background:var(--dsw-menu-surface-fill,var(--dsw-specific-menu,var(--dsw-alias-bg-layer-3)))!important;"
			+ "}",
			/* 配套项（非本次修复成果）：面板里的滚动区跟随官方菜单面声明 l2 滚动条
			 * 色，与上面几条同批注入、同批摘除。polish 已把全局滚动条宽度收为 0，
			 * 这条只在恢复显示滚动条的环境里起作用。 */
			".dsh-rewind-popover{--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}",

			/* ---- 8. session header rhythm (0.1.7 UI) --------------------
			 * Two real misalignments, both from the shell's own rules:
			 *  a) the header grid pads 20px left, but the tab row adds its
			 *     own padding-left:8px — the capsule lands at 28px while
			 *     the title above sits at 20px;
			 *  b) header padding is `10px 28px 0 20px` — zero breathing
			 *     room under the tab row against its bottom border.
			 * Stable hooks: the header's data-slot anchor + class-suffix
			 * selectors (hash prefixes change per build, suffixes don't). */
			] : []),

			...(SW.drag ? [
			/* ---- 9. QueueDock drag-sort affordances --------------------- */
			"[data-queue-dock] ul[class$='_list']:not([hidden]) > li::before{"
			+ "content:'⠿';width:14px;height:24px;flex:none;margin-right:-4px;"
			+ "display:flex;align-items:center;justify-content:center;"
			+ "cursor:grab;color:var(--dsw-alias-label-tertiary);"
			+ "opacity:.4;font-size:12px;line-height:1;user-select:none;-webkit-user-select:none;"
			+ "transition:opacity var(--polish-dur-fast) var(--polish-ease-out)"
			+ "}",
			"[data-queue-dock] ul[class$='_list'] > li:only-child::before{display:none}",
			"[data-queue-dock] [class$='_row']:hover::before{opacity:.9}",
			"[data-queue-dock] [class$='_row'][data-polish-dragging]::before{cursor:grabbing}",
			"[data-queue-dock] [class$='_row']{transition:transform 160ms var(--polish-ease-out)}",
			"[data-queue-dock] [class$='_row'][data-polish-dragging]{opacity:.85;z-index:5;transition:none!important}",
			"[data-queue-dock] [class$='_row'][data-polish-lifted]{transform:translateY(var(--polish-drag-delta,0px));transition:transform 160ms var(--polish-ease-out)}",
			"[data-queue-dock] ul[class$='_list']:not([hidden]){display:flex;flex-direction:column}",
			] : []),

			...(SW.perf ? [
			/* ---- 9b. Render performance ------------------------------
			 * Fence the composer card so typing reflows stay local.
			 * contain:style ONLY — layout/paint containment turns a card into
			 * the containing block for any fixed-positioned popover rendered
			 * inside it (that is how the "reasoning level" panel flew to the
			 * top-left corner). style keeps the style-rec isolation with no
			 * geometry side effects.
			 * Think rows are deliberately NOT touched — their measurement
			 * belongs to the chat package's own reasoning renderer
			 * (slot `conversation.chat.reasoning.content`).
			 * Deliberately absent — introduced in 5aecdbf, reverted in
			 * b0eb98f because both drift the conversation area away from
			 * the official look: code-block content-visibility, and
			 * overscroll-behavior on the conversation scroller. */
			"[data-composer-card]{contain:style}",
			] : []),
			/* ---- 9e. Session row time labels keep a stable width. ---------- */
			...(SW.timeLabel ? [
			"[class$='_sessionRow'] [class$='_time']{min-width:34px;text-align:right;font-variant-numeric:tabular-nums}",
			] : []),

			/* ---- 9c. Micro-interactions (response on contact) --------
			 * Apple: feedback starts on pointer-down, not after release.
			 * Everything here is transform/background only. */
			"[class*=ant-] .ant-btn:not(:disabled):active{transform:scale(.96)!important}",
			"::selection{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 22%,transparent)}",

			...(SW.imageZoom ? [
			/* ---- 11. 图片灯箱增强：按钮缩放 / 滚轮与拖拽平移 / 旋转 --------
			 * 官方点开聊天图片只有「全屏 mask + 居中大图 + 右上关闭」，
			 * 没有缩放、旋转，也拖不动。交互对齐 QQ 看图：**滚轮是滚动平移，
			 * 缩放只走按钮**。变换走 CSS 变量（见 imageZoom 段），避免和
			 * React 争 `img.style.transform`。 */
			'[data-polish-lb]{'
			+ 'transform:translate3d(var(--polish-lb-x,0px),var(--polish-lb-y,0px),0) '
			+ 'scale(var(--polish-lb-scale,1)) rotate(var(--polish-lb-rot,0deg));'
			+ 'transition:transform .12s cubic-bezier(.25,1,.3,1);'
			+ 'cursor:grab;touch-action:none;user-select:none;-webkit-user-drag:none'
			+ '}',
			'[data-polish-lb][data-polish-lb-drag]{transition:none;cursor:grabbing}',
			'[data-polish-lb-host]{overflow:hidden}',
			'[data-polish-lb-bar]{'
			+ 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2;'
			+ 'display:flex;align-items:center;gap:4px;padding:6px;'
			+ 'border:.5px solid var(--dsw-alias-border-l2-darkmode-thin);border-radius:999px;'
			+ 'background:var(--dsw-specific-input-major);'
			+ 'box-shadow:var(--dsw-elevation-panel);color:var(--dsw-alias-label-primary)'
			+ '}',
			'[data-polish-lb-bar] button{'
			+ 'display:grid;place-items:center;width:40px;height:40px;padding:0;'
			+ 'border:0;border-radius:999px;background:transparent;color:inherit;cursor:pointer'
			+ '}',
			'[data-polish-lb-bar] button:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'[data-polish-lb-bar] svg{display:block;width:20px;height:20px}',
			'[data-polish-lb-bar] [data-polish-lb-value]{'
			+ 'min-width:52px;text-align:center;font-size:12px;line-height:18px;'
			+ 'color:var(--dsw-alias-label-secondary);font-feature-settings:"tnum"'
			+ '}',
			] : []),
		].join("\n");

		function ensureStyles() {
			if (typeof document === "undefined") return;
			// 复用同一个 <style> 并始终写入当前版本：client 插件被热重载时旧标签仍挂在
			// head 上，靠模块级「只插一次」的标志会留下旧样式 —— 新逻辑配着旧 CSS 跑。
			let el = document.head.querySelector("style[data-dsh-polish]");
			if (el === null) {
				el = document.createElement("style");
				el.setAttribute("data-dsh-polish", "");
				document.head.appendChild(el);
			}
			if (el.textContent !== CSS) el.textContent = CSS;
		}

		/* 面板底色：不赌 token（官方主题规则会把它压回默认），直接读 body 的
		 * 计算背景色写到 --polish-surface，与页面同源；深浅主题切换时
		 * 下一次 measure 会重新发布。 */
		let lastSurface = "";
		function publishSurface() {
			if (!SW.surfaces) return;
			try {
				/* 底色不一定在 body 上 —— 实测本机 body 就是透明背景，主题把底色
				 * 放在 html（或某个容器）里；只读 body 会拿到 transparent，面板就
				 * 退回 token 层，又踩「token 被官方主题规则压回默认值」的坑。
				 * 所以按 html → body 取第一个不透明的。 */
				const read = (el) => (el ? getComputedStyle(el).backgroundColor : "");
				const usable = (color) => color !== "" && color !== "transparent" && color !== "rgba(0, 0, 0, 0)";
				const bg = [read(document.documentElement), read(document.body)].find(usable);
				if (bg === void 0 || bg === lastSurface) return;
				lastSurface = bg;
				document.documentElement.style.setProperty("--polish-surface", bg);
				/* 独立的镜像探针：不依赖「有没有排队消息」，页面一加载就能从
				 * localStorage 读到实际值，便于在没有队列的情况下核对版本与底色。 */
				window.localStorage.setItem("dsh-plugin-polish:surface", bg);
			} catch (err) { /* fail soft */ }
		}

		/* 顶部拖拽区打标：只在 macOS 上做（preload 已把 process.platform 写进
		 * html[data-platform]），CSS 侧负责 -webkit-app-region。React 会重建
		 * 这些节点，所以每次测量补一次标（已有标记的直接跳过）。 */
		const DRAGZONE_SELECTORS = [
			'[data-slot="conversation.session.header"]',   /* 对话框顶部：标题行 + 标签行 */
			'[class$="_logoRow"]',                         /* 侧边栏顶部 brand 行 */
		];
		function applyDragzone() {
			try {
				if (!SW.dragzone) return;
				const root = document.documentElement;
				if (root === null || root.dataset.platform !== "darwin") return;
				for (const selector of DRAGZONE_SELECTORS) {
					for (const el of document.querySelectorAll(selector)) {
						if (el.hasAttribute("data-polish-dragzone")) continue;
						el.setAttribute("data-polish-dragzone", "");
					}
				}
			} catch (err) { /* fail soft */ }
		}

		/* ================================================================
		 * Shell decoration: recheck only when the header, brand row, QueueDock,
		 * or theme changes. Token streaming does not affect these surfaces.
		 * ================================================================ */
		const shellDecor = (function () {
			let raf = 0;
			function measure() {
				raf = 0;
				publishSurface();
				applyDragzone();
			}
			function schedule() {
				if (raf === 0) raf = requestAnimationFrame(measure);
			}
			function start() {
				if (typeof MutationObserver !== "undefined") {
					const watched = [...DRAGZONE_SELECTORS, "[data-queue-dock]"];
					const topo = new MutationObserver((records) => {
						if (records.some((record) => [...record.addedNodes, ...record.removedNodes].some((node) =>
							node.nodeType === 1 && watched.some((selector) => node.matches?.(selector) || node.querySelector?.(selector))))) schedule();
					});
					topo.observe(document.body, { childList: true, subtree: true });
					const theme = new MutationObserver(schedule);
					for (const target of [document.documentElement, document.body]) theme.observe(target, { attributes: true, attributeFilter: ["class", "data-theme", "data-color-scheme"] });
				}
				window.addEventListener("resize", schedule, { passive: true });
				schedule();
			}
			return { start };
		})();

		/* ================================================================
		 * QueueDock drag-sort.
		 *
		 * React owns node order, so the drag writes CSS `order` for the
		 * picture — and then reports the resulting permutation to the host
		 * half (`/plugins/dsh-plugin-polish/queue-order`), which splices the
		 * agent inbox. Without that second step the dock's order and the
		 * send order disagree: the rows look sorted and the agent still
		 * walks the original array.
		 *
		 * The host route refuses anything it cannot map 1:1 (stale view,
		 * claimed head, non-plain rows), and this side then drops the visual
		 * order back onto React's sequence — the picture never claims an
		 * order the host did not accept.
		 * ================================================================ */
		const dragSort = (function () {
			/* Keep ids off the host DOM so React retains full ownership. */
			const ids = new WeakMap();
			const groupOrders = new WeakMap();
			let nextId = 1;
			let dragging = null;       /* {node, startY, delta} */
			let hostCtx = null;        /* host ctx for the sessions service */
			let started = false;       /* one observer per page, not per apply() */
			const ORDER_ROUTE = "/plugins/dsh-plugin-polish/queue-order";
			/* Set once the route answers 404/405/HTML: the host half is not
			 * mounted (old build, or the app was never restarted after the
			 * update), so every later drag stays purely visual. */
			let hostHalfMissing = false;

			/* Rows React renders from the durable queue — the echo rows for
			 * in-flight submissions (`data-submission-echo`) have no host
			 * identity yet and are excluded from every mapping below. */
			function durableRows(parent) {
				return [...parent.children].filter((node) =>
					node.nodeType === 1
					&& node.matches("li")
					&& !node.hasAttribute("data-submission-echo"));
			}

			/* The session this dock belongs to, read from the host's own anchor
			 * (`data-conversation-session`, the attribute the official stop
			 * shortcut also resolves through). */
			function sessionOf(node) {
				const host = node.closest("[data-conversation-session]");
				const id = host && host.dataset ? host.dataset.conversationSession : "";
				return typeof id === "string" ? id : "";
			}

			/* Host queue identities in host order, or null when the projection is
			 * unavailable (no ctx, cold session, projection not registered). */
			function queuedIds(sessionId) {
				try {
					if (!hostCtx || typeof hostCtx.get !== "function") return null;
					const sessions = hostCtx.get("sessions");
					if (!sessions || typeof sessions.binding !== "function") return null;
					const binding = sessions.binding(sessionId);
					if (!binding || !binding.session || !binding.session.projections) return null;
					const inbox = binding.session.projections.faceOf("inbox").getSnapshot();
					if (!inbox || !Array.isArray(inbox["next-turn"])) return null;
					return inbox["next-turn"].map((row) => String(row.id));
				} catch (err) {
					return null;
				}
			}

			/* Map the current visual order onto host identities.
			 * Returns null whenever the mapping would be a guess. */
			function permutedIds(parent) {
				const sessionId = sessionOf(parent);
				if (sessionId.length === 0) return null;
				const expected = queuedIds(sessionId);
				if (expected === null) return null;
				const rows = durableRows(parent);
				/* Any in-flight echo row makes the mapping ambiguous even when the
				 * surviving count happens to match: an echo has no host identity,
				 * so which row owns which id stops being determined by position.
				 * Refuse outright rather than reason about a partially-unknown
				 * list. */
				const total = [...parent.children].filter((node) => node.nodeType === 1 && node.matches("li"));
				if (total.length !== rows.length) return null;
				/* DOM order IS host order (React renders the inbox array), so a
				 * strict 1:1 count is what makes the mapping exact. */
				if (rows.length !== expected.length || rows.length < 2) return null;
				const rank = groupOrders.get(parent) || [];
				const rankOf = new Map(rank.map((id, index) => [id, index]));
				/* Every row must have a rank from the same reconcile pass that
				 * produced the host ids; a missing one means the DOM and the
				 * projection disagree, and guessing an index there would send a
				 * plausible-but-wrong order. */
				const entries = [];
				for (let index = 0; index < rows.length; index += 1) {
					const nodeId = idOf(rows[index]);
					if (!rankOf.has(nodeId)) return null;
					entries.push({ index, rank: rankOf.get(nodeId) });
				}
				entries.sort((a, b) => a.rank - b.rank);
				const next = entries.map((entry) => expected[entry.index]);
				return next.every((id, i) => id === expected[i]) ? null : next;
			}

			/* Report a permutation; roll the picture back only when the host
			 * actually answered "no". A transport hiccup keeps the picture:
			 * retrying a refused order is pointless, and reverting on a network
			 * blip would flip rows under the cursor for no reason. */
			function commitOrder(parent) {
				const next = permutedIds(parent);
				if (next === null) return;
				const sessionId = sessionOf(parent);
				pushOrder(sessionId, next).then(function (outcome) {
					if (outcome !== "refused") return;
					/* The host kept its own order: put the rows back where React
					 * says they are, so the dock never shows an order that will
					 * not be used. Host order = DOM order, so clearing our rank
					 * list restores it without inventing anything. */
					groupOrders.set(parent, durableRows(parent).map(idOf));
					applyOrder();
				}).catch(function () { /* transport hiccup: keep the picture */ });
			}

			/* POST one permutation.
			 * @returns "accepted" | "refused" | "unknown" */
			function pushOrder(sessionId, order) {
				if (hostHalfMissing) return Promise.resolve("unknown");
				return fetch(ORDER_ROUTE, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ session: sessionId, ids: order })
				}).then(function (response) {
					const type = response.headers && response.headers.get
						? (response.headers.get("content-type") || "")
						: "";
					/* A non-JSON answer means the route is absent and the SPA
					 * fallback answered instead — stop trying for this page. */
					if (type.indexOf("application/json") === -1) {
						hostHalfMissing = true;
						return "unknown";
					}
					if (response.ok) return "accepted";
					/* 4xx is the host telling us the view is stale; 5xx is us
					 * breaking something, which reverting cannot fix. */
					return response.status >= 400 && response.status < 500 ? "refused" : "unknown";
				});
			}

			/* QueueDock 是宿主所有的 keyed <li> 列表。 */
			function bubbles() {
				/* 只管理 QueueDock；对话流中的气泡由 React 管理，插入把手或
				 * 移动节点会与它的 keyed 更新争夺同一棵 DOM。 */
				return [...document.querySelectorAll("[data-queue-dock] ul[class$='_list'] > li")].filter((n) => n.isConnected);
			}

			function idOf(node) {
				let id = ids.get(node);
				if (!id) {
					id = String(nextId++);
					ids.set(node, id);
				}
				return id;
			}

			/* Reconcile ids with currently mounted rows. */
			function reconcile() {
				const list = bubbles();
				const groups = new Map();
				for (const node of list) {
					const members = groups.get(node.parentNode) ?? [];
					members.push(node);
					groups.set(node.parentNode, members);
				}
				for (const [parent, members] of groups) {
					const present = new Set(members.map(idOf));
					const next = (groupOrders.get(parent) ?? []).filter((id) => present.has(id));
					const known = new Set(next);
					for (const node of members) {
						const id = idOf(node);
						if (!known.has(id)) { next.push(id); known.add(id); }
					}
					groupOrders.set(parent, next);
				}
				return list.length > 0;
			}

			function applyOrder() {
				/* CSS order 只改视觉顺序；React 保留原来的 keyed DOM 和按钮事件。
				 * 直接 insertBefore 会在每次 React 重绘后再次触发 MutationObserver，
				 * 与 React 反复搬同一批节点，造成图标闪烁和主线程卡死。 */
				const ranksByParent = new Map();
				for (const node of bubbles()) {
					const parent = node.parentNode;
					if (!ranksByParent.has(parent)) ranksByParent.set(parent, new Map((groupOrders.get(parent) ?? []).map((id, index) => [id, index])));
					const rank = String(ranksByParent.get(parent).get(idOf(node)) ?? 0);
					if (node.style.order !== rank) node.style.order = rank;
				}
			}

			/* Only siblings in the same QueueDock can swap. */
			function sameGroupMates(node) {
				const parent = node.parentNode;
				if (!parent) return [];
				return bubbles().filter((n) => n !== node && n.parentNode === parent);
			}

			function attachHandlers(node, parent) {
				if (node.__polishDrag) return;
				node.__polishDrag = true;
				/* Pseudo-element handle: no injected child to confuse React. */
				node.addEventListener("pointerdown", function (ev) {
					if (ev.button !== 0) return;
					const rect = node.getBoundingClientRect();
					if (ev.clientX < rect.left + 8 || ev.clientX > rect.left + 36 || parent.children.length < 2) return;
					const nodeCenter = rect.top + rect.height / 2;
					/* 拖动开始时把同组项的「基准中心」量下来：先清掉我们之前写上去的
					 * transform 再测，免得把上次的位移当成基准。整个拖动过程只用这
					 * 份基准判断落点 —— 实时 rect 里含刚写上去的 transform，自己吃
					 * 自己会在相邻项之间来回翻，等高无间距的队列行尤其明显（就是
					 * 用户报的「拖拽时抖动」）。 */
					const mates = [];
					for (const sib of sameGroupMates(node)) {
						sib.style.removeProperty("transform");
						const sr = sib.getBoundingClientRect();
						mates.push({
							node: sib,
							center: sr.top + sr.height / 2,
							height: sr.height,
							shift: 0
						});
					}
					mates.sort((a, b) => a.center - b.center);
					let slot = 0;
					for (const mate of mates) if (nodeCenter > mate.center) slot++;
					dragging = {
						node,
						parent,
						startY: ev.clientY,
						startCenter: nodeCenter, /* untransformed center */
						height: rect.height,
						mates,
						fromSlot: slot,          /* 原始槽位，全程不变 */
						slot
					};
					node.setAttribute("data-polish-dragging", "");
				try { node.setPointerCapture(ev.pointerId); } catch (e) { /* ok */ }
					ev.preventDefault();
				});
				node.addEventListener("pointermove", function (ev) {
					if (!dragging || dragging.node !== node) return;
					const delta = ev.clientY - dragging.startY;
					node.style.setProperty("--polish-drag-delta", delta + "px");
					node.setAttribute("data-polish-lifted", "");
					const mates = dragging.mates;
					if (!mates || mates.length === 0) return;
					const myCenter = dragging.startCenter + delta;
					let slot = 0;
					for (const mate of mates) if (myCenter > mate.center) slot++;
					/* 只在真正跨过某一行的中线时才重排让位：一次跨界 = 一次位移，
					 * 松手前不再有任何抖动。 */
					if (slot === dragging.slot) return;
					/* from 必须是「拖动开始时的原始槽位」，绝不能跟着 slot 走 ——
					 * 否则来回拖时相邻项的位移会按增量累积（-36 → +36 → …），
					 * 松手后回不到原位，看上去就是一路乱跳。 */
					const from = dragging.fromSlot;
					dragging.slot = slot;
					mates.forEach(function (mate, index) {
						/* 我要插到第 slot 位：原本夹在 [from, slot) 的往上让，
						 * 夹在 [slot, from) 的往下让，其余不动。 */
						let shift = 0;
						if (slot > from && index >= from && index < slot) shift = -1;
						else if (slot < from && index >= slot && index < from) shift = 1;
						const px = Math.round(shift * (mate.height || dragging.height));
						if (mate.shift === px) return;
						mate.shift = px;
						if (px === 0) mate.node.style.removeProperty("transform");
						else mate.node.style.setProperty("transform", "translateY(" + px + "px)");
					});
				});
				node.addEventListener("pointerup", function () {
					if (!dragging || dragging.node !== node) return;
					endDrag(node, parent);
				});
				node.addEventListener("pointercancel", function () {
					if (!dragging || dragging.node !== node) return;
					endDrag(node, parent, false);
				});
			}

			function endDrag(node, parent, commit = true) {
				if (!dragging || dragging.node !== node) return;
				node.removeAttribute("data-polish-dragging");
				node.removeAttribute("data-polish-lifted");
				/* read before clearing */
				const delta = parseFloat(node.style.getPropertyValue("--polish-drag-delta")) || 0;
				node.style.removeProperty("--polish-drag-delta");
				const myCenter = dragging.startCenter + delta;
				/* 落点用拖动期间那份「基准中心」算（与视觉让位同源），不再用实时
				 * rect —— 否则松手瞬间残留 transform 会让落点跳一下。 */
				const mates = dragging.mates ?? [];
				for (const mate of mates) mate.node.style.removeProperty("transform");
				const order = groupOrders.get(parent) ?? [];
				const currentIndex = order.indexOf(idOf(node));
				const nextIndex = mates.filter((mate) => myCenter > mate.center).length;
				if (commit && currentIndex !== -1 && nextIndex !== currentIndex) {
					const moved = order.splice(currentIndex, 1)[0];
					order.splice(nextIndex, 0, moved);
					groupOrders.set(parent, order);
					applyOrder();
					/* The picture is now final; make the host agree before the next
					 * row is claimed, otherwise the drag is only skin-deep. */
					try { commitOrder(parent); } catch (err) { /* fail soft */ }
				}
				dragging = null;
			}

			function start(ctx) {
				/* The host ctx is only handed over on the second, ctx-carrying
				 * apply(); the factory's own bare bootstrap call arrives first.
				 * Record it and keep the first observer — a second `start()` must
				 * not stack another MutationObserver on the same tree.
				 *
				 * The ctx is BANKED, never gating: the bare call already started
				 * the observer, so returning early on the ctx-carrying call would
				 * drop the sessions service and leave every drag unable to read
				 * the host queue. Idempotence belongs to the observer, not to the
				 * ctx handover. */
				if (ctx) hostCtx = ctx;
				if (started) { refreshNow(); return; }
				started = true;
				if (typeof MutationObserver === "undefined") return;
				let raf = 0;
				function refresh() {
					if (dragging) return;
					if (!reconcile()) return;
					for (const node of bubbles()) attachHandlers(node, node.parentNode);
					applyOrder();
				}
				/* The ctx-carrying call may land after the bare one, so this is a
				 * named entry point the banked-ctx path can re-run. */
				function refreshNow() {
					if (typeof MutationObserver === "undefined") return;
					try { refresh(); } catch (err) { /* fail soft */ }
				}
				const mo = new MutationObserver(function (records) {
					/* Streamed answer updates are frequent and unrelated to QueueDock.
					 * Do not rescan all rows on every token or thought render. */
					const changed = records.some((record) => {
						if (record.target?.closest?.("[data-queue-dock]")) return true;
						return [...record.addedNodes, ...record.removedNodes].some((node) =>
							node.nodeType === 1 && (node.matches?.("[data-queue-dock]") || node.querySelector?.("[data-queue-dock]")));
					});
					if (!changed) return;
					if (raf) return;
					raf = requestAnimationFrame(function () {
						raf = 0;
						try { refresh(); } catch (err) { /* fail soft */ }
					});
				});
				try { refreshNow(); } catch (err) { /* fail soft */ }
				mo.observe(document.body, { childList: true, subtree: true });
			}

			return { start };
		})();

		/* ================================================================
		 * Parent-state markers — 把生态里最贵的 `:has()` 换成类名。
		 *
		 * `:has()` 的代价不在匹配本身，而在**失效范围**：宿主后代里任何节点
		 * 增删，浏览器都要为宿主重新求值一次，而这个宿主往往是整棵会话滚动
		 * 容器（几千个后代）。实测（0.1.7 界面，向会话容器插入一个节点取中
		 * 位）：完整 CSS 4.7ms → 停用单条
		 * `body.dsx-stats-active [data-conversation-scroll]:has([data-conversation-composer-overlay])`
		 * 后 0.6ms —— 一条规则占了 87% 的样式成本。
		 *
		 * 做法：把「宿主后代里有没有 X」交给 JS 判断一次，写成宿主上的一个
		 * 类名；CSS 侧把 `:has(X)` 替换成 `.polish-has-*`（类名走哈希索引，
		 * 失效范围回到元素自身）。改写走 CSSOM 替换原声明，层叠关系不变。
		 *
		 * 只登记**语义完全等价**的条目：`:has()` 内是单个简单选择器、不含
		 * `:not` / 组合器 / 伪类。匹配不到就原样留着（fail soft）。
		 * 开关：`html[data-polish-has="native"]`。
		 * ================================================================ */
		const parentState = (function () {
			const RULES = [
				{
					marker: "polish-has-composer-overlay",
					probe: "[data-conversation-composer-overlay]",
					host: "[data-conversation-scroll]"
				},
				{
					marker: "polish-has-market-root",
					probe: "[data-dsh-market-root]",
					host: "[role='dialog']"
				}
			];
			const CATCH_UP_MS = [300, 1200, 3000];
			let raf = 0;
			let timer = 0;
			let rewritten = 0;

			function enabled() {
				return document.documentElement.dataset.polishHas !== "native";
			}

			function escapeForRegExp(text) {
				return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			}

			/* 宿主上的类名 = 「后代里有没有 probe」，一次判定，零 CSS 求值 */
			function mark() {
				if (!enabled()) return;
				for (const rule of RULES) {
					let hosts = null;
					try { hosts = document.querySelectorAll(rule.host); } catch (err) { continue; }
					for (const host of hosts) {
						let want = false;
						try { want = host.querySelector(rule.probe) !== null; } catch (err) { continue; }
						if (host.classList.contains(rule.marker) !== want) {
							host.classList.toggle(rule.marker, want);
						}
					}
				}
			}

			function scheduleMark() {
				if (raf !== 0) return;
				raf = requestAnimationFrame(function () {
					raf = 0;
					try { mark(); } catch (err) { /* fail soft */ }
				});
			}

			function rewriteSelector(selector) {
				let next = selector;
				for (const rule of RULES) {
					const pattern = new RegExp(":has\\(\\s*" + escapeForRegExp(rule.probe) + "\\s*\\)", "g");
					if (pattern.test(next)) next = next.replace(pattern, "." + rule.marker);
				}
				return next === selector ? null : next;
			}

			function sweepRules(rules) {
				for (const rule of rules) {
					if (rule.cssRules && rule.cssRules.length) sweepRules(rule.cssRules);
					const selector = rule.selectorText;
					if (!selector || selector.indexOf(":has(") === -1) continue;
					try {
						const next = rewriteSelector(selector);
						if (next !== null) { rule.selectorText = next; rewritten++; }
					} catch (err) { /* 只读规则：跳过 */ }
				}
			}

			function sweep() {
				timer = 0;
				if (!enabled()) return;
				for (const sheet of document.styleSheets) {
					let rules = null;
					try { rules = sheet.cssRules; } catch (err) { continue; }
					if (rules) sweepRules(rules);
				}
				scheduleMark();
			}

			function schedule(delay) {
				if (timer !== 0) return;
				timer = setTimeout(sweep, delay);
			}

			function start() {
				try { sweep(); } catch (err) { /* fail soft */ }
				for (const delay of CATCH_UP_MS) schedule(delay);
				window.addEventListener("load", function () { schedule(0); }, { once: true });
				if (typeof MutationObserver === "undefined") return;
				const mo = new MutationObserver(function (records) {
					let styleHit = false;
					let probeHit = false;
					for (const record of records) {
						for (const node of [...record.addedNodes, ...record.removedNodes]) {
							if (node.nodeType !== 1) continue;
							if (node.tagName === "STYLE" || node.tagName === "LINK") styleHit = true;
							if (RULES.some((rule) => node.matches?.(rule.probe) || node.querySelector?.(rule.probe))) probeHit = true;
						}
						if (styleHit && probeHit) break;
					}
					if (styleHit) schedule(150);
					if (probeHit) scheduleMark();
				});
				mo.observe(document.documentElement, { childList: true, subtree: true });
			}

			return { start };
		})();

		/* ================================================================
		 * 会话 tab 的 hover 气泡抑制 —— polishTabTip
		 * ----------------------------------------------------------------
		 * 官方 tag 行每个 tab 都包了一层 ui-primitives 的 Tooltip
		 *（ConversationSession.tsx:208 `<Tooltip label={viewTab.label} portal>`），
		 * 悬停弹出的气泡内容就是 tab 自己的名字 —— 纯重复，还会盖住相邻 tab。
		 *
		 * 气泡被 portal 到 document.body（Tooltip.tsx:270），与 tab 没有祖先
		 * 关系，CSS 无法从 tab 反选它；气泡节点只有 role/data-portal/data-side
		 * 这些通用属性（Tooltip.tsx:219-228），没有调用方身份，全局压
		 * `[role=tooltip][data-portal]` 会连 StatsPills 的 reading 气泡一起干掉。
		 *
		 * 做法：指针进出时判断落点是不是 `[data-conversation-tabs]` 下的 tab
		 * 按钮，是则给 <html> 打 `data-polish-tip-off`，CSS（1.8 段）据此压掉
		 * portal 气泡。气泡只在悬停 tab 期间存在，所以这个窗口足够覆盖它；
		 * 指针离开 tab 立刻撤销，其它 tooltip 完全不受影响。
		 *
		 * 作用域解析走 closest，不依赖 class hash；`data-conversation-tabs`
		 * 是官方在 ConversationSession.tsx:198 打的稳定钩子。
		 * 开关：`html[data-polish-tab-tip="show"]` 恢复官方气泡
		 *（反语义：默认即抑制）。
		 * ================================================================ */
		const tabTip = (function () {
			const ATTR = "data-polish-tip-off";
			const HOST = "[data-conversation-tabs]";
			let on = false;
			let started = false;

			function root() {
				return document.documentElement;
			}

			/** 事件目标是否落在会话 tab 条里的 tab 按钮上。 */
			function hitsTab(event) {
				const target = event && event.target;
				if (!target || typeof target.closest !== "function") return false;
				const strip = target.closest(HOST);
				if (strip === null) return false;
				const tab = target.closest("[role='tab']");
				return tab !== null && strip.contains(tab);
			}

			function set(active) {
				if (active === on) return;
				on = active;
				try {
					if (active) root().setAttribute(ATTR, "");
					else root().removeAttribute(ATTR);
				} catch { /* fail soft */ }
			}

			function onOver(event) {
				try { set(hitsTab(event)); } catch { /* fail soft */ }
			}

			function onOut(event) {
				try {
					/* 离开 tab 才撤销；在 tab 之间移动（relatedTarget 仍是 tab）
					 * 保持标记，否则气泡会在显示窗口里漏出来。 */
					if (!hitsTab(event)) set(false);
					else set(hitsTab({ target: event.relatedTarget }));
				} catch { /* fail soft */ }
			}

			function clear() { set(false); }

			function start() {
				if (started) return;
				started = true;
				document.addEventListener("pointerover", onOver, true);
				document.addEventListener("pointerout", onOut, true);
				document.addEventListener("pointerdown", onOver, true);
				window.addEventListener("blur", clear);
				document.addEventListener("visibilitychange", clear);
			}

			return { start };
		})();

		/* ================================================================
		 * Motion scale — 把全 app 的过渡时长收进三档。
		 *
		 * 为什么需要：官方 + 十几个第三方插件各写各的时长（.1s / .12s /
		 * .15s / .16s / .18s / .2s / .3s 混在一起）与各写各的曲线。单看每
		 * 一处都说得过去，合在一起就是「哪都对、整体不对劲」—— 相邻两个
		 * 元素一个 120ms、一个 180ms，眼睛读到的是不同步。
		 *
		 * 做法：扫样式表（含运行时新插入的），把 40–340ms 区间内的
		 * `transition-duration` 吸附到 100 / 160 / 200ms 三档，并把 `ease`
		 * 与 `ease-in-out` 这两个「没个性」的关键字统一成同一条 ease-out
		 * 曲线。只动 transition，**不碰 animation**（spinner / shimmer 的
		 * 节奏是状态语义，不是过渡）；linear / steps / 显式 cubic-bezier
		 * 一律保留原样。改写走 CSSOM 替换原声明（不新增 !important 规则），
		 * 因此层叠关系完全不变。
		 *
		 * 时机：插件在最早期装载，而外壳的 <link> 样式表与各 React 组件的
		 * CSS 模块会在之后陆续到位 —— 所以除了首次全量扫描，还在 load 之后
		 * 与 0.3 / 1.2 / 3s 各补扫一次，并对新增 <style>/<link> 即时补扫。
		 * 已处理过的表用「规则条数」做指纹跳过，重复扫描几乎零成本。
		 *
		 * 幂等：已经是 var(--ds-transition-duration*) 的规则直接跳过。
		 * 开关：`html[data-polish-motion="native"]` 时完全不介入。
		 * ================================================================ */
		const motionScale = (function () {
			/* 上界 → 吸附值。40ms 以下（含 0s）视为「瞬时」，不动；
			 * 340ms 以上视为有意为之的长动画，也不动。 */
			const BANDS = [[120, "100ms"], [220, "160ms"], [340, "200ms"]];
			const CURVE = "cubic-bezier(.32,.72,0,1)";
			const CATCH_UP_MS = [300, 1200, 3000];
			const seen = new WeakMap();   /* sheet → 上次处理时的规则条数 */
			let timer = 0;

			function snapOne(token) {
				const match = /^\s*([\d.]+)(ms|s)\s*$/.exec(token);
				if (match === null) return null;
				const ms = match[2] === "s" ? parseFloat(match[1]) * 1000 : parseFloat(match[1]);
				if (!isFinite(ms) || ms < 40 || ms > 340) return null;
				for (const band of BANDS) if (ms <= band[0]) return band[1];
				return null;
			}

			function snapList(value) {
				let touched = false;
				const out = value.split(",").map(function (part) {
					const snapped = snapOne(part);
					if (snapped === null) return part.trim();
					touched = true;
					return snapped;
				});
				return touched ? out.join(", ") : null;
			}

			function curveOf(value) {
				let touched = false;
				const out = value.split(",").map(function (part) {
					const key = part.trim();
					if (key === "ease" || key === "ease-in-out") { touched = true; return CURVE; }
					return key;
				});
				return touched ? out.join(", ") : null;
			}

			/* 替换规则里的原声明（保持原有的 !important 优先级），不额外引入
			 * important —— 否则会盖掉更具体的选择器。 */
			function rewrite(style, property, next) {
				style.setProperty(property, next, style.getPropertyPriority(property));
			}

			function sweepStyle(style) {
				if (!style) return;
				try {
					const duration = style.getPropertyValue("transition-duration");
					if (duration && duration.indexOf("var(") === -1) {
						const next = snapList(duration);
						if (next !== null && next !== duration) rewrite(style, "transition-duration", next);
					}
					const timing = style.getPropertyValue("transition-timing-function");
					if (timing && timing.indexOf("var(") === -1) {
						const next = curveOf(timing);
						if (next !== null && next !== timing) rewrite(style, "transition-timing-function", next);
					}
				} catch (err) { /* 只读规则或异常声明：跳过这一条，不中断整轮 */ }
			}

			function sweepRules(rules) {
				for (const rule of rules) {
					if (rule.cssRules && rule.cssRules.length) sweepRules(rule.cssRules);
					sweepStyle(rule.style);
				}
			}

			function enabled() {
				return document.documentElement.dataset.polishMotion !== "native";
			}

			function sweep() {
				timer = 0;
				if (!enabled()) return;
				for (const sheet of document.styleSheets) {
					let rules = null;
					try { rules = sheet.cssRules; } catch (err) { continue; }
					if (!rules) continue;
					/* 规则条数没变 = 这张表上次已经处理过，跳过 */
					if (seen.get(sheet) === rules.length) continue;
					seen.set(sheet, rules.length);
					sweepRules(rules);
				}
			}

			function schedule(delay) {
				if (timer !== 0) return;
				timer = setTimeout(sweep, delay);
			}

			function start() {
				try { sweep(); } catch (err) { /* fail soft */ }
				for (const delay of CATCH_UP_MS) schedule(delay);
				window.addEventListener("load", function () { schedule(0); }, { once: true });
				if (typeof MutationObserver === "undefined") return;
				const mo = new MutationObserver(function (records) {
					for (const record of records) {
						for (const node of record.addedNodes) {
							if (node.nodeType === 1 && (node.tagName === "STYLE" || node.tagName === "LINK")) {
								schedule(120);
								return;
							}
						}
					}
				});
				mo.observe(document.documentElement, { childList: true, subtree: true });
			}

			return { start };
		})();

		/* ================================================================
		 * 图片灯箱增强 —— polishImageZoom
		 *
		 * 官方点开聊天里的图片，只有四张样式表在管（`._backdrop_*` 全屏容器 /
		 * `._mask_*` 遮罩 / `._image_*` 居中大图 / `._close_*` 右上关闭）：
		 * 没有缩放、没有旋转、也拖不动。这一段不碰官方代码，补上：
		 *
		 *   滚轮    滚动平移（Shift+滚轮转横向）—— 只挪位置、不改缩放，对齐 QQ 看图
		 *   拖拽    按住图片平移；双击在 1× / 2× 之间切换
		 *   工具栏  底部居中：缩小 / 放大 / 百分比 / 左转 90° / 右转 90° / 复位
		 *           （40px 按钮 + 20px 内联 SVG 图标）
		 *   键盘    `+` `-` 缩放、方向键平移、`0` 复位、`R` 旋转（Esc 关闭仍走官方）
		 *
		 * 识别不赌 hash 类名（`_1hos8_` 会随版本变）：先看父容器类名里的
		 * `backdrop` 词根，再用计算样式兜底（position:fixed 且铺满视口宽）。
		 * 状态挂在元素自身的 `__polishLb` 上 —— 灯箱被 React 卸载时一起消失，
		 * 不需要任何清理钩子。
		 * ================================================================ */
		const imageZoom = (function () {
			const MIN = 0.2;
			const MAX = 8;
			const IMG_SEL = "[data-polish-lb]";
			const BAR_SEL = "[data-polish-lb-bar]";
			const DRAG_ATTR = "data-polish-lb-drag";

			function clamp(v) { return v < MIN ? MIN : (v > MAX ? MAX : v); }

			/** 这个 img 是不是躺在官方灯箱容器里。
			 * 上游 e127ed2d6c（10-05）在 backdrop 与 img 之间加了一层 div.stage
			 *（Windows 标题栏避让），只查直接父级会恒返回 null 导致整个增强罢工；
			 * 改为向上走 4 层找结构锚。
			 *
			 * 旧版还带两条兜底判据（/backdrop/i 词根 + position:fixed 且铺满视口宽），
			 * 2026-10-23 已删：官方 Modal 根、第三方 lc-modal-backdrop、codex 的
			 * .dcsiv-root（fixed inset:0）全都满足它们，会把灯箱工具栏挂到任何
			 * 全屏弹窗里（tests/imagezoom-hostprobe.py 实测 1 个变 4 个）。
			 * 现在只认两条精确锚：
			 *   结构锚 —— img 的父级（stage）直接子中同时有 _mask 元素与 _close
			 *     按钮（官方灯箱三件套同层，ImageLightbox.tsx:57-61），宿主 =
			 *     stage 的父级（backdrop）；
			 *   类名锚 —— 某层自身类名形如 <hash>_backdrop（官方 CSS Modules
			 *     契约 pattern:'[hash]_[local]'，见 tsdown.client.ts:595；hash ≥4
			 *     位，第三方 lc-modal-backdrop 的连字符不会撞），宿主 = 该层。
			 * 两锚都不依赖 position:fixed —— 弹窗容器是否 fixed 不再参与判定。 */
			function hostOf(img) {
				let box = img.parentElement;
				for (let i = 0; i < 4 && box !== null; i++) {
					if (lightboxStageOf(box)) return box.parentElement;
					const cls = typeof box.className === "string" ? box.className : "";
					if (/[0-9a-zA-Z]{4,}_backdrop/.test(cls)) return box;
					box = box.parentElement;
				}
				return null;
			}

			/** stage 三件套：同一父级下既有遮罩（_mask）又有关闭按钮（_close）。 */
			function lightboxStageOf(stage) {
				let mask = false, close = false;
				for (const kid of stage.children) {
					const cls = typeof kid.className === "string" ? kid.className : "";
					if (!mask && /_[a-zA-Z]*mask/.test(cls)) mask = true;
					if (!close && kid.tagName === "BUTTON" && /_[a-zA-Z]*close/.test(cls)) close = true;
					if (mask && close) return true;
				}
				return false;
			}

			function state(img) {
				if (img.__polishLb === undefined) {
					img.__polishLb = { scale: 1, rot: 0, x: 0, y: 0, drag: null, moved: false };
				}
				return img.__polishLb;
			}

			function paint(img) {
				const st = state(img);
				img.style.setProperty("--polish-lb-scale", String(st.scale));
				img.style.setProperty("--polish-lb-rot", st.rot + "deg");
				img.style.setProperty("--polish-lb-x", st.x + "px");
				img.style.setProperty("--polish-lb-y", st.y + "px");
				const bar = img.__polishLbBar;
				if (bar !== undefined && bar.isConnected) {
					const value = bar.querySelector("[data-polish-lb-value]");
					if (value !== null) value.textContent = Math.round(st.scale * 100) + "%";
				}
			}

			function reset(img) {
				const st = state(img);
				st.scale = 1; st.rot = 0; st.x = 0; st.y = 0;
				paint(img);
			}

			/* 工具栏图标：内联 SVG（不引官方图标包，保持零依赖）。
			 * 20px 视觉尺寸由 CSS 给（[data-polish-lb-bar] svg）。 */
			const ICONS = {
				out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 12h12"/></svg>',
				in: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 12h12M12 6v12"/></svg>',
				left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H5v4"/><path d="M5.6 8.4A7.5 7.5 0 1 1 4.6 14"/></svg>',
				right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h4v4"/><path d="M18.4 8.4A7.5 7.5 0 1 0 19.4 14"/></svg>',
				reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M4 15v5h5M20 15v5h-5M20 9V4h-5"/></svg>'
			};

			/** 平移不出界：放大后只允许露出多余的余量，比视口小的方向一律居中 ——
			 *  免得图被拖到看不见的地方。尺寸用 `offsetWidth/Height`（不受 transform
			 *  影响），旋转 90°/270° 时把宽高对调。 */
			function clampPan(img, st) {
				const quarter = Math.abs(Math.round(st.rot / 90)) % 2 === 1;
				const baseW = img.offsetWidth || 0;
				const baseH = img.offsetHeight || 0;
				const w = (quarter ? baseH : baseW) * st.scale;
				const h = (quarter ? baseW : baseH) * st.scale;
				const mx = Math.max(0, (w - window.innerWidth) / 2) + 24;
				const my = Math.max(0, (h - window.innerHeight) / 2) + 24;
				st.x = Math.max(-mx, Math.min(mx, st.x));
				st.y = Math.max(-my, Math.min(my, st.y));
			}

			/** 以屏幕点 (clientX, clientY) 为锚点缩放：锚点下的像素缩放前后留在原地。
			 *  `getBoundingClientRect()` 给的是变换后的盒子，其中心 = 视觉中心；
			 *  减去位移就是布局中心，锚点以它为原点换算。 */
			function zoomAt(img, clientX, clientY, factor) {
				const st = state(img);
				const next = clamp(st.scale * factor);
				if (next === st.scale) return;
				const rect = img.getBoundingClientRect();
				const cx = clientX - (rect.left + rect.width / 2 - st.x);
				const cy = clientY - (rect.top + rect.height / 2 - st.y);
				const k = next / st.scale;
				st.x = cx - k * (cx - st.x);
				st.y = cy - k * (cy - st.y);
				st.scale = next;
				clampPan(img, st);
				paint(img);
			}

			function rotate(img, delta) {
				const st = state(img);
				st.rot = (st.rot + delta) % 360;
				clampPan(img, st);
				paint(img);
			}

			function zoomCenter(img, factor) {
				zoomAt(img, window.innerWidth / 2, window.innerHeight / 2, factor);
			}

			function makeBar(img) {
				const bar = document.createElement("div");
				bar.setAttribute("data-polish-lb-bar", "");
				const add = function (act, title, icon) {
					const btn = document.createElement("button");
					btn.type = "button";
					btn.setAttribute("data-polish-lb-act", act);
					btn.title = title;
					btn.innerHTML = icon;
					bar.appendChild(btn);
				};
				add("out", "缩小（键盘 -）", ICONS.out);
				add("in", "放大（键盘 +）", ICONS.in);
				const value = document.createElement("span");
				value.setAttribute("data-polish-lb-value", "");
				value.textContent = "100%";
				bar.appendChild(value);
				add("left", "左转 90°（键盘 R）", ICONS.left);
				add("right", "右转 90°", ICONS.right);
				add("reset", "复位（键盘 0）", ICONS.reset);
				bar.__polishLbImg = img;
				img.__polishLbBar = bar;
				return bar;
			}

			function decorate(img) {
				if (img.getAttribute("data-polish-lb") !== null) return;
				const host = hostOf(img);
				if (host === null) return;
				img.setAttribute("data-polish-lb", "");
				/* 原生 <img> 默认可拖拽：不关掉的话按住一拖就变成浏览器原生 drag，
				 * pointermove 随即断掉 —— 这正是「放大后拖不动」的根因。 */
				img.draggable = false;
				host.setAttribute("data-polish-lb-host", "");
				host.appendChild(makeBar(img));
				paint(img);
			}

			function scan(root) {
				const scope = (root !== null && root !== undefined && typeof root.querySelectorAll === "function") ? root : document;
				for (const img of scope.querySelectorAll("img")) decorate(img);
				if (scope !== document && scope.tagName === "IMG") decorate(scope);
			}

			/** 滚轮 = **滚动平移**（对齐 QQ 看图：滚轮只挪位置，缩放只走按钮）。
			 *  Shift+滚轮把纵向分量转成横向，触摸板横向滑动走 deltaX。 */
			function onWheel(ev) {
				const img = ev.target !== null && typeof ev.target.closest === "function" ? ev.target.closest(IMG_SEL) : null;
				if (img === null) return;
				ev.preventDefault();
				ev.stopPropagation();
				const st = state(img);
				const dx = ev.shiftKey ? ev.deltaY : ev.deltaX;
				const dy = ev.shiftKey ? 0 : ev.deltaY;
				st.x -= dx;
				st.y -= dy;
				clampPan(img, st);
				paint(img);
			}

			function onPointerDown(ev) {
				const img = ev.target !== null && typeof ev.target.closest === "function" ? ev.target.closest(IMG_SEL) : null;
				if (img === null || ev.button !== 0) return;
				const st = state(img);
				st.drag = { cx: ev.clientX, cy: ev.clientY, ox: st.x, oy: st.y };
				st.moved = false;
				img.setAttribute(DRAG_ATTR, "");
			}

			function dragging() {
				return document.querySelector(IMG_SEL + "[" + DRAG_ATTR + "]");
			}

			function onPointerMove(ev) {
				const img = dragging();
				if (img === null) return;
				const st = state(img);
				if (st.drag === null) return;
				const dx = ev.clientX - st.drag.cx;
				const dy = ev.clientY - st.drag.cy;
				if (!st.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
				st.moved = true;
				st.x = st.drag.ox + dx;
				st.y = st.drag.oy + dy;
				paint(img);
			}

			function onPointerUp() {
				const img = dragging();
				if (img === null) return;
				state(img).drag = null;
				img.removeAttribute(DRAG_ATTR);
			}

			function onDblClick(ev) {
				const img = ev.target !== null && typeof ev.target.closest === "function" ? ev.target.closest(IMG_SEL) : null;
				if (img === null) return;
				ev.preventDefault();
				if (state(img).scale === 1) {
					state(img).scale = 2;
					paint(img);
				} else {
					reset(img);
				}
			}

			function onKeyDown(ev) {
				if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
				const img = document.querySelector(IMG_SEL);
				if (img === null) return;
				const key = ev.key;
				if (key === "+" || key === "=") { ev.preventDefault(); zoomCenter(img, 1.2); }
				else if (key === "-" || key === "_") { ev.preventDefault(); zoomCenter(img, 1 / 1.2); }
				else if (key === "0") { ev.preventDefault(); reset(img); }
				else if (key === "r" || key === "R") { ev.preventDefault(); rotate(img, ev.shiftKey ? -90 : 90); }
				else if (key.indexOf("Arrow") === 0) {
					ev.preventDefault();
					const st = state(img);
					const step = ev.shiftKey ? 120 : 40;
					if (key === "ArrowUp") st.y += step;
					else if (key === "ArrowDown") st.y -= step;
					else if (key === "ArrowLeft") st.x += step;
					else st.x -= step;
					clampPan(img, st);
					paint(img);
				}
			}

			function onBarClick(ev) {
				const target = ev.target;
				const btn = target !== null && typeof target.closest === "function"
					? target.closest(BAR_SEL + " [data-polish-lb-act]") : null;
				if (btn === null) return;
				const bar = btn.closest(BAR_SEL);
				const img = bar !== null ? bar.__polishLbImg : null;
				if (img === undefined || img === null || !img.isConnected) return;
				ev.preventDefault();
				ev.stopPropagation();
				const act = btn.getAttribute("data-polish-lb-act");
				if (act === "in") zoomCenter(img, 1.2);
				else if (act === "out") zoomCenter(img, 1 / 1.2);
				else if (act === "left") rotate(img, -90);
				else if (act === "right") rotate(img, 90);
				else if (act === "reset") reset(img);
			}

			function start() {
				window.addEventListener("wheel", onWheel, { capture: true, passive: false });
				document.addEventListener("pointerdown", onPointerDown, true);
				document.addEventListener("pointermove", onPointerMove, true);
				document.addEventListener("pointerup", onPointerUp, true);
				document.addEventListener("pointercancel", onPointerUp, true);
				document.addEventListener("dblclick", onDblClick, true);
				document.addEventListener("keydown", onKeyDown, true);
				document.addEventListener("click", onBarClick, true);
				scan(document);
				if (typeof MutationObserver === "undefined") return;
				const mo = new MutationObserver(function (records) {
					for (const record of records) {
						for (const node of record.addedNodes) {
							if (node === null || node.nodeType !== 1) continue;
							if (node.tagName === "IMG") decorate(node);
							else scan(node);
						}
					}
				});
				mo.observe(document.body, { childList: true, subtree: true });
			}

			return { start };
		})();

		/* ================================================================
		 * Self-check surface — `__dshPolishStats()`。
		 *
		 * 优化如果没有可验证的抓手，就只是说法。这个只读接口把「这一层
		 * 到底改写了什么、页面现在的样式/动效规模有多大」摊开：
		 * CSS 规则总数、`:has()` / 后缀选择器还剩多少、已替换成类名的有
		 * 多少、DOM 节点数、三档动效 token 的实际取值、两个逃生开关状态。
		 * 纯读取，不做任何写入；失败静默。
		 * ================================================================ */
		function publishStats() {
			try {
				window.__dshPolishStats = function () {
					let rules = 0, hasSel = 0, suffixSel = 0, rewritten = 0;
					for (const sheet of document.styleSheets) {
						let list = null;
						try { list = sheet.cssRules; } catch (err) { continue; }
						const walk = (rs) => {
							for (const r of rs) {
								if (r.cssRules && r.cssRules.length) walk(r.cssRules);
								if (!r.selectorText) continue;
								rules++;
								const text = r.selectorText;
								if (/:has\(/.test(text)) hasSel++;
								if (/\[class[$*]=/.test(text)) suffixSel++;
								if (/polish-has-/.test(text)) rewritten++;
							}
						};
						if (list) walk(list);
					}
					const root = document.documentElement;
					const cs = getComputedStyle(root);
					return {
						cssRules: rules,
						styleSheets: document.styleSheets.length,
						hasSelectors: hasSel,
						suffixSelectors: suffixSel,
						rewrittenHas: rewritten,
						domNodes: document.querySelectorAll("*").length,
						motion: {
							fast: cs.getPropertyValue("--ds-transition-duration-fast").trim(),
							base: cs.getPropertyValue("--ds-transition-duration").trim(),
							slow: cs.getPropertyValue("--ds-transition-duration-slow").trim(),
							ease: cs.getPropertyValue("--ds-ease-in-out").trim()
						},
						switches: {
							motion: root.dataset.polishMotion || "on",
							has: root.dataset.polishHas || "on"
						},
						heapMB: typeof performance !== "undefined" && performance.memory
							? Math.round(performance.memory.usedJSHeapSize / 1048576) : null
					};
				};
			} catch (err) { /* fail soft */ }
		}

		/* ================================================================
		 * 右侧栏 tab 右键菜单：关闭其他 / 关闭左侧 / 关闭右侧 / 关闭全部
		 * ----------------------------------------------------------------
		 * 官方只给一个「关闭」（dock.closeTab），扩展点是
		 * `sidebar.right.tab.menu.item`（list / session 域，见
		 * ui-sidebar-right/src/client/contract/slots.ts:103，装配见
		 * shell/SidebarRight.tsx:332-333 renderTabMenuItems）。
		 * 本模块往该槽注册 4 个条目，批量关闭走
		 * sidebarRight.closeIn(sessionId, tabId) + tabsIn(sessionId)
		 *（见 ui-sidebar-right/src/client/service.ts:313/370），
		 * 同条顺序走 DOM（dockkit TabPanel.tsx:247/273：
		 * [data-dockkit-strip-tabs] > [data-dockkit-tab]），拿不到顺序时
		 * 左侧/右侧那两项自动隐藏，只留其他/全部（用 tabsIn，不依赖顺序）。
		 * 全部失败只让菜单保持官方原样，polish 其余功能不受影响。
		 * 开关：document.documentElement.dataset.polishTabMenu = "native" 关闭。
		 * ================================================================ */
		const tabMenu = (function () {
			const SLOT = "sidebar.right.tab.menu.item";
			const NS = "polish";
			const STYLE_ID = "dsh-polish-tabmenu-style";
			const STRINGS = {
				zh: {
					closeOthers: "关闭其他",
					closeLeft: "关闭左侧",
					closeRight: "关闭右侧",
					closeAll: "关闭全部",
				},
				en: {
					closeOthers: "Close others",
					closeLeft: "Close tabs to the left",
					closeRight: "Close tabs to the right",
					closeAll: "Close all",
				},
			};
			let mounted = false;

			function ensureStyle() {
				if (document.getElementById(STYLE_ID)) return;
				const el = document.createElement("style");
				el.id = STYLE_ID;
				// 照 dockkit TabMenu 的 .menuItem 复刻（dockkit.module.css:561-575），
				// 类名锚自己的前缀，不碰官方选择器。
				el.textContent = [
					`.polish-tabmenu-item{display:flex;align-items:center;width:100%;padding:4px 7px;color:var(--dsw-alias-label-primary);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);text-align:left;background:transparent;border:none;border-radius:var(--dsw-radius-md);cursor:pointer;box-sizing:border-box}`,
					`.polish-tabmenu-item:hover{background:var(--dsw-alias-interactive-bg-hover)}`,
					// 官方菜单项结构：button[role=menuitem] > span(图标列) + span(文字) + span(快捷键)。
					// 官方只给「关闭」配了图标，「关闭其他标签页 / 关闭右侧」都是空的，视觉上只有
					// 第一行长图标。这里把整列隐藏，让整个菜单回到纯文字（0.2.1 的观感）。
					// 用 [data-polish-tabmenu] 标记把作用域限定在 tab 菜单，不影响会话/文件菜单。
					`[data-context-menu]:has([data-polish-tabmenu]) button[role="menuitem"]>span:first-child{display:none!important}`,
				].join("\n");
				document.head.appendChild(el);
			}

			function escId(id) {
				try {
					if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(String(id));
				} catch { /* 回落到手工转义 */ }
				return String(id).replace(/["\\]/g, "\\$&");
			}

			/** 同一条 tab strip 内的有序 id；浮动面板/找不到时返回 null。 */
			function stripOrder(tabId) {
				try {
					const chip = document.querySelector('[data-dockkit-tab="' + escId(tabId) + '"]');
					if (!chip || typeof chip.closest !== "function") return null;
					const strip = chip.closest("[data-dockkit-strip-tabs]");
					if (!strip || typeof strip.querySelectorAll !== "function") return null;
					const ids = Array.prototype.map.call(
						strip.querySelectorAll("[data-dockkit-tab]"),
						(el) => el.getAttribute("data-dockkit-tab"),
					).filter((v) => typeof v === "string" && v.length > 0);
					const index = ids.indexOf(String(tabId));
					if (index < 0) return null;
					return { ids, index };
				} catch { return null; }
			}

			function allIds(sidebarRight, sessionId) {
				try {
					if (sidebarRight && typeof sidebarRight.tabsIn === "function") {
						const tabs = sidebarRight.tabsIn(sessionId);
						if (Array.isArray(tabs)) {
							const ids = tabs.map((t) => t && t.id).filter((v) => typeof v === "string" && v.length > 0);
							if (ids.length > 0) return ids;
						}
					}
				} catch { /* 回落到 DOM */ }
				try {
					return Array.prototype.map.call(
						document.querySelectorAll("[data-dockkit-tab]"),
						(el) => el.getAttribute("data-dockkit-tab"),
					).filter((v) => typeof v === "string" && v.length > 0);
				} catch { return []; }
			}

			function closeIds(sidebarRight, sessionId, ids) {
				if (!sidebarRight) return;
				const closeIn = typeof sidebarRight.closeIn === "function" ? sidebarRight.closeIn.bind(sidebarRight) : null;
				const closeOne = typeof sidebarRight.close === "function" ? sidebarRight.close.bind(sidebarRight) : null;
				for (const id of ids) {
					try {
						if (closeIn) closeIn(sessionId, id);
						else if (closeOne) closeOne(id);
					} catch (err) {
						try { console.warn("[dsh-plugin-polish] tabmenu close failed for", id, err); } catch { /* 取证失败不影响其余 */ }
					}
				}
			}

			function makeItem(menuKey, sidebarRight, t) {
				return function TabMenuItem(props) {
					let React;
					try { React = require("react"); } catch { return null; }
					const h = React.createElement;
					const tab = props && props.tab;
					const dismiss = props && props.dismiss;
					const sessionId = props && props.sessionId;
					const tabId = tab && tab.id;
					if (typeof tabId !== "string" || tabId.length === 0) return null;
					if (typeof sessionId !== "string" || sessionId.length === 0) return null;
					if (typeof dismiss !== "function") return null;

					let targetIds = null;
					let visible = true;
					try {
						if (menuKey === "closeOthers" || menuKey === "closeAll") {
							const ids = allIds(sidebarRight, sessionId);
							if (menuKey === "closeOthers") {
								if (ids.length <= 1) visible = false;
								else targetIds = ids.filter((id) => id !== tabId);
							} else {
								if (ids.length === 0) visible = false;
								else targetIds = ids.slice();
							}
							if (targetIds !== null && targetIds.length === 0) visible = false;
						} else {
							const order = stripOrder(tabId);
							if (!order) visible = false;
							else if (menuKey === "closeLeft") {
								if (order.index <= 0) visible = false;
								else targetIds = order.ids.slice(0, order.index);
							} else {
								if (order.index >= order.ids.length - 1) visible = false;
								else targetIds = order.ids.slice(order.index + 1);
							}
						}
					} catch { visible = false; }
					if (!visible || !targetIds || targetIds.length === 0) return null;

					return h("button", {
						type: "button",
						role: "menuitem",
						className: "polish-tabmenu-item",
						onClick: (e) => {
							try { if (e && typeof e.stopPropagation === "function") e.stopPropagation(); } catch { /* 菜单内点击冒泡到 chip 会误开拖拽，尽量拦 */ }
							try { dismiss(); } catch { /* 先关菜单，再批量关，顺序不能反 */ }
							closeIds(sidebarRight, sessionId, targetIds);
						},
					}, t(menuKey));
				};
			}

			function mount(ctx) {
				if (mounted) return;
				if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function") return;
				let t = (k) => (STRINGS.zh && STRINGS.zh[k]) || k;
				try {
					if (ctx.locale && typeof ctx.locale.register === "function") {
						ctx.locale.register(NS, "zh", STRINGS.zh);
						ctx.locale.register(NS, "en", STRINGS.en);
					}
					if (typeof ctx.locale.bind === "function") {
						const bound = ctx.locale.bind(NS);
						t = (k) => { try { return bound(k); } catch { return STRINGS.zh[k] || k; } };
					}
				} catch { /* 语言包失败就用内置中文，不影响菜单 */ }
				let sidebarRight = null;
				try { sidebarRight = ctx.sidebarRight || null; } catch { sidebarRight = null; }
				if (!sidebarRight) return;
				ensureStyle();
				// 0.2.2：官方把右键菜单改成 contextMenus 数据贡献，自带「关闭 / 关闭其他标签页 /
				// 关闭右侧」；老槽位 sidebar.right.tab.menu.item 仍会渲染，但样式与分组跟官方不一致，
				// 且「关闭其他」「关闭右侧」会跟官方重复。所以优先走新 API，只补官方没有的
				// 「关闭左侧 / 关闭全部」；拿不到 contextMenus 时退回老槽位，也只注册这两项。
				const contextMenusService = (() => {
					try { return typeof ctx.get === "function" ? ctx.get("contextMenus") : null; } catch { return null; }
				})();
				if (contextMenusService !== null && typeof contextMenusService.register === "function" && typeof ctx.effect === "function") {
					try {
						// 隐藏标记：legacy slot 只在右侧栏 tab 菜单里渲染，用它给上面的 CSS 提供作用域。
				// 不参与键盘导航（无 role、hidden），也不占位。
				try {
					const React = require("react");
					const TabMenuMarker = () => React.createElement("span", { "data-polish-tabmenu": "", hidden: true });
					ctx.slots.inject(SLOT, () => ctx.slots.register(
						{ name: SLOT, id: "polish-tabmenu-marker", order: -1, label: () => "" },
						TabMenuMarker,
					));
				} catch { /* 标记挂了只是图标列藏不掉，菜单本身不受影响 */ }
				ctx.effect(() => contextMenusService.register({
							id: "polish.tab-close-extras",
							target: "tab",
							order: 200,
							resolve: ({ sessionId, tab }) => {
								const tabId = tab && tab.id;
								if (typeof tabId !== "string" || tabId.length === 0) return [];
								const items = [];
								try {
									const order = stripOrder(tabId);
									if (order && order.index > 0) {
										items.push({
											id: "polish-close-left",
											label: t("closeLeft"),
											run: () => closeIds(sidebarRight, sessionId, order.ids.slice(0, order.index)),
										});
									}
								} catch { /* 顺序拿不到就不出「左侧」 */ }
								try {
									const ids = allIds(sidebarRight, sessionId);
									if (ids.length > 1) {
										items.push({
											id: "polish-close-all",
											label: t("closeAll"),
											run: () => closeIds(sidebarRight, sessionId, ids.slice()),
										});
									}
								} catch { /* 拿不到清单就不出「全部」 */ }
								return items;
							},
						}), "polish: tab menu extras");
						mounted = true;
						return;
					} catch (err) {
						try { console.warn("[dsh-plugin-polish] tabmenu new-API mount failed, falling back", err); } catch { /* fail soft */ }
					}
				}
				// 老宿主/拿不到服务时的兜底：只补官方没有的两项，避免与官方重复。
				const defs = [
					{ id: "polish-close-left", order: 20, key: "closeLeft" },
					{ id: "polish-close-all", order: 40, key: "closeAll" },
				];
			}

			return { mount };
		})();

		/* ================================================================
		 * 会话健康：侧栏失败红点 + 原生完成/失败通知（0.9 段）
		 * ----------------------------------------------------------------
		 * 宿主半监听 session/event 维护每会话最后一次 turn/end 结果，经
		 * GET /plugins/dsh-plugin-polish/session-activity 暴露（loopback）。
		 * 本模块 4s 轮询：
		 *   · 失败表 → sidebar.session.row.leading 红点。该槽位只在行主状态
		 *     idle 时被官方渲染 —— 恰好是「跑完但失败」的形态；会话跑起来
		 *     红点自动让位官方 spinner，新一轮 turn/start 由宿主清掉失败。
		 *   · 增量 completed/failed 事件 → 一律发系统通知（前台也弹，
		 *     2026-10-26 用户决策；Notification.permission granted 才直接发，
		 *     default 只请求一次；tag 按会话去重，同会话覆盖不堆积）。
		 *     点通知 = 跳到那条会话（openSession → 点侧栏行 → focus 三级兜底，
		 *     见 jumpToSession）。首次拉取只对齐游标不补发历史。
		 * 通知标题：宿主记录的 session/title 优先，DOM 行标题兜底。
		 * 开关：polishFailMark / polishNotify = "native" 分别关闭。
		 * ================================================================ */
		const sessionHealth = (function () {
			const ROUTE = "/plugins/dsh-plugin-polish/session-activity";
			const SLOT = "sidebar.session.row.leading";
			const NS = "polish";
			const STYLE_ID = "dsh-polish-failmark-style";
			const POLL_MS = 4000;
			const POLL_BACKOFF = 20000;
			/** 归档取回后还值得跳过去的时长；超过就当用户已经走开，只聚焦。 */
			const UNARCHIVE_JUMP_MS = 4000;
			const STRINGS = {
				zh: {
					failAria: "上次运行失败",
					failTitle: "运行失败",
					doneTitle: "已完成",
					doneBody: "本轮已完成。",
					defaultTitle: "会话",
				},
				en: {
					failAria: "Last run failed",
					failTitle: "failed",
					doneTitle: "finished",
					doneBody: "Turn finished.",
					defaultTitle: "Session",
				},
			};
			const failures = new Map(); // sessionId → { at, code, message, title? }
			const listeners = new Set();
			let hostCtx = null; // 带服务的宿主 ctx：点击通知要跳会话，必须能软取 uiWorkspace
			let lastSeq = -1;
			let pollTimer = null;
			let pollOn = false;
			let hostDown = 0;
			let notifyAsked = false;
			let markMounted = false;
			let lastPollAt = 0;

			function bump() {
				for (const fn of listeners) {
					try { fn(); } catch { /* 一个订阅者崩了不影响其余 */ }
				}
			}
			function subscribe(fn) {
				listeners.add(fn);
				return () => listeners.delete(fn);
			}

			/** 侧栏行的官方锚：`data-row-key="session:<id>"`（Rows.tsx 的会话行）。 */
			function rowSelector(sessionId) {
				const esc = (typeof window !== "undefined" && window.CSS && typeof window.CSS.escape === "function")
					? window.CSS.escape(String(sessionId))
					: String(sessionId).replace(/["\\]/g, "\\$&");
				return '[data-row-key="session:' + esc + '"]';
			}

			/** 通知标题兜底：宿主没记到标题时从侧栏行读（data-row-key 是官方锚）。 */
			function domTitle(sessionId) {
				try {
					const row = document.querySelector(rowSelector(sessionId));
					const text = row && row.children && row.children[1] ? row.children[1].textContent : "";
					const trimmed = String(text || "").trim();
					return trimmed;
				} catch { return ""; }
			}

			/**
			 * 点击通知 → 跳到那条通知对应的会话。
			 *
			 * 三条路按可靠性递减，任一命中即停：
			 *  ① `uiWorkspace.openSession(id)` —— 官方唯一的「选中会话 + 切主视图」
			 *     动作（ui-workspace/src/client/navigation.ts:293），侧栏行点击走的
			 *     也是它；服务用 `ctx.get` 软取，取不到（旧宿主 / 裸调 apply）就
			 *     往下走，不抛。归档会话先 `unarchiveSession` 再开，否则官方只会
			 *     提示「已归档不可打开」。
			 *  ② 点侧栏行本身（`[data-row-key="session:<id>"]`）—— 行的 onClick
			 *     就是 onOpen(node.id)，等价于用户手点；仅在该行已渲染时可用。
			 *  ③ `window.focus()` —— 至少把窗口提上来，比什么都没发生强。
			 *
			 * 一路都 fail soft：点击回调里抛异常会让通知变成哑弹，比只聚焦更差。
			 */
			function jumpToSession(sessionId) {
				const id = typeof sessionId === "string" ? sessionId : "";
				const focusWindow = () => {
					try { window.focus(); } catch { /* 聚焦受限就算了 */ }
				};
				if (id.length === 0) { focusWindow(); return; }
				const clickRow = () => {
					try {
						const row = document.querySelector(rowSelector(id));
						if (row && typeof row.click === "function") { row.click(); return true; }
					} catch { /* 选择器/CSS.escape 失效时放弃这条路 */ }
					return false;
				};
				let done = false;
				try {
					if (hostCtx && typeof hostCtx.get === "function") {
						const uiWorkspace = hostCtx.get("uiWorkspace");
						if (uiWorkspace && typeof uiWorkspace.openSession === "function") {
							const workspaces = hostCtx.get("workspaces");
							const archived = (() => {
								try {
									const list = workspaces && workspaces.list && workspaces.list.getSnapshot();
									return Boolean(list && Array.isArray(list.archivedSessionIds)
										&& list.archivedSessionIds.indexOf(id) >= 0);
								} catch { return false; }
							})();
							const open = () => {
								try { uiWorkspace.openSession(id); done = true; }
								catch { /* 会话已被删/切换被拦：落到 DOM 兜底 */ }
							};
							if (archived && typeof uiWorkspace.unarchiveSession === "function") {
								// 取回要等 Host 应答：窗口先提上来（用户的即时预期），
								// 落定后再切会话。等太久（日志很大）就只聚焦 —— 不能让
								// 界面在用户已经去做别的事之后突然自己跳走。
								focusWindow();
								const clickedAt = Date.now();
								try {
									Promise.resolve(uiWorkspace.unarchiveSession(id)).then(() => {
										if (Date.now() - clickedAt < UNARCHIVE_JUMP_MS) {
											open();
											if (!done) clickRow();
										}
									}).catch(() => {
										if (!done) clickRow();
									});
									return;
								} catch { /* 同步抛：继续走下面的即时路径 */ }
							}
							open();
						}
					}
				} catch { /* 服务取不到：不是致命，继续兜底 */ }
				if (!done) clickRow();
				focusWindow();
			}

			function notifyEvent(ev) {
				if (!SW.notify) return;
				if (!ev || (ev.kind !== "completed" && ev.kind !== "failed")) return;
				// 前台也弹（2026-10-26 用户决策）：不做焦点拦截。权限处理在下方
				// 独立 try/catch，与本决策无关；同会话 tag 覆盖，连弹不堆瀑布。
				const NC = typeof Notification !== "undefined"
					? Notification
					: (typeof window !== "undefined" ? window.Notification : null);
				if (!NC) return;
				const t = STRINGS.zh;
				const title = (ev.title && String(ev.title).trim()) || domTitle(ev.session) || t.defaultTitle;
				const isFail = ev.kind === "failed";
				const head = isFail ? (title + " · " + t.failTitle) : (title + " · " + t.doneTitle);
				const body = isFail
					? ((ev.code ? "[" + ev.code + "] " : "") + String(ev.message || "").slice(0, 160))
					: t.doneBody;
				const fire = () => {
					try {
						const n = new NC(head, { body, tag: "polish-session-" + String(ev.session || "") });
						try {
							n.onclick = () => {
								try { jumpToSession(ev.session); } catch { /* 哑弹比只聚焦更差 */ }
								try { n.close(); } catch { /* 已关 */ }
							};
						} catch { /* onclick 不可写就算了 */ }
					} catch { /* fail soft */ }
				};
				try {
					if (NC.permission === "granted") { fire(); return; }
					if (NC.permission === "default" && !notifyAsked) {
						notifyAsked = true;
						try {
							const asked = NC.requestPermission();
							if (asked && typeof asked.then === "function") {
								asked.then((r) => { if (r === "granted") fire(); }).catch(() => { /* 用户拒绝 */ });
							}
						} catch { /* 老回调式 API：放弃这一次 */ }
					}
				} catch { /* fail soft */ }
			}

			function pull(incremental) {
				const url = (incremental && lastSeq >= 0) ? ROUTE + "?since=" + lastSeq : ROUTE;
				return fetch(url, { headers: { accept: "application/json" } }).then((res) => {
					const ct = res.headers.get("content-type") || "";
					if (!res.ok || ct.indexOf("application/json") < 0) throw new Error("host half not mounted");
					return res.json();
				}).then((data) => {
					if (!data || data.ok !== true || !Array.isArray(data.failures)) throw new Error("bad payload");
					const next = new Map();
					for (const f of data.failures) {
						if (f && f.session) next.set(String(f.session), f);
					}
					let changed = next.size !== failures.size;
					if (!changed) {
						for (const [k, v] of next) {
							const old = failures.get(k);
							if (!old || old.at !== v.at) { changed = true; break; }
						}
					}
					failures.clear();
					for (const [k, v] of next) failures.set(k, v);
					if (changed) bump();
					const cursor = typeof data.cursor === "number" ? data.cursor : lastSeq;
					if (incremental && lastSeq >= 0 && Array.isArray(data.events)) {
						for (const ev of data.events) {
							if (ev && typeof ev.seq === "number" && ev.seq > lastSeq) notifyEvent(ev);
						}
					}
					lastSeq = cursor;
				});
			}

			function loop() {
				if (!pollOn) return;
				pollTimer = null;
				// 节流：部分测试 stub 的 setTimeout 是同步立即执行，没有这层
				// 判定 loop 会无限同步递归。真实定时器（≥4s 间隔）不受影响。
				const now = Date.now();
				if (lastPollAt !== 0 && now - lastPollAt < POLL_MS - 50) return;
				lastPollAt = now;
				pull(true).then(() => {
					hostDown = 0;
					if (pollOn) pollTimer = setTimeout(loop, POLL_MS);
				}).catch(() => {
					// 宿主半未挂载（未重启的旧进程）或瞬时失败：退避重试。
					hostDown += 1;
					if (pollOn) pollTimer = setTimeout(loop, hostDown > 3 ? POLL_BACKOFF : POLL_MS);
				});
			}

			function start() {
				if (pollOn) return;
				pollOn = true;
				// 首次只对齐游标与失败表，不补发历史通知。
				pull(false).catch(() => { /* loop 会重试 */ });
				pollTimer = setTimeout(loop, POLL_MS);
			}

			function ensureMarkStyle() {
				if (document.getElementById(STYLE_ID)) return;
				const el = document.createElement("style");
				el.id = STYLE_ID;
				// 官方 StateDot 实心态复刻：10px 槽位 + inset 20% 的 6px 核心点，
				// 颜色走官方 error token，官方深浅主题自动跟随。
				el.textContent = [
					`.polish-fail-mark{display:inline-block;flex:none;width:10px;height:10px;position:relative;box-sizing:border-box}`,
					`.polish-fail-mark::after{content:"";position:absolute;inset:20%;border-radius:50%;background:var(--dsw-alias-state-error-primary)}`,
				].join("\n");
				document.head.appendChild(el);
			}

			function makeMark(t) {
				return function PolishFailMark(props) {
					let React;
					try { React = require("react"); } catch { return null; }
					const sessionId = props && props.sessionId;
					const pair = React.useState(0);
					const setTick = pair[1];
					React.useEffect(() => subscribe(() => {
						try { setTick((v) => v + 1); } catch { /* fail soft */ }
					}), []);
					const record = typeof sessionId === "string" ? failures.get(sessionId) : null;
					if (!record) return null;
					const tip = ((t && t.failAria) || "上次运行失败") + (record.code ? " · " + record.code : "");
					return React.createElement("span", {
						className: "polish-fail-mark",
						"data-polish-fail-mark": "",
						title: tip,
						onClick: (e) => { try { e.stopPropagation(); } catch { /* 行点击照常 */ } },
					});
				};
			}

			function mount(ctx) {
				// 服务句柄先收下：通知点击要开会话，靠它 soft-get `uiWorkspace`。
				// 这一步与红点槽位无关，关掉红点也必须留。
				if (ctx && typeof ctx.get === "function" && hostCtx === null) hostCtx = ctx;
				if (markMounted) return;
				if (!SW.failMark) return;
				if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function") return;
				markMounted = true; // 槽位缺席也只试一次：注册失败不该每轮渲染都重打。
				ensureMarkStyle();
				let t = STRINGS.zh;
				try {
					if (ctx.locale && typeof ctx.locale.register === "function") {
						ctx.locale.register(NS, "zh", STRINGS.zh);
						ctx.locale.register(NS, "en", STRINGS.en);
					}
					if (typeof ctx.locale.bind === "function") {
						const bound = ctx.locale.bind(NS);
						t = (k) => { try { return bound(k); } catch { return STRINGS.zh[k] || k; } };
					}
				} catch { /* 语言包失败就用内置中文，不影响红点 */ }
				try {
					ctx.slots.inject(SLOT, () => ctx.slots.register(
						{
							name: SLOT,
							id: "polish-fail-mark",
							order: 9, // schedule 的时钟 mark 是 10：失败红点排它前面。
							label: () => { try { return t("failAria"); } catch { return "fail"; } },
						},
						makeMark(t),
					));
				} catch (err) {
					try { console.warn("[dsh-plugin-polish] failmark mount failed", err); } catch { /* fail soft */ }
				}
			}

			return { start, mount };
		})();

		function apply(ctx) {
			ensureStyles();
			publishStats();
			/* 每个模块按自己的开关启动：关掉的模块不注册任何监听器 / 观察器 /
			 * rAF 循环，因此不存在「关了还在跑」的残留。 */
			if (SW.surfaces || SW.dragzone) shellDecor.start();
			if (SW.drag) dragSort.start(ctx);
			/* DSH 0.2 按会话恢复阅读位置；旧的 600ms 强制贴底会与之争夺。 */
			if (SW.motion) motionScale.start();
			if (SW.imageZoom) imageZoom.start();
			/* tab hover 气泡抑制：默认开（反语义），polishTabTip="show" 时不注册。 */
			if (!SW.tabTip) tabTip.start();
			parentState.start();
			/* 右侧栏 tab 菜单扩展：有 ctx（宿主二次调用）且开关开着才挂载；
			 * 工厂内第一次裸调 apply() 时 ctx 为空，跳过即可。 */
			try { if (SW.tabMenu && ctx) tabMenu.mount(ctx); } catch { /* fail soft */ }
			/* 会话健康（失败红点 + 完成通知）：轮询/通知不依赖 ctx，裸调即可
			 * 启动（start 幂等）；红点槽位注册需要 ctx.slots，宿主二次调用时挂。 */
			try {
				if (SW.failMark || SW.notify) {
					sessionHealth.start();
					if (ctx) sessionHealth.mount(ctx);
				}
			} catch { /* fail soft */ }
			return module.exports;
		}

		/* 先把宿主可读的 apply/inject 落盘，再跑裸调副作用：
		 * 裸调中途抛了也不影响宿主侧带 ctx 的二次调用（之前写在 apply 末尾，
		 * 中途抛就导致整包无 exports，整层 polish 全灭）。 */
		module.exports.apply = apply;
		module.exports.inject = ["slots", "locale", "sidebarRight"];
		try { apply(); } catch { /* 工厂内裸调失败不影响宿主侧带 ctx 的二次调用 */ }
		return module.exports;
	}
});
