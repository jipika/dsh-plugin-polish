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
 *     design tokens: save-token strip + dashboard (.st-*), plugin console /
 *     automation panel (.pc-*). Hardcoded rgba colors the plugins ship are
 *     mapped to tokens so dark mode stops leaking.
 *     （infinite-gen-4 的 armor 药丸挂在输入框工具栏的
 *     `conversation.input.left`，样式与位置都由它自己管，polish 不参与。）
 *  3. Overlap fix: the save-token strip sits directly below the token
 *     meter row (`[data-composer-stats]`) with zero official gap — the
 *     slot anchors are display:contents siblings. We re-add rhythm.
 *  4. Header corner widgets pushed flush right.
 *  6. Steering drag-sort: press the leading icon of a queued steering
 *     bubble and drag to reorder the queue visually. Order persists
 *     across React re-renders via a MutationObserver re-apply. (The host
 *     has no reorder API, so this is display order only.)
 *  7. Motion system — one scale for the whole app:
 *     - the shell's own tokens (`--ds-transition-duration{,-fast,-slow}`,
 *       `--ds-ease-in-out`) are re-pointed to 100 / 160 / 200 ms and a
 *       single ease-out curve, so every rule that goes through a token
 *       moves in step;
 *     - `motionScale` snaps the *hardcoded* durations the rest of the
 *       ecosystem ships (.1s / .12s / .16s / .18s / .2s / .3s …) into the
 *       same three bands through CSSOM, and folds `ease` / `ease-in-out`
 *       onto that curve. Transitions only — animations keep their own
 *       cadence (spinners, shimmers, streaming);
 *     - entrance animations belong to surfaces that genuinely appear
 *       (`polishPop` for popovers). Persistent chrome never carries an
 *       `animation`, because a React remount would replay it on every
 *       navigation — that is the "why did the composer flinch" bug.
 *  8. Session switch: land ON the bottom instead of sliding to it
 *     (`sessionSwitch` — see the module comment for the two failure modes
 *     it removes), with reader gestures always able to take over.
 *  9. Transform/opacity first, with full prefers-reduced-motion /
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
		 *   polishSurfaces      save-token / plugin console / antd / header 等表面适配
		 *   polishArmor         armor 药丸悬浮跟随排队行
		 *   polishDrag          排队气泡与 QueueDock 行的拖拽排序
		 *   polishDragzone      macOS 顶部条 = 窗口拖拽区
		 *   polishSessionSwitch 切会话瞬时贴底（并把 smooth 滚动降级为 instant）
		 *   polishTimeLabel     会话行时间标签固定宽度 + 等宽数字
		 *   polishPerf          离屏渲染跳过与子树隔离
		 *   polishImageZoom     图片灯箱增强（滚轮缩放 / 拖拽平移 / 旋转 / 复位）
		 *
		 * 另有 polishHas（:has() 替换引擎，由 parentState.enabled() 自己读）。
		 * 默认全开：取值不等于 "native" 的任何值都视为开启。
		 * ================================================================ */
		const SW = (function () {
			const root = (typeof document !== "undefined") ? document.documentElement : null;
			const ds = (root && root.dataset) ? root.dataset : {};
			const on = (name) => ds["polish" + name] !== "native";
			return {
				motion: on("Motion"),
				scrollbar: on("Scrollbar"),
				surfaces: on("Surfaces"),
				armor: on("Armor"),
				drag: on("Drag"),
				dragzone: on("Dragzone"),
				sessionSwitch: on("SessionSwitch"),
				timeLabel: on("TimeLabel"),
				perf: on("Perf"),
				imageZoom: on("ImageZoom")
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
			+ "--polish-armor-lift:0px;"
			+ "--polish-armor-own:0px;"
			+ "}",
			] : []),

			...(SW.scrollbar ? [
			/* ---- 1. Scrollbars: hidden but scrollable ------------------ */
			"body{--dsh-scrollbar-width:0px!important}",
			"*{scrollbar-width:none!important}",
			"*::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}",
			] : []),

			...(SW.surfaces ? [
			/* ---- 1.5 会话正文里的图片：限宽，别横向溢出会话列 ------------- */
			// markdown 图片（<img class="_md…_image">）和附件图都没有宽度约束，原图比
			// 会话列宽时会横向盖住旁边的内容。只挑带 image 类名的 <img>，不动缩略图、
			// 图标和头像（它们各自有自己的尺寸规则）。
			// （排查期注：曾在此加过 _frame/_gallery 限宽与 mask token 覆盖，
			//  为排除变量已回滚；真正的"图片与正文重叠"根因在排查中，见会话记录。）
			"img[class*=image i]{max-width:100%}",
			] : []),

			/* ---- 2. Keyframes ------------------------------------------ */
			/* 只有「真正新出现」的浮层才配拥有进入动画；常驻组件一律不许挂
			 * animation —— React 每次重建都会让它从头播一遍，那正是
			 * 「切个会话，输入区上方抖一下」的来源。 */
			"@keyframes polishPop{from{opacity:0;transform:translateY(2px) scale(.995)}to{opacity:1;transform:none}}",
			"@keyframes polishFade{from{opacity:0}to{opacity:1}}",

			...(SW.surfaces ? [
			/* ---- 3. save-token strip: clearance + glass ----------------
			 * The strip and the meter row above it are display:contents
			 * slot siblings with no official gap; give the pill its own
			 * rhythm and a real material. */
			".st-strip{"
			+ "margin-top:8px!important;"
			+ "margin-bottom:4px!important;"
			+ "padding:4px 14px!important;"
			+ "line-height:18px!important;"
			+ "gap:14px!important;"
			+ "color:var(--dsw-alias-label-secondary)!important;"
			+ "background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,transparent) 72%,transparent)!important;"
			+ "backdrop-filter:blur(14px) saturate(160%)!important;"
			+ "-webkit-backdrop-filter:blur(14px) saturate(160%)!important;"
			+ "border:1px solid var(--dsw-alias-border-l1)!important;"
			+ "box-shadow:0 1px 6px rgba(0,0,0,.05)!important;"
			+ "transition:box-shadow var(--polish-dur-fast) var(--polish-ease-out),border-color var(--polish-dur-fast) var(--polish-ease-out)!important;"
			+ "}",
			".st-strip b{color:var(--dsw-alias-state-success-primary)!important;font-weight:600!important}",

			/* ---- 3b. save-token strip：窄宽度防换行 ------------------------
			 * 原生 .st-strip 是 flex-wrap:wrap + width:max-content —— composer
			 * dock 宽度不足时四段信息直接折行，撑破 999px 圆角药丸（错位）。
			 * 改为单行 nowrap + 逐 span 收缩省略：数值段（已节省）shrink 权重
			 * 最小最后截，品牌名与统计段先截，保证任何宽度下都是一条单行药丸。 */
			".st-strip{flex-wrap:nowrap!important;min-width:0!important;width:auto!important}",
			".st-strip>span{white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;min-width:0!important;flex:0 1 auto!important}",
			".st-strip>span:nth-child(2){flex-shrink:1!important}",
			".st-strip>span:first-child{flex-shrink:3!important}",
			".st-strip>span:nth-child(3),.st-strip>span:nth-child(4){flex-shrink:5!important}",

			/* ---- 4. save-token dashboard: token-aligned cards ---------- */
			".st-wrap{gap:12px!important}",
			".st-kpi,.st-card{"
			+ "border-radius:12px!important;"
			+ "border:1px solid var(--dsw-alias-border-l1)!important;"
			+ "background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,transparent) 82%,transparent)!important;"
			+ "transition:border-color var(--polish-dur-fast) var(--polish-ease-out),box-shadow var(--polish-dur-fast) var(--polish-ease-out)!important;"
			+ "}",
			".st-kpi:hover,.st-card:hover{border-color:var(--dsw-alias-border-l2)!important}",
			".st-btn{"
			+ "transition:background var(--polish-dur-fast) var(--polish-ease-out),border-color var(--polish-dur-fast) var(--polish-ease-out),transform var(--polish-dur-fast) var(--polish-ease-spring)!important;"
			+ "}",
			".st-btn:hover{background:var(--dsw-alias-interactive-bg-hover)!important}",
			".st-btn:active{transform:scale(.97)!important}",

			/* armor 药丸（无限四代）挂在输入框工具栏的 conversation.input.left，
			 * 样式与位置都由它自己管 —— polish 侧不对它做任何定位/材质干预。 */

			/* ---- 8. 排队消息面板（QueueDock）：底色回到主题 ----------------
			 * 官方 .wGg57a_panel::before = --dsw-specific-menu + 菜单毛玻璃。
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
			 * 平台判断用 preload 已经标好的 html[data-platform]。 */
			"html[data-platform='darwin'] [data-polish-dragzone]{-webkit-app-region:drag;-webkit-user-select:none;user-select:none}",
			"html[data-platform='darwin'] [data-polish-dragzone] "
			+ ":is(button,a,input,textarea,select,summary,label,[role],[tabindex],[contenteditable='true'],[data-slot])"
			+ "{-webkit-app-region:no-drag}",
			] : []),

			...(SW.surfaces ? [
			/* ---- 7. plugin console / automation panel: theme alignment --
			 * Map the hardcoded colors the plugin ships onto tokens and
			 * unify radii with the shell's 12px card language. */
			".pc_row,.pc_floatPanel,.pc_compCard,.pc_consentCard{border-radius:12px!important}",
			".pc_sourceMenu{border-radius:10px!important}",
			".pc_backTop,.pc_compToggle{"
			+ "background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,transparent) 78%,transparent)!important;"
			+ "backdrop-filter:blur(10px) saturate(150%)!important;"
			+ "color:var(--dsw-alias-label-secondary)!important;"
			+ "}",
			".pc_compDrop{"
			+ "background:var(--dsw-alias-bg-layer-1)!important;"
			+ "backdrop-filter:blur(16px) saturate(160%)!important;"
			+ "}",
			".pc_switchKnob{background:var(--dsw-alias-label-primary-foreground,#fff)!important}",
			".pc_modalBackdrop{background:color-mix(in srgb,var(--dsw-alias-bg-base,#000) 32%,transparent)!important;backdrop-filter:blur(3px)!important}",
			".pc_row{transition:border-color var(--polish-dur-fast) var(--polish-ease-out),box-shadow var(--polish-dur-fast) var(--polish-ease-out)!important}",
			".pc_row:hover{border-color:var(--dsw-alias-border-l3)!important}",
			".pc_modalCard,.pc_floatPanel,.pc_sourceMenu,.pc_compDrop{animation:polishPop var(--polish-dur-in) var(--polish-ease-out)!important}",
			/* Floating panels read as thicker material: stronger blur + deeper shadow */
			".pc_floatPanel,.pc_compCard{box-shadow:0 10px 32px rgba(0,0,0,.14)!important;backdrop-filter:blur(18px) saturate(160%)!important}",

			/* ---- 7b. automation panel (Ant Design): brand realignment ----
			 * @michengai/dsh-automation already tokenizes its own classes;
			 * what leaks are antd's runtime CSS-in-JS defaults (primary
			 * blue, focus rings, hover states). antd emits low-specificity
			 * `:where(.css-*).ant-*` rules, so `body .ant-*` + targeted
			 * !important wins without touching layout rules. */
			"body .ant-btn-primary{"
			+ "background:var(--dsw-alias-brand-primary)!important;"
			+ "border-color:var(--dsw-alias-brand-primary)!important;"
			+ "color:var(--dsw-alias-label-primary-foreground,#fff)!important;"
			+ "transition:background var(--polish-dur-fast) var(--polish-ease-out),box-shadow var(--polish-dur-fast) var(--polish-ease-out),transform var(--polish-dur-fast) var(--polish-ease-out)!important;"
			+ "}",
			"body .ant-btn-primary:not(:disabled):hover{"
			+ "background:color-mix(in srgb,var(--dsw-alias-brand-primary) 88%,#000)!important;"
			+ "border-color:transparent!important;"
			+ "}",
			"body .ant-btn-primary:not(:disabled):active{transform:scale(.97)!important}",
			"body .ant-btn-default{"
			+ "border-color:var(--dsw-alias-border-l2)!important;"
			+ "color:var(--dsw-alias-label-primary)!important;"
			+ "background:transparent!important;"
			+ "transition:border-color var(--polish-dur-fast) var(--polish-ease-out),background var(--polish-dur-fast) var(--polish-ease-out)!important;"
			+ "}",
			"body .ant-btn-default:not(:disabled):hover{"
			+ "border-color:var(--dsw-alias-border-l3)!important;"
			+ "background:var(--dsw-alias-interactive-bg-hover)!important;"
			+ "color:var(--dsw-alias-label-primary)!important;"
			+ "}",
			"body .ant-select-focused:not(.ant-select-disabled) .ant-select-selector,"
			+ "body .ant-input:focus,body .ant-input-focused,"
			+ "body .ant-input-textarea:focus-within,"
			+ "body .ant-input-affix-wrapper-focused{"
			+ "border-color:var(--dsw-alias-brand-primary)!important;"
			+ "box-shadow:none!important;"
			+ "}",
			"body .ant-tabs-tab:hover .ant-tabs-tab-btn{color:var(--dsw-alias-label-primary)!important}",
			"body .ant-tabs-tab.ant-tabs-tab-active .ant-tabs-tab-btn{color:var(--dsw-alias-label-primary)!important}",
			"body .ant-switch-checked{background:var(--dsw-alias-brand-primary)!important}",
			"body .ant-checkbox-checked .ant-checkbox-inner{background:var(--dsw-alias-brand-primary)!important;border-color:var(--dsw-alias-brand-primary)!important}",
			"body .ant-radio-checked .ant-radio-inner{border-color:var(--dsw-alias-brand-primary)!important}",
			"body .ant-radio-checked .ant-radio-inner:after{background:var(--dsw-alias-brand-primary)!important}",
			/* plugin's own chips/cards: kill the white-overlay hack, align radius */
			"body .dsh-st-chip{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,transparent) 80%,transparent)!important;border:1px solid var(--dsw-alias-border-l1)!important}",
			"body .dsh-st-card{border-radius:12px!important;transition:border-color var(--polish-dur-fast) var(--polish-ease-out),box-shadow var(--polish-dur-fast) var(--polish-ease-out)!important}",
			"body .dsh-st-card:hover{border-color:var(--dsw-alias-border-l3)!important}",

			/* ---- 8. session header rhythm (0.1.7 UI) --------------------
			 * Two real misalignments, both from the shell's own rules:
			 *  a) the header grid pads 20px left, but the tab row adds its
			 *     own padding-left:8px — the capsule lands at 28px while
			 *     the title above sits at 20px;
			 *  b) header padding is `10px 28px 0 20px` — zero breathing
			 *     room under the tab row against its bottom border.
			 * Stable hooks: the header's data-slot anchor + class-suffix
			 * selectors (hash prefixes change per build, suffixes don't). */
			'[data-slot="conversation.session.header"] [class$="_tabs"]{padding-left:0!important}',
			'[data-slot="conversation.session.header"] [class$="_header"]{padding-bottom:10px!important}',
			] : []),

			...(SW.drag ? [
			/* ---- 9. steering drag-sort affordances ---------------------- */
			"[data-pending-steering]{position:relative}",
			".polish-drag-handle{"
			+ "position:absolute;left:-20px;top:50%;transform:translateY(-50%);"
			+ "width:14px;height:26px;display:flex;align-items:center;justify-content:center;"
			+ "cursor:grab;color:var(--dsw-alias-label-tertiary);"
			+ "opacity:0;transition:opacity var(--polish-dur-fast) var(--polish-ease-out);"
			+ "font-size:13px;line-height:1;user-select:none;-webkit-user-select:none"
			+ "}",
			"[data-pending-steering]:hover .polish-drag-handle{opacity:1}",
			".polish-drag-handle:active{cursor:grabbing}",
			"[data-pending-steering][data-polish-dragging]{opacity:.85;z-index:5;transition:none!important}",
			"[data-pending-steering][data-polish-lifted]{transform:translateY(var(--polish-drag-delta,0px));transition:transform 160ms var(--polish-ease-out)}",
			"[data-pending-steering]{transition:transform 160ms var(--polish-ease-out)}",
			/* QueueDock（「N 条排队消息」面板）的行：把手是**行内最左侧**的
			 * 静态图标（用户要的「左边加一个 icon」），常显待命、悬停变实；
			 * 行外浮动的方案在这里会被 panel 的 overflow:hidden 裁掉。 */
			"[data-queue-dock] .polish-drag-handle{"
			+ "position:static;left:auto;top:auto;transform:none;"
			+ "width:14px;height:24px;flex:none;margin-right:-4px;"
			+ "opacity:.4;font-size:12px"
			+ "}",
			"[data-queue-dock] [class$='_row']:hover .polish-drag-handle{opacity:.9}",
			"[data-queue-dock] [class$='_row']{transition:transform 160ms var(--polish-ease-out)}",
			"[data-queue-dock] [class$='_row'][data-polish-dragging]{opacity:.85;z-index:5;transition:none!important}",
			"[data-queue-dock] [class$='_row'][data-polish-lifted]{transform:translateY(var(--polish-drag-delta,0px));transition:transform 160ms var(--polish-ease-out)}",
			] : []),

			...(SW.perf ? [
			/* ---- 9b. Render performance ------------------------------
			 * Skip offscreen work and fence expensive subtrees:
			 *  - long code blocks render only when scrolled near the
			 *    viewport (contain-intrinsic-size keeps the scrollbar
			 *    estimate stable);
			 *  - the composer card is fenced so typing reflows stay local;
			 *  - the conversation scroller stops scroll-chaining so wheel
			 *    energy isn't leaked to ancestor scrollers.
			 * Think rows are deliberately NOT touched (dsh-think-ux owns
			 * their measurement). */
			"[data-code-block-content]{"
			+ "content-visibility:auto;"
			+ "contain-intrinsic-size:auto 480px;"
			+ "}",
			/* contain:style ONLY — layout/paint containment turns a card into
			 * the containing block for any fixed-positioned popover rendered
			 * inside it (that is how the "reasoning level" panel flew to the
			 * top-left corner). style keeps the style-rec isolation with no
			 * geometry side effects. */
			"[data-composer-card]{contain:style}",
			"[data-conversation-scroll]{overscroll-behavior:contain}",
			] : []),
			/* ---- 9e. Switch stability -----------------------------------
			 * 切换会话时「抖一下」的两处收口：
			 *  ① 会话行的时间标签（「1分钟」→「刚刚」）宽度会变，把左邻挤得
			 *     动一下 —— 固定最小宽度 + 等宽数字；
			 *  ② 视口运动交给 JS（sessionSwitch）：切换窗口内瞬时贴底，
			 *     并把 smooth 滚动请求降级为 instant。
			 * 代码驱动的 scrollTo({behavior:"smooth"}) 不受 CSS 约束，但这一层
			 * 仍要设成 auto：scrollIntoView / 锚点跳转都按它走默认节奏。 */
			...(SW.timeLabel ? [
			"[class$='_sessionRow'] [class$='_time']{min-width:34px;text-align:right;font-variant-numeric:tabular-nums}",
			] : []),
			...(SW.sessionSwitch ? [
			"[data-conversation-scroll]{scroll-behavior:auto!important}",
			] : []),
			...(SW.perf ? [
			".st-kpi,.st-card,.pc_row,.dsh-st-card{contain:style}",
			] : []),

			/* ---- 9c. Micro-interactions (response on contact) --------
			 * Apple: feedback starts on pointer-down, not after release.
			 * Everything here is transform/background only. */
			"body .ant-btn:not(:disabled):active,"
			+ ".pc_backTop:active,"
			+ ".pc_compToggle:active,"
			+ ".st-btn:active{transform:scale(.96)!important}",
			".st-strip:hover{"
			+ "transform:translateY(-1px)!important;"
			+ "box-shadow:0 3px 12px rgba(0,0,0,.09)!important;"
			+ "border-color:var(--dsw-alias-border-l2)!important;"
			+ "transition:transform var(--polish-dur-fast) var(--polish-ease-out),box-shadow var(--polish-dur-fast) var(--polish-ease-out),border-color var(--polish-dur-fast) var(--polish-ease-out)!important;"
			+ "}",
			"::selection{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 22%,transparent)}",

			/* ---- 10. Reduced motion / transparency ---------------------- */
			"@media (prefers-reduced-motion:reduce){"
			+ ".pc_modalCard,.pc_floatPanel,.pc_sourceMenu,.pc_compDrop{animation:polishFade 120ms linear!important;transform:none!important;transition:none!important}"
			+ "[data-pending-steering]{transition:none!important}"
			+ "}",
			"@media (prefers-reduced-transparency:reduce){"
			+ ".st-strip,.pc_backTop,.pc_compToggle{background:var(--dsw-alias-bg-layer-2)!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}"
			+ ".pc_floatPanel,.pc_compCard{backdrop-filter:none!important}"
			+ "}",
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
		 * Measure loop — republish the surface colour and the drag zone
		 * whenever the shell changes: the MutationObserver watches the
		 * scroller plus a low-frequency body watcher for topology swaps
		 * (session switch, composer re-mount). Every DOM write is
		 * dirty-checked, so a pass that changes nothing writes nothing.
		 * ================================================================ */
		const lift = (function () {
			const GAP = 10;           /* clearance between last queued row and the pill */
			const MAX_LIFT = 400;     /* sanity clamp                                */
			const VIEWPORT_EDGE = 8;  /* the pill never rides above the viewport top */
			let basePad = null;       /* scroller's own padding-bottom (px)          */
			let raf = 0;
			let boundScroller = null;
			let lastLift = -1;
			let lastPad = -1;
			let lastOwn = -1;

			function scrollerFor() {
				return document.querySelector("[data-conversation-scroll]");
			}

			/* 排队行有两种形态，pill 要同时让开两种：
			 *  - `[data-pending-steering]`：已经进入对话流的排队插话气泡
			 *    （chat 包 UserStyleBubble 的 pending 分支，在滚动区内）；
			 *  - `[data-queue-dock]`：shell 挂在输入框上方的「N 条排队消息」
			 *    面板（conversation 包的 QueueDock）。队列为空时它整个不渲染，
			 *    所以它存在本身就等于「队列非空」——这正是不再依赖气泡属性的原因。
			 * 两种同时在屏时取视口位置更靠上的那个，pill 才会落在所有排队行之上。
			 * QueueDock 在 composer 区、不在 [data-conversation-scroll] 内，
			 * 因此这里从 document 查询。 */
			const ANCHORS = [
				["steering", "[data-pending-steering]"],
				["queueDock", "[data-queue-dock]"],
			];

			function topmostAnchor() {
				let best = null;
				for (const [kind, selector] of ANCHORS) {
					const el = document.querySelector(selector);
					if (el === null) continue;
					const rect = el.getBoundingClientRect();
					if (rect.height === 0 && rect.width === 0) continue;   /* 未布局/已折叠 */
					if (best === null || rect.top < best.rect.top) best = { kind, el, rect };
				}
				return best;
			}

			/* 读「实际生效」的 translateY（正值 = 已上浮多少像素）。
			 * 不能用 lastLift 代替：wrap 上挂着过渡，过渡进行中
			 * getBoundingClientRect() 返回的是中间帧；用目标值去撤销，会把已经
			 * 走过的位移重复减一次，误差又被下一次测量当成新位移累加，状态条便
			 * 一路上浮，直到候选消失才被 restore 拽回 —— 这正是「先向上、再往下
			 * 落」的来源。读计算样式里的 matrix，则任何一帧都精确。 */
			function actualLiftOf(el, fallback) {
				try {
					const t = getComputedStyle(el).transform;
					if (!t || t === "none") return 0;
					const m = new DOMMatrixReadOnly(t);
					if (typeof m.m42 === "number" && isFinite(m.m42)) return -m.m42;
				} catch (err) { /* 回退到记录值 */ }
				return fallback;
			}

			function setLift(px) {
				if (px === lastLift) return;
				lastLift = px;
				document.documentElement.style.setProperty("--polish-armor-lift", px + "px");
				if (px > 0) document.documentElement.setAttribute("data-polish-armor-float", "");
				else document.documentElement.removeAttribute("data-polish-armor-float");
			}

			function setPad(scroller, px) {
				if (px === lastPad) return;
				lastPad = px;
				scroller.style.paddingBottom = px + "px";
			}

			/* 上浮时让 wrap 不再占布局位（px = wrap.offsetHeight，0 = 恢复占位）。
			 * 只动一个 :root 变量，CSS 侧用负 margin-bottom 抵消，React 节点不搬。 */
			function setOwn(px) {
				if (px === lastOwn) return;
				lastOwn = px;
				document.documentElement.style.setProperty("--polish-armor-own", px + "px");
			}

			/* diag: throttled localStorage mirror for disk-side inspection */
			let lastDiagSig = "";
			let lastDiagAt = 0;
			function writeDiag(payload) {
				try {
					const sig = JSON.stringify(payload);
					const now = Date.now();
					if (sig === lastDiagSig && now - lastDiagAt < 30000) return;
					if (now - lastDiagAt < 2000) return;
					lastDiagSig = sig;
					lastDiagAt = now;
					window.localStorage.setItem("dsh-plugin-polish:diag", sig);
				} catch {}
			}

			function restore(scroller) {
				if (scroller && basePad !== null) setPad(scroller, basePad);
				basePad = null;
				boundScroller = null;
				setLift(0);
				setOwn(0);
			}

			function watch(scroller) {
				/* no per-scroller observer needed: the single body watcher
				 * already covers scroller swaps; measure() re-binds by
				 * identity check. Kept as a no-op hook for symmetry. */
			}

			function measure() {
				raf = 0;
				try {
					publishSurface();
					applyDragzone();
					/* armor 药丸（无限四代）挂在输入框工具栏的
					 * conversation.input.left，位置由那块 slot 自己决定；
					 * 这里只负责把历史上可能留在 :root 上的位移与留白清零。 */
					if (boundScroller) restore(boundScroller);
				} catch (err) {
					/* fail soft — polish must never break the shell */
				}
			}

			function schedule() {
				if (!raf) raf = requestAnimationFrame(measure);
			}

			function start() {
				if (typeof MutationObserver === "undefined") return;
				/* one low-frequency body watcher only for topology changes
				 * (session switch swaps the scroller / armor mount); the hot
				 * path is the scroller-scoped observer in watch() */
				const topo = new MutationObserver(schedule);
				topo.observe(document.body, { childList: true, subtree: true });
				window.addEventListener("resize", schedule, { passive: true });
				schedule();
			}

			return { start };
		})();

		/* ================================================================
		 * Steering drag-sort — press the leading icon of a queued steering
		 * bubble, drag to reorder. Display order only (no host API); the
		 * observer re-applies our order whenever React re-renders the list.
		 * ================================================================ */
		const dragSort = (function () {
			/* desired order as an array of bubble ids (data attr carries none,
			 * so we tag nodes with a polish id) */
			const TAG = "data-polish-sort-id";
			let nextId = 1;
			let order = [];            /* array of ids, desired display order */
			let dragging = null;       /* {node, startY, delta} */

			/* 可拖拽的排队项 = 两类，各有各的父容器：
			 *  - 对话流里的 pending 插话气泡（chat 包 UserStyleBubble）；
			 *  - composer 上方的「N 条排队消息」行（conversation 包 QueueDock
			 *    的 <li>，行内不带任何 data 标记，只能靠 [data-queue-dock] 定位）。
			 * 所以排序必须按 parent 分组做，不能假设同一个容器。 */
			function bubbles() {
				return [
					...document.querySelectorAll("[data-pending-steering]"),
					...document.querySelectorAll("[data-queue-dock] li"),
				].filter((n) => n.isConnected);
			}

			function idOf(node) {
				let id = node.getAttribute(TAG);
				if (!id) {
					id = String(nextId++);
					node.setAttribute(TAG, id);
				}
				return id;
			}

			/* Reconcile the recorded order with what's on screen. New nodes go
			 * to the end; gone nodes are dropped. Returns true if the DOM
			 * needs a re-apply. */
			function reconcile() {
				const list = bubbles();
				const present = new Set(list.map(idOf));
				order = order.filter((id) => present.has(id));
				for (const node of list) {
					const id = idOf(node);
					if (!order.includes(id)) order.push(id);
				}
				return list.length > 1;
			}

			function applyOrder() {
				/* 按父容器分组：对话流气泡与 QueueDock 行互不搬家 */
				const groups = new Map();
				for (const node of bubbles()) {
					const parent = node.parentNode;
					if (!parent) continue;
					const bucket = groups.get(parent);
					if (bucket) bucket.push(node);
					else groups.set(parent, [node]);
				}
				for (const [parent, list] of groups) {
					if (list.length < 2) continue;
					const byId = new Map(list.map((n) => [idOf(n), n]));
					let anchor = null;
					for (const id of order) {
						const node = byId.get(id);
						if (!node) continue;
						/* move node right after `anchor` (or to front when null) */
						parent.insertBefore(node, anchor ? anchor.nextSibling : parent.firstChild);
						anchor = node;
					}
				}
			}

			/* 同组（同一父容器）的其他可拖拽项：跨组不能互相让位 —— 对话流气泡
			 * 与 QueueDock 行各有各的容器。 */
			function sameGroupMates(node) {
				const parent = node.parentNode;
				if (!parent) return [];
				return bubbles().filter((n) => n !== node && n.parentNode === parent);
			}

			function attachHandlers(node, parent) {
				if (node.__polishDrag) return;
				node.__polishDrag = true;
				/* An explicit handle injected at the bubble's leading edge —
				 * no guessing which existing icon is "the leftmost one". */
				const handle = document.createElement("span");
				handle.className = "polish-drag-handle";
				handle.textContent = "⠿";
				handle.title = "按住拖动调整排队顺序（仅显示顺序，发送顺序仍由 host 决定）";
				/* QueueDock 的行：把手插在行内最左边（用户要的「左边加一个
				 * icon」）；对话流的插话气泡：浮在气泡左侧外（绝对定位）。 */
				if (node.closest("[data-queue-dock]")) node.insertBefore(handle, node.firstChild);
				else node.appendChild(handle);
				handle.addEventListener("pointerdown", function (ev) {
					if (ev.button !== 0) return;
					const rect = node.getBoundingClientRect();
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
					handle.style.cursor = "grabbing";
					try { handle.setPointerCapture(ev.pointerId); } catch (e) { /* ok */ }
					ev.preventDefault();
				});
				handle.addEventListener("pointermove", function (ev) {
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
				handle.addEventListener("pointerup", function () {
					if (!dragging || dragging.node !== node) return;
					endDrag(node, parent);
				});
				handle.addEventListener("pointercancel", function () {
					if (!dragging || dragging.node !== node) return;
					endDrag(node, parent);
				});
			}

			function endDrag(node, parent) {
				if (!dragging || dragging.node !== node) return;
				const handle = node.querySelector(".polish-drag-handle");
				if (handle) handle.style.cursor = "grab";
				node.removeAttribute("data-polish-dragging");
				node.removeAttribute("data-polish-lifted");
				/* read before clearing */
				const delta = parseFloat(node.style.getPropertyValue("--polish-drag-delta")) || 0;
				node.style.removeProperty("--polish-drag-delta");
				const myCenter = dragging.startCenter + delta;
				/* 落点用拖动期间那份「基准中心」算（与视觉让位同源），不再用实时
				 * rect —— 否则松手瞬间残留 transform 会让落点跳一下。 */
				const mates = dragging.mates ?? [];
				let dropIdx = order.indexOf(idOf(node));
				for (const mate of mates) {
					if (myCenter > mate.center) dropIdx = order.indexOf(idOf(mate.node));
					mate.node.style.removeProperty("transform");
				}
				const moved = order.splice(order.indexOf(idOf(node)), 1)[0];
				order.splice(dropIdx, 0, moved);
				applyOrder();
				dragging = null;
			}

			function start() {
				if (typeof MutationObserver === "undefined") return;
				let raf = 0;
				const mo = new MutationObserver(function () {
					if (raf) return;
					raf = requestAnimationFrame(function () {
						raf = 0;
						try {
							if (dragging) return;            /* never fight an active drag */
							/* fast path: no queued bubbles anywhere (the common
							 * state) — one selector read, no list work */
							if (order.length === 0 &&
								document.querySelector("[data-pending-steering],[data-queue-dock] li") === null) return;
							if (!reconcile()) { order = []; return; }
							const list = bubbles();
							for (const node of list) {
								const parent = node.parentNode;
								if (parent) attachHandlers(node, parent);
							}
							/* re-apply if React rendered a different order */
							const current = list.map(idOf);
							const wanted = order.filter((id) => current.includes(id));
							if (wanted.length === current.length && wanted.join(",") !== current.join(",")) {
								applyOrder();
							}
						} catch (err) { /* fail soft */ }
					});
				});
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
					for (const record of records) {
						for (const node of record.addedNodes) {
							if (node.nodeType === 1 && (node.tagName === "STYLE" || node.tagName === "LINK")) { styleHit = true; break; }
						}
						if (styleHit) break;
					}
					if (styleHit) schedule(150);
					scheduleMark();
				});
				mo.observe(document.documentElement, { childList: true, subtree: true });
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
		 * Session switch — land ON the bottom instead of sliding to it.
		 *
		 * 切换会话时今天发生两件事：
		 *  1. 新会话的消息流已经挂上，滚动容器却还停在上一个会话的
		 *     scrollTop 上几帧 —— 你先看到新内容的中段，它才跳下去；
		 *  2. 跟随底部的那一方用 `behavior:"smooth"`，于是那一跳变成
		 *     一段可见的滚动动画（「切个对话，内容滚一下」）。
		 *
		 * 我们在「会话切换窗口」内做两件事，窗口之外一概不干预：
		 *  - 每帧把滚动容器瞬时钉到底部（不做缓动）；
		 *  - 把该容器上的 smooth 滚动请求降级为 instant。
		 * 滚轮 / 触摸 / 指针 / 按键一出现窗口立刻结束 —— 读者永远抢得回。
		 * ================================================================ */
		const sessionSwitch = (function () {
			const SCROLLER = "[data-conversation-scroll]";
			const ROOT = '[data-slot="conversation.session"]';
			const WINDOW_MS = 600;
			let until = 0;
			let raf = 0;
			let hooked = false;

			const active = () => performance.now() < until;

			function pin() {
				raf = 0;
				if (!active()) return;
				try {
					const el = document.querySelector(SCROLLER);
					if (el !== null) {
						const bottom = el.scrollHeight - el.clientHeight;
						/* 只在确有距离时写：写同值会白造一次样式失效 */
						if (bottom - el.scrollTop > 1) el.scrollTop = bottom;
					}
				} catch (err) { /* fail soft */ }
				raf = requestAnimationFrame(pin);
			}

			function arm() {
				until = performance.now() + WINDOW_MS;
				if (!raf) raf = requestAnimationFrame(pin);
			}

			function release() {
				until = 0;
			}

			/* smooth → instant：只认会话滚动容器，且只在切换窗口内。
			 * 窗口外（例如点右侧 turn 导航跳转）一律保持原样。 */
			function installScrollDowngrade() {
				if (hooked) return;
				hooked = true;
				const proto = Element.prototype;
				/* 幂等：HMR / 重复注入时不能套娃上一层又一层 */
				if (proto.__polishScrollToPatched === true) return;
				const original = proto.scrollTo;
				if (typeof original !== "function") return;
				proto.scrollTo = function (options, y) {
					try {
						if (
							active() &&
							options !== null &&
							typeof options === "object" &&
							options.behavior === "smooth" &&
							typeof this.matches === "function" &&
							this.matches(SCROLLER)
						) {
							const patched = {};
							for (const key in options) patched[key] = options[key];
							patched.behavior = "instant";
							return original.call(this, patched);
						}
					} catch (err) { /* fail soft */ }
					return original.call(this, options, y);
				};
				proto.__polishScrollToPatched = true;
			}

			function start() {
				if (typeof MutationObserver === "undefined") return;
				installScrollDowngrade();
				/* 入口一：点会话行（含搜索结果、未分组与工作区分组下的行） */
				document.addEventListener("click", function (ev) {
					const target = ev.target;
					if (target === null || typeof target.closest !== "function") return;
					if (target.closest('[data-row-key^="session:"]') !== null) arm();
				}, true);
				/* 入口二：会话视图根节点被整个换掉（新建会话 / 快捷键 / 深链
				 * 等不经过会话行的路径）。rAF 合并，避免流式渲染反复查询。 */
				let current = document.querySelector(ROOT);
				let queued = false;
				const mo = new MutationObserver(function () {
					if (queued) return;
					queued = true;
					requestAnimationFrame(function () {
						queued = false;
						try {
							const next = document.querySelector(ROOT);
							if (next !== current) {
								current = next;
								arm();
							}
						} catch (err) { /* fail soft */ }
					});
				});
				mo.observe(document.body, { childList: true, subtree: true });
				/* 读者接管：任何输入立刻结束窗口 */
				for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
					window.addEventListener(type, release, { capture: true, passive: true });
				}
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

			/** 这个 img 是不是躺在官方灯箱容器里。 */
			function hostOf(img) {
				const box = img.parentElement;
				if (box === null) return null;
				const cls = typeof box.className === "string" ? box.className : "";
				if (/backdrop/i.test(cls)) return box;
				try {
					const cs = getComputedStyle(box);
					if (cs.position === "fixed" && box.clientWidth >= window.innerWidth - 2) return box;
				} catch (err) { /* fail soft */ }
				return null;
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
				return document.querySelector("[" + IMG_SEL.slice(1) + "][" + DRAG_ATTR + "]");
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

		function apply() {
			ensureStyles();
			publishStats();
			/* 每个模块按自己的开关启动：关掉的模块不注册任何监听器 / 观察器 /
			 * rAF 循环，因此不存在「关了还在跑」的残留。 */
			if (SW.armor) lift.start();
			if (SW.drag) dragSort.start();
			if (SW.sessionSwitch) sessionSwitch.start();
			if (SW.motion) motionScale.start();
			if (SW.imageZoom) imageZoom.start();
			parentState.start();
			module.exports.apply = apply;
			module.exports.inject = [];
			return module.exports;
		}

		apply();
		return module.exports;
	}
});
